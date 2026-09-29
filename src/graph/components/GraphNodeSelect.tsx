import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGraphStore } from '../store';
import { Search, Plus, Sparkles, X, Check } from 'lucide-react';
import type { GraphNode } from '../types';

interface GraphNodeSelectProps {
  value?: string[];
  taskTitle?: string; // 传入任务标题用于智能推荐
  onChange: (nodeIds: string[]) => void;
  footer?: React.ReactNode;
}

const stopWords = ['的', '了', '是', '复习', '看书', '看课', '做题', '笔记', '第', '章', '节', '课', '和', '与'];
const EMPTY_NODE_IDS: string[] = [];

const meaningfulCharacters = (value: string) => {
  const withoutStopWords = stopWords.reduce((text, word) => text.split(word).join(''), value);
  return Array.from(new Set([...withoutStopWords].filter((character) => character.trim())));
};

// 简单的相似度计算：计算 nodeName 在 taskTitle 中出现的比例，或者共有字符的比例
function calculateSimilarity(taskTitle: string, nodeName: string, titleChars: Set<string>): number {
  if (!taskTitle || !nodeName) return 0;
  const title = taskTitle.toLowerCase();
  const name = nodeName.toLowerCase();
  
  // 1. 完全包含，最高权重
  if (title.includes(name)) return 100;
  
  // 2. 节点名包含在任务名中（通常任务名更长）
  if (name.includes(title)) return 80;
  
  // 3. 计算去除完整停用词后的共有字符比例
  const nameChars = meaningfulCharacters(name);
  
  if (nameChars.length === 0) return 0;
  
  let matchCount = 0;
  for (const char of nameChars) {
    if (titleChars.has(char)) {
      matchCount++;
    }
  }
  
  // 降低阈值要求，只要有一个关键字匹配，就给基础分
  if (matchCount >= 1) {
      return 40 + (matchCount / nameChars.length) * 40; 
  }
  
  return 0;
}

export const GraphNodeSelect: React.FC<GraphNodeSelectProps> = ({ value, taskTitle = '', onChange, footer }) => {
  // 确保 value 始终是数组
  const safeValue = Array.isArray(value) ? value : EMPTY_NODE_IDS;
  const nodes = useGraphStore((state) => state.nodes);
  const addNode = useGraphStore((state) => state.addNode);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIds = useMemo(() => new Set(safeValue), [safeValue]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const existingNames = useMemo(() => new Set(nodes.filter((node) => !node.isArchived).map((node) => node.name.toLowerCase())), [nodes]);
  const selectableNodes = useMemo(() => {
    const parentIds = new Set(
      nodes.filter(node => !node.isArchived && node.parentId).map(node => node.parentId as string),
    );
    return nodes.filter(node => !node.isArchived && !parentIds.has(node.id));
  }, [nodes]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [search]);

  const handleSelect = (nodeId: string) => {
    if (selectedIds.has(nodeId)) {
      onChange(safeValue.filter(id => id !== nodeId));
    } else {
      onChange([...safeValue, nodeId]);
    }
    setSearch('');
    inputRef.current?.focus();
  };

  // 计算节点的完整路径（面包屑）
  const getNodePath = (node: GraphNode): string => {
    const path: string[] = [];
    let current: GraphNode | undefined = node;
    const visited = new Set([node.id]);
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      current = nodeById.get(current.parentId);
      if (current) {
        path.unshift(current.name);
      }
    }
    return path.length > 0 ? path.join(' / ') : '';
  };

  // 最近创建：按 createdAt 降序，取前 5 个
  const recentNodes = useMemo(() => {
    const recent: GraphNode[] = [];
    for (const node of selectableNodes) {
      const index = recent.findIndex((item) => node.createdAt > item.createdAt);
      recent.splice(index < 0 ? recent.length : index, 0, node);
      if (recent.length > 5) recent.pop();
    }
    return recent;
  }, [selectableNodes]);

  // 智能推荐：计算相似度
  const recommendedNodes = useMemo(() => {
    if (!taskTitle || !taskTitle.trim()) return [];
    
    const titleChars = new Set(meaningfulCharacters(taskTitle.toLowerCase()));
    const scored: Array<{ node: GraphNode; score: number }> = [];
    for (const node of selectableNodes) {
      const score = calculateSimilarity(taskTitle, node.name, titleChars);
      if (score <= 0) continue;
      const index = scored.findIndex((item) => score > item.score);
      scored.splice(index < 0 ? scored.length : index, 0, { node, score });
      if (scored.length > 3) scored.pop();
    }
    return scored.map((item) => item.node);
  }, [selectableNodes, taskTitle]);

  const filteredNodes = useMemo(() => {
    if (!search) {
      // 过滤掉已经在推荐列表中的最近创建节点，避免重复显示
      const recIds = new Set(recommendedNodes.map(n => n.id));
      const filteredRecent = recentNodes.filter(n => !recIds.has(n.id));
      // 合并推荐和最近创建的节点
      const merged = [...recommendedNodes, ...filteredRecent];
      // 如果什么都没有，返回空数组，而不是抛错
      return merged;
    }
    const query = search.toLowerCase();
    return selectableNodes.filter(n => n.name.toLowerCase().includes(query));
  }, [search, recentNodes, recommendedNodes, selectableNodes]);

  const exactMatch = existingNames.has(search.trim().toLowerCase());

  // 计算幽灵文本（Ghost Text）
  const ghostText = useMemo(() => {
    if (!search && recommendedNodes.length > 0) {
      return recommendedNodes[0].name;
    }
    if (search && filteredNodes.length > 0) {
      // 找到第一个以 search 开头的节点作为补全建议
      const match = filteredNodes.find(n => n.name.toLowerCase().startsWith(search.toLowerCase()));
      if (match) {
        // 保持用户输入的大小写，补全剩余部分
        return search + match.name.slice(search.length);
      }
    }
    return '';
  }, [search, recommendedNodes, filteredNodes]);

  const showCreate = search.trim() && !exactMatch;
  const totalItems = filteredNodes.length + (showCreate ? 1 : 0);
  const rowVirtualizer = useVirtualizer({
    count: totalItems,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44,
    overscan: 5,
  });

  const handleCreate = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    const newNode = addNode(trimmed);
    handleSelect(newNode.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      if (ghostText && ghostText !== search) {
        e.preventDefault();
        setSearch(ghostText);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItems > 0) {
        const next = (selectedIndex + 1) % totalItems;
        setSelectedIndex(next);
        rowVirtualizer.scrollToIndex(next);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItems > 0) {
        const next = (selectedIndex - 1 + totalItems) % totalItems;
        setSelectedIndex(next);
        rowVirtualizer.scrollToIndex(next);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < filteredNodes.length) {
        handleSelect(filteredNodes[selectedIndex].id);
      } else if (showCreate) {
        handleCreate();
      }
    }
  };

  return (
    <div className="stb-graph-picker">
      {/* 已选节点展示区 */}
      {safeValue.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px 0' }}>
          {safeValue.map(id => {
            const n = nodeById.get(id);
            if (!n) return null;
            return (
              <span key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
                padding: '2px 8px', borderRadius: 4, fontSize: 12, color: '#111827'
              }}>
                {n.name}
                <button type="button" onClick={() => handleSelect(id)} style={{ padding: 2, margin: '-2px -4px -2px 0', color: '#9ca3af', cursor: 'pointer', background: 'none', border: 'none' }}><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}

      <div className="stb-graph-picker-search">
        <Search size={14} className="stb-graph-picker-icon" />
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
          {ghostText && ghostText !== search && (
            <div 
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                color: '#9ca3af',
                pointerEvents: 'none',
                whiteSpace: 'pre',
                fontSize: '13px',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <span style={{ opacity: 0 }}>{search}</span>
              <span>{ghostText.slice(search.length)}</span>
              {/* Tab 提示 */}
              <span style={{ 
                marginLeft: 8, 
                fontSize: 10, 
                backgroundColor: '#f3f4f6', 
                padding: '2px 4px', 
                borderRadius: 4,
                color: '#6b7280',
                border: '1px solid #e5e7eb'
              }}>Tab</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={ghostText ? '' : "搜索或创建知识节点..."}
            onKeyDown={handleKeyDown}
            style={{ width: '100%', position: 'relative', zIndex: 1, background: 'transparent' }}
          />
        </div>
      </div>
      
      {!search && recommendedNodes.length > 0 && (
        <div className="stb-graph-picker-title" style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8b5cf6' }}>
          <Sparkles size={12} /> 智能推荐
        </div>
      )}
      
      {!search && recentNodes.length > 0 && recommendedNodes.length === 0 && (
        <div className="stb-graph-picker-title">最近创建</div>
      )}

      <div className="stb-graph-picker-list" ref={listRef}>
        <div style={{ height: rowVirtualizer.getTotalSize(), flexShrink: 0, position: 'relative', width: '100%' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const index = virtualRow.index;
          if (index === filteredNodes.length) return (
            <div key="create" data-index={index} ref={rowVirtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
              <button type="button" className={`stb-graph-option stb-graph-option--create ${selectedIndex === index ? 'stb-graph-option--active' : ''}`} style={{ width: '100%' }} onClick={handleCreate} onMouseEnter={() => { if (selectedIndex !== index) setSelectedIndex(index); }}>
                <Plus size={14} /> 创建新知识节点："{search.trim()}"
              </button>
            </div>
          );
          const node = filteredNodes[index];
          const path = getNodePath(node);
          const isRecommended = !search && index < recommendedNodes.length;
          // 如果过了推荐区，并且是最近创建的第一个，插入一个小标题
          const isFirstRecent = !search && recommendedNodes.length > 0 && index === recommendedNodes.length;
          
          return (
            <div key={node.id} data-index={index} ref={rowVirtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
              {isFirstRecent && (
                <div className="stb-graph-picker-title" style={{ marginTop: 8, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>最近创建</div>
              )}
              <button
                type="button"
                className={`stb-graph-option ${selectedIndex === index ? 'stb-graph-option--active' : ''}`}
                style={{ width: '100%', ...(isRecommended ? { backgroundColor: selectedIndex === index ? '#f5f3ff' : '#faf5ff' } : {}) }}
                onClick={() => handleSelect(node.id)}
                onMouseEnter={() => { if (selectedIndex !== index) setSelectedIndex(index); }}
              >
                <div className="stb-graph-option-main">
                  {isRecommended && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#8b5cf6', marginRight: 6 }} />}
                  {node.name}
                </div>
                {selectedIds.has(node.id) ? (
                  <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
                ) : path ? (
                  <div className="stb-graph-option-path">{path}</div>
                ) : null}
              </button>
            </div>
          );
        })}
        </div>
      </div>
      {footer}
    </div>
  );
};
