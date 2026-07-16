import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useGraphStore } from '../store';
import { Search, Plus, Sparkles, X, Check } from 'lucide-react';
import type { GraphNode } from '../types';

interface GraphNodeSelectProps {
  value?: string[];
  taskTitle?: string; // 传入任务标题用于智能推荐
  onChange: (nodeIds: string[]) => void;
  footer?: React.ReactNode;
}

  // 简单的相似度计算：计算 nodeName 在 taskTitle 中出现的比例，或者共有字符的比例
function calculateSimilarity(taskTitle: string, nodeName: string): number {
  if (!taskTitle || !nodeName) return 0;
  const title = taskTitle.toLowerCase();
  const name = nodeName.toLowerCase();
  
  // 1. 完全包含，最高权重
  if (title.includes(name)) return 100;
  
  // 2. 节点名包含在任务名中（通常任务名更长）
  if (name.includes(title)) return 80;
  
  // 3. 计算共有中文字符/单词的比例
  // 过滤掉常见无意义词汇
  const stopWords = ['的', '了', '是', '复习', '看书', '看课', '做题', '笔记', '第', '章', '节', '课', '和', '与'];
  const titleChars = Array.from(new Set(title.split('').filter(c => c.trim() && !stopWords.includes(c))));
  const nameChars = Array.from(new Set(name.split('').filter(c => c.trim() && !stopWords.includes(c))));
  
  if (nameChars.length === 0) return 0;
  
  let matchCount = 0;
  for (const char of nameChars) {
    if (titleChars.includes(char)) {
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
  const safeValue = Array.isArray(value) ? value : [];
  const { nodes, addNode, getNodeById } = useGraphStore();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
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
  }, [search]);

  const handleSelect = (nodeId: string) => {
    if (safeValue.includes(nodeId)) {
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
    // 为防止死循环，最多向上找 5 层
    let depth = 0;
    while (current?.parentId && depth < 5) {
      current = getNodeById(current.parentId);
      if (current) {
        path.unshift(current.name);
      }
      depth++;
    }
    return path.length > 0 ? path.join(' / ') : '';
  };

  // 最近使用：按 createdAt 降序，取前 5 个
  const recentNodes = useMemo(() => {
    return [...selectableNodes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  }, [selectableNodes]);

  // 智能推荐：计算相似度
  const recommendedNodes = useMemo(() => {
    if (!taskTitle || !taskTitle.trim()) return [];
    
    const scored = selectableNodes.map(node => ({
      node,
      score: calculateSimilarity(taskTitle, node.name)
    })).filter(n => n.score > 0); // 只要有匹配度就尝试推荐，由降序和截取控制数量
    
    // 按分数降序排列，取前 3 个
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.node);
  }, [selectableNodes, taskTitle]);

  const filteredNodes = useMemo(() => {
    if (!search) {
      // 过滤掉已经在推荐列表中的最近使用节点，避免重复显示
      const recIds = new Set(recommendedNodes.map(n => n.id));
      const filteredRecent = recentNodes.filter(n => !recIds.has(n.id));
      // 合并推荐和最近使用的节点
      const merged = [...recommendedNodes, ...filteredRecent];
      // 如果什么都没有，返回空数组，而不是抛错
      return merged;
    }
    return selectableNodes.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));
  }, [search, recentNodes, recommendedNodes, selectableNodes]);

  const exactMatch = useMemo(() => {
    return nodes.find(
      n => !n.isArchived && n.name.toLowerCase() === search.trim().toLowerCase(),
    );
  }, [nodes, search]);

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
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
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
            const n = getNodeById(id);
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
        <div className="stb-graph-picker-title">最近使用</div>
      )}

      <div className="stb-graph-picker-list">
        {filteredNodes.map((node, index) => {
          const path = getNodePath(node);
          const isRecommended = !search && index < recommendedNodes.length;
          // 如果过了推荐区，并且是最近使用的第一个，插入一个小标题
          const isFirstRecent = !search && recommendedNodes.length > 0 && index === recommendedNodes.length;
          
          return (
            <React.Fragment key={node.id}>
              {isFirstRecent && (
                <div className="stb-graph-picker-title" style={{ marginTop: 8, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>最近使用</div>
              )}
              <button
                type="button"
                className={`stb-graph-option ${selectedIndex === index ? 'stb-graph-option--active' : ''}`}
                style={isRecommended ? { backgroundColor: selectedIndex === index ? '#f5f3ff' : '#faf5ff' } : {}}
                onClick={() => handleSelect(node.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="stb-graph-option-main">
                  {isRecommended && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#8b5cf6', marginRight: 6 }} />}
                  {node.name}
                </div>
                {safeValue.includes(node.id) ? (
                  <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
                ) : path ? (
                  <div className="stb-graph-option-path">{path}</div>
                ) : null}
              </button>
            </React.Fragment>
          );
        })}
        {showCreate && (
          <button
            type="button"
            className={`stb-graph-option stb-graph-option--create ${selectedIndex === filteredNodes.length ? 'stb-graph-option--active' : ''}`}
            onClick={handleCreate}
            onMouseEnter={() => setSelectedIndex(filteredNodes.length)}
          >
            <Plus size={14} /> 创建新知识节点："{search.trim()}"
          </button>
        )}
      </div>
      {footer}
    </div>
  );
};
