import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useGraphStore } from '../store';
import { Search, Plus } from 'lucide-react';

interface GraphNodeSelectProps {
  value?: string;
  onChange: (nodeId: string) => void;
}

export const GraphNodeSelect: React.FC<GraphNodeSelectProps> = ({ value, onChange }) => {
  const { nodes, addNode } = useGraphStore();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredNodes = useMemo(() => {
    if (!search) return nodes;
    return nodes.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));
  }, [nodes, search]);

  const exactMatch = useMemo(() => {
    return nodes.find(n => n.name.toLowerCase() === search.trim().toLowerCase());
  }, [nodes, search]);

  const handleCreate = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    const newNode = addNode(trimmed);
    onChange(newNode.id);
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (exactMatch) onChange(exactMatch.id);
              else if (filteredNodes.length > 0) onChange(filteredNodes[0].id);
              else handleCreate();
            }
          }}
        />
      </div>
      <div className="stb-graph-picker-list">
        {filteredNodes.map(node => (
          <button
            key={node.id}
            type="button"
            className={`stb-graph-option ${value === node.id ? 'stb-graph-option--active' : ''}`}
            onClick={() => onChange(node.id)}
          >
            {node.name}
          </button>
        ))}
        {search.trim() && !exactMatch && (
          <button
            type="button"
            className="stb-graph-option stb-graph-option--create"
            onClick={handleCreate}
          >
            <Plus size={14} /> 创建新知识节点："{search.trim()}"
          </button>
        )}
      </div>
    </div>
  );
};
