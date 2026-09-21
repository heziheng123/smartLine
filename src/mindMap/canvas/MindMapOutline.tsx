import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { MindMapNode, MindMapPriority, MindMapTaskStatus } from '../model';
import { MIND_MAP_MARKER_ICON } from '../visualTheme';
import type { OutlineDropPosition } from './treeInteractions';
import styles from './MindMapCanvas.module.css';

interface MindMapOutlineProps {
  nodes: Record<string, MindMapNode>;
  roots: string[];
  childrenById: Map<string, string[]>;
  selectedNodeIds: string[];
  onFocus: (nodeId: string) => void;
  onRename: (nodeId: string, text: string) => void;
  onToggleCollapse: (nodeId: string) => void;
  onCollapseAll: (collapsed: boolean) => void;
  onMove: (nodeId: string, targetId: string, position: OutlineDropPosition) => void;
}

const dropPosition = (event: DragEvent<HTMLElement>): OutlineDropPosition => {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
};

export function MindMapOutline({
  nodes,
  roots,
  childrenById,
  selectedNodeIds,
  onFocus,
  onRename,
  onToggleCollapse,
  onCollapseAll,
  onMove,
}: MindMapOutlineProps) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [priority, setPriority] = useState<MindMapPriority | 'all'>('all');
  const [status, setStatus] = useState<MindMapTaskStatus | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: OutlineDropPosition } | null>(null);
  const tags = useMemo(() => [...new Set(Object.values(nodes).flatMap((node) => node.tags ?? []))].sort(), [nodes]);
  const parentById = useMemo(() => {
    const result = new Map<string, string>();
    for (const [parentId, childIds] of childrenById) childIds.forEach((childId) => result.set(childId, parentId));
    return result;
  }, [childrenById]);
  const visibleIds = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = new Set(Object.values(nodes).filter((node) => (
      (!normalizedQuery || `${node.icon ?? ''} ${node.text} ${(node.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery))
      && (tag === 'all' || node.tags?.includes(tag))
      && (priority === 'all' || node.priority === priority)
      && (status === 'all' || node.taskStatus === status)
    )).map((node) => node.id));
    if (!normalizedQuery && tag === 'all' && priority === 'all' && status === 'all') return null;
    for (const id of [...matches]) {
      let parentId = parentById.get(id);
      while (parentId) {
        matches.add(parentId);
        parentId = parentById.get(parentId);
      }
    }
    return matches;
  }, [nodes, parentById, priority, query, status, tag]);

  const commitRename = () => {
    if (!editingId) return;
    onRename(editingId, draft.trim() || '空节点');
    setEditingId(null);
  };
  const beginRename = (node: MindMapNode) => {
    setEditingId(node.id);
    setDraft(node.text);
  };
  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitRename();
    if (event.key === 'Escape') setEditingId(null);
  };

  const renderNode = (nodeId: string, depth = 0): ReactNode => {
    const node = nodes[nodeId];
    if (!node || (visibleIds && !visibleIds.has(nodeId))) return null;
    const childIds = childrenById.get(nodeId) ?? [];
    const selected = selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeId;
    const dropping = dropTarget?.id === nodeId ? dropTarget.position : null;
    return <li key={nodeId} className={styles.outlineItem}>
      <div
        className={`${styles.outlineRow} ${selected ? styles.outlineRowSelected : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={editingId !== nodeId}
        data-drop-position={dropping ?? undefined}
        onDragStart={(event) => {
          setDraggedId(nodeId);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', nodeId);
        }}
        onDragOver={(event) => {
          if (!draggedId || draggedId === nodeId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTarget({ id: nodeId, position: dropPosition(event) });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const sourceId = draggedId ?? event.dataTransfer.getData('text/plain');
          if (sourceId && sourceId !== nodeId) onMove(sourceId, nodeId, dropPosition(event));
          setDraggedId(null);
          setDropTarget(null);
        }}
        onDragEnd={() => {
          setDraggedId(null);
          setDropTarget(null);
        }}
      >
        {childIds.length ? <button type="button" className={styles.outlineCollapse} aria-label={`${node.collapsed ? '展开' : '折叠'} ${node.text || '空节点'}`} onClick={() => onToggleCollapse(nodeId)}>{node.collapsed ? '▸' : '▾'}</button> : <span className={styles.outlineSpacer} />}
        {editingId === nodeId ? <input
          className={styles.outlineRename}
          value={draft}
          autoFocus
          aria-label="节点名称"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={handleRenameKey}
        /> : <button type="button" className={styles.outlineLabel} onDoubleClick={() => beginRename(node)} onClick={() => onFocus(nodeId)} title={node.text || '空节点'}>
          {(node.marker ?? 'none') !== 'none' && <span className={styles.outlineIcon} aria-hidden="true">{MIND_MAP_MARKER_ICON[node.marker ?? 'none']}</span>}
          {node.icon && <span className={styles.outlineIcon} aria-hidden="true">{node.icon}</span>}
          <span className={styles.outlineText}>{node.text || '空节点'}</span>
          {node.progress !== null && node.progress !== undefined && <i>{Math.round(node.progress)}%</i>}
          {node.tags?.slice(0, 2).map((nodeTag) => <i key={nodeTag}>#{nodeTag}</i>)}
        </button>}
      </div>
      {!node.collapsed && childIds.length > 0 && <ul>{childIds.map((childId) => renderNode(childId, depth + 1))}</ul>}
    </li>;
  };

  return <aside className={styles.outlinePanel} aria-label="思维导图大纲">
    <header><strong>大纲</strong><small>{Object.keys(nodes).length} 个节点</small></header>
    <div className={styles.outlineTools}>
      <input aria-label="筛选大纲" placeholder="搜索节点" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div>
        <select aria-label="按标签筛选" value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">全部标签</option>{tags.map((item) => <option key={item} value={item}>#{item}</option>)}</select>
        <select aria-label="按优先级筛选" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="all">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="none">无</option></select>
        <select aria-label="按任务状态筛选" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="todo">待办</option><option value="doing">进行中</option><option value="done">完成</option><option value="none">无</option></select>
      </div>
      <div className={styles.outlineFoldActions}><button type="button" onClick={() => onCollapseAll(true)}>全部折叠</button><button type="button" onClick={() => onCollapseAll(false)}>全部展开</button></div>
    </div>
    <ul>{roots.map((nodeId) => renderNode(nodeId))}</ul>
    {visibleIds?.size === 0 && <p className={styles.outlineEmpty}>没有匹配节点</p>}
  </aside>;
}
