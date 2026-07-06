import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useGraphStore } from '../store';
import { Search, Plus } from 'lucide-react';
import type { GraphNode } from '../types';

interface GraphNodeSelectProps {
  value?: string;
  onChange: (nodeId: string) => void;
}

export const GraphNodeSelect: React.FC<GraphNodeSelectProps> = ({ onChange }) => {
  const { nodes, addNode, getNodeById } = useGraphStore();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

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
    return [...nodes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    if (!search) return recentNodes;
    return nodes.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));
  }, [nodes, search, recentNodes]);

  const exactMatch = useMemo(() => {
    return nodes.find(n => n.name.toLowerCase() === search.trim().toLowerCase());
  }, [nodes, search]);

  const showCreate = search.trim() && !exactMatch;
  const totalItems = filteredNodes.length + (showCreate ? 1 : 0);

  const handleCreate = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    const newNode = addNode(trimmed);
    onChange(newNode.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < filteredNodes.length) {
        onChange(filteredNodes[selectedIndex].id);
      } else if (showCreate) {
        handleCreate();
      }
    }
  };

  return (
    <div className="stb-graph-picker">
      <div className="stb-graph-picker-search">
        <Search size={14} className="stb-graph-picker-icon" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索或创建知识节点..."
          onKeyDown={handleKeyDown}
        />
      </div>
      
      {!search && recentNodes.length > 0 && (
        <div className="stb-graph-picker-title">最近使用</div>
      )}

      <div className="stb-graph-picker-list">
        {filteredNodes.map((node, index) => {
          const path = getNodePath(node);
          return (
            <button
              key={node.id}
              type="button"
              className={`stb-graph-option ${selectedIndex === index ? 'stb-graph-option--active' : ''}`}
              onClick={() => onChange(node.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="stb-graph-option-main">
                {node.name}
              </div>
              {path && <div className="stb-graph-option-path">{path}</div>}
            </button>
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
    </div>
  );
};
