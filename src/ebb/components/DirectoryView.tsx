// ============================================================
// Ebb - 目录视图
// 书籍/章节/知识点三级树形结构 + 进度统计 + 大纲管理
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, ChevronRight, BookOpen, Plus, Trash2, Edit3,
  FolderOpen, FileText, X, ClipboardPaste,
} from 'lucide-react';
import { useEbbStore } from '../store';
import { genId, generateTasks, isOverdue, computeRounds } from '../scheduler';
import { getIntervalsForComplexity } from '../complexity';
import type { ReviewTask, EbbSettings, StudyOutlineNode, OutlineNodeType, ComplexityLevel } from '../types';
import type { TaskActions } from './MatrixView';

interface DirectoryViewProps {
  tasks: ReviewTask[];
  nodes: StudyOutlineNode[];
  settings: EbbSettings;
  taskActions: TaskActions;
}

const DirectoryView: React.FC<DirectoryViewProps> = ({ tasks, nodes, settings, taskActions }) => {
  const store = useEbbStore();
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed'>('all');
  const [filterBookId, setFilterBookId] = useState<string>('');
  const [manageOpen, setManageOpen] = useState(false);
  const [generateNode, setGenerateNode] = useState<StudyOutlineNode | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const getNodePath = useCallback((nodeId: string): string => {
    const path: string[] = [];
    let current = nodeMap.get(nodeId);
    while (current) {
      path.unshift(current.name);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
    return path.join(' > ');
  }, [nodeMap]);

  const rootNodes = useMemo(
    () => nodes.filter((n) => !n.parentId || !nodeMap.has(n.parentId)).sort((a, b) => a.orderIndex - b.orderIndex),
    [nodes, nodeMap],
  );

  // 书籍列表（用于筛选）
  const books = useMemo(() => nodes.filter((n) => n.type === 'book'), [nodes]);

  // 获取子节点
  const getChildren = useCallback(
    (parentId: string) => nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex),
    [nodes],
  );

  // 节点关联的复习任务
  const getLinkedTasks = useCallback(
    (nodeId: string) => tasks.filter((t) => t.outlineNodeId === nodeId),
    [tasks],
  );

  // 节点（含后代）的统计
  const getNodeStat = useCallback(
    (nodeId: string): { total: number; completed: number; pending: number; overdue: number; nextDate?: string } => {
      // 收集该节点及其所有后代关联的任务
      const collectIds = (id: string): string[] => {
        const ids = [id];
        const children = getChildren(id);
        for (const c of children) ids.push(...collectIds(c.id));
        return ids;
      };
      const allIds = new Set(collectIds(nodeId));
      const linked = tasks.filter((t) => t.outlineNodeId && allIds.has(t.outlineNodeId));
      const total = linked.length;
      const completed = linked.filter((t) => t.isCompleted).length;
      const overdue = linked.filter(isOverdue).length;
      const pending = total - completed;
      const future = linked
        .filter((t) => !t.isCompleted && !isOverdue(t))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return { total, completed, pending, overdue, nextDate: future[0]?.dueDate };
    },
    [tasks, getChildren],
  );

  // 筛选
  const visibleRoots = useMemo(() => {
    let list = rootNodes;
    if (filterBookId) list = list.filter((n) => n.id === filterBookId);
    return list;
  }, [rootNodes, filterBookId]);

  return (
    <div className="eb-directory">
      {/* 筛选栏 */}
      <div className="eb-filter-bar">
        <div className="eb-filter-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索章节或任务..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="eb-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
          <option value="all">全部状态</option>
          <option value="pending">复习中</option>
          <option value="completed">已完成</option>
        </select>
        <select className="eb-filter-select" value={filterBookId} onChange={(e) => setFilterBookId(e.target.value)}>
          <option value="">全部书籍</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button type="button" className="eb-filter-action" onClick={() => setManageOpen(true)}>
          <BookOpen size={14} />
          管理目录
        </button>
      </div>

      {/* 树形列表 */}
      <div className="eb-directory-tree">
        {visibleRoots.length === 0 ? (
          <div className="eb-empty">
            <p>暂无学习大纲</p>
            <p className="eb-empty-hint">点击「管理目录」添加书籍和章节，或粘贴目录自动生成</p>
          </div>
        ) : (
          visibleRoots.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              level={0}
              settings={settings}
              query={query}
              filterStatus={filterStatus}
              getChildren={getChildren}
              getLinkedTasks={getLinkedTasks}
              getNodeStat={getNodeStat}
              getNodePath={getNodePath}
              taskActions={taskActions}
              onOpenGenerate={setGenerateNode}
            />
          ))
        )}

      {generateNode && (
        <GenerateTaskModal
          node={generateNode}
          nodePath={getNodePath(generateNode.id)}
          settings={settings}
          onClose={() => setGenerateNode(null)}
        />
      )}
      </div>

      {/* 管理目录弹窗 */}
      {manageOpen && (
        <ManageOutlineModal onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
};

// ── 树节点组件 ──────────────────────────────────────────────
interface TreeNodeProps {
  node: StudyOutlineNode;
  level: number;
  settings: EbbSettings;
  query: string;
  filterStatus: 'all' | 'pending' | 'completed';
  getChildren: (parentId: string) => StudyOutlineNode[];
  getLinkedTasks: (nodeId: string) => ReviewTask[];
  getNodeStat: (nodeId: string) => { total: number; completed: number; pending: number; overdue: number; nextDate?: string };
  getNodePath: (nodeId: string) => string;
  taskActions: TaskActions;
  onOpenGenerate: (node: StudyOutlineNode) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node, level, settings, query, filterStatus,
  getChildren, getLinkedTasks, getNodeStat, getNodePath, taskActions, onOpenGenerate,
}) => {
  const store = useEbbStore();
  const [expanded, setExpanded] = useState(level === 0);
  const [editingTag, setEditingTag] = useState(false);
  const [tagInput, setTagInput] = useState(node.defaultTag || '');
  const children = getChildren(node.id);
  const stat = getNodeStat(node.id);
  const linkedTasks = getLinkedTasks(node.id);
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(store.reviewTasks), [store.reviewTasks]);

  const sectionChildren = useMemo(() => children.filter(c => c.type === 'section'), [children]);
  const chapterChildren = useMemo(() => children.filter(c => c.type === 'chapter'), [children]);

  const matchesQuery = !query || node.name.toLowerCase().includes(query.toLowerCase());
  const matchesStatus =
    filterStatus === 'all' ||
    (filterStatus === 'completed' && stat.total > 0 && stat.completed === stat.total) ||
    (filterStatus === 'pending' && stat.completed < stat.total);

  const hasQuery = query.length > 0;
  const showNode = matchesQuery || hasQuery;

  const statusColor = stat.total === 0 ? '#9CA3AF' : stat.completed === stat.total ? '#10B981' : stat.overdue > 0 ? '#EF4444' : '#F59E0B';
  const ratio = stat.total > 0 ? stat.completed / stat.total : 0;

  const nodeIcon = node.type === 'book' ? '📕' : node.type === 'chapter' ? '📗' : '📘';
  const statusText = stat.total === 0 ? '未开始' : stat.completed === stat.total ? '已完成' : stat.overdue > 0 ? '逾期' : '复习中';

  const isSection = node.type === 'section';
  const isChapter = node.type === 'chapter';
  const isBook = node.type === 'book';
  const canGenerate = isSection;

  const handleSaveTag = useCallback(() => {
    store.updateOutlineNode(node.id, { defaultTag: tagInput.trim() || undefined });
    setEditingTag(false);
  }, [node.id, tagInput, store]);

  const countSections = useCallback((n: StudyOutlineNode): number => {
    const kids = getChildren(n.id);
    let count = n.type === 'section' ? 1 : 0;
    for (const k of kids) count += countSections(k);
    return count;
  }, [getChildren]);

  const totalSections = useMemo(() => countSections(node), [node, countSections]);

  // 递归计算有任务的节数
  const countSectionsWithTasks = useCallback((n: StudyOutlineNode): number => {
    const kids = getChildren(n.id);
    let count = (n.type === 'section' && getNodeStat(n.id).total > 0) ? 1 : 0;
    for (const k of kids) count += countSectionsWithTasks(k);
    return count;
  }, [getChildren, getNodeStat]);

  const sectionsWithTasks = useMemo(() => countSectionsWithTasks(node), [node, countSectionsWithTasks]);

  if (!showNode && !hasQuery) return null;

  const showStats = expanded && (isBook || isChapter) && totalSections > 0;

  return (
    <div className="eb-tree-node" style={{ '--tree-level': level, '--accent': statusColor } as React.CSSProperties}>
      <div
        className={`eb-tree-row ${level === 0 ? 'eb-tree-row--book' : ''} ${hasQuery ? 'eb-tree-row--highlight' : ''} ${isSection ? 'eb-tree-row--section' : ''} ${showStats ? 'eb-tree-row--with-stats' : ''}`}
        onClick={() => children.length > 0 && setExpanded(!expanded)}
      >
        {children.length > 0 ? (
          <ChevronRight size={14} className={`eb-tree-chevron ${expanded ? 'eb-tree-chevron--open' : ''}`} />
        ) : (
          <span className="eb-tree-chevron-placeholder" />
        )}
        <span className="eb-tree-icon">{nodeIcon}</span>
        <span className={`eb-tree-type-label eb-tree-type-label--${node.type}`}>{node.type === 'book' ? '书' : node.type === 'chapter' ? '章' : '节'}</span>
        <span className="eb-tree-name">{node.name}</span>
        <span className="eb-tree-status" style={{ color: statusColor }}>{statusText}</span>
        {stat.total > 0 && (
          <span className="eb-tree-count">{stat.completed}/{stat.total}</span>
        )}
        {node.defaultTag && (
          <span className="eb-tree-tag">{node.defaultTag}</span>
        )}
        {stat.total > 0 && (
          <div className="eb-tree-bar">
            <div className="eb-tree-bar-fill" style={{ width: `${ratio * 100}%`, backgroundColor: statusColor }} />
          </div>
        )}

        {/* 操作区：仅节节点显示，点击不触发展开 */}
        {isSection && (
          <div className="eb-tree-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="eb-tree-action-btn eb-tree-action-btn--primary"
              onClick={() => onOpenGenerate(node)}
              title="生成复习任务"
            >
              <Plus size={12} />
              生成任务
            </button>
            {editingTag ? (
              <div className="eb-tree-tag-edit">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="标签"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTag();
                    if (e.key === 'Escape') { setEditingTag(false); setTagInput(node.defaultTag || ''); }
                  }}
                />
                <button type="button" onClick={handleSaveTag}>✓</button>
              </div>
            ) : (
              <button
                type="button"
                className="eb-tree-action-btn"
                onClick={() => { setEditingTag(true); setTagInput(node.defaultTag || ''); }}
                title="编辑标签"
              >
                🏷️ 标签
              </button>
            )}
            {linkedTasks.length > 0 && (
              <button
                type="button"
                className="eb-tree-action-btn"
                onClick={() => taskActions.onOpenTimeline(node.name)}
                title="查看时间线"
              >
                <FileText size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {showStats && (
        <div className="eb-tree-stat-row">
          <span className="eb-tree-stat-item eb-tree-stat-item--total">📄 {totalSections}节</span>
          <span className="eb-tree-stat-item eb-tree-stat-item--done">✅ {stat.completed}已完成</span>
          <span className="eb-tree-stat-item eb-tree-stat-item--reviewing">🔄 {stat.pending - stat.overdue}复习中</span>
          <span className="eb-tree-stat-item eb-tree-stat-item--pending">⏳ {totalSections - sectionsWithTasks}未开始</span>
          {stat.pending > 0 && (
            <>
              <span className="eb-tree-stat-item eb-tree-stat-item--tasks">📋 待复习{stat.pending}</span>
              {stat.nextDate && (
                <span className="eb-tree-stat-item eb-tree-stat-item--date">📅 {stat.nextDate}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* 展开子节点 */}
      {expanded && children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          level={level + 1}
          settings={settings}
          query={query}
          filterStatus={filterStatus}
          getChildren={getChildren}
          getLinkedTasks={getLinkedTasks}
          getNodeStat={getNodeStat}
          getNodePath={getNodePath}
          taskActions={taskActions}
          onOpenGenerate={onOpenGenerate}
        />
      ))}

      {/* 展开知识点关联的任务详情 */}
      {expanded && isSection && linkedTasks.length > 0 && (
        <div className="eb-tree-tasks">
          {linkedTasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => {
            const round = roundMap.get(t.id) ?? 0;
            const total = totalRoundsMap.get(t.topicName) ?? 0;
            return (
              <div
                key={t.id}
                className={`eb-tree-task ${t.isCompleted ? 'eb-tree-task--done' : ''} ${isOverdue(t) ? 'eb-tree-task--overdue' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={t.isCompleted}
                  onChange={() => taskActions.onToggle(t.id)}
                />
                <span className="eb-tree-task-round" style={{
                  color: ['#6B7FD7', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'][(round - 1) % 7],
                }}>
                  R{round}/{total}
                </span>
                <span className="eb-tree-task-date">{t.dueDate}</span>
                <span className="eb-tree-task-status">{t.isCompleted ? '✅ 已完成' : isOverdue(t) ? '⚠️ 逾期' : '⏳ 待复习'}</span>
                <div className="eb-tree-task-actions">
                  <button type="button" onClick={() => taskActions.onReschedule(t.id)} title="改期">
                    📅
                  </button>
                  <button type="button" onClick={() => taskActions.onAddRound(t)} title="追加轮次">
                    ➕
                  </button>
                  <button type="button" onClick={() => taskActions.onOpenRounds(t)} title="查看所有轮次">
                    📋
                  </button>
                  <button type="button" onClick={() => taskActions.onDelete(t.id)} title="删除">
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── 生成任务弹窗 ────────────────────────────────────────────
interface GenerateTaskModalProps {
  node: StudyOutlineNode;
  nodePath: string;
  settings: EbbSettings;
  onClose: () => void;
}

const GenerateTaskModal: React.FC<GenerateTaskModalProps> = ({ node, nodePath, settings, onClose }) => {
  const store = useEbbStore();
  const [name, setName] = useState(node.name);
  const [tag, setTag] = useState(node.defaultTag || '');
  const [complexity, setComplexity] = useState<ComplexityLevel>('normal');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [intervals, setIntervals] = useState(() => getIntervalsForComplexity('normal', settings.complexityConfigs).join(', '));
  const [previewOpen, setPreviewOpen] = useState(false);

  const complexityOptions: { level: ComplexityLevel; emoji: string; label: string }[] = [
    { level: 'easy', emoji: '🟢', label: '简单' },
    { level: 'normal', emoji: '🟡', label: '普通' },
    { level: 'hard', emoji: '🔴', label: '困难' },
  ];

  const handleComplexityChange = useCallback((level: ComplexityLevel) => {
    setComplexity(level);
    setIntervals(getIntervalsForComplexity(level, settings.complexityConfigs).join(', '));
  }, [settings.complexityConfigs]);

  const parsedIntervals = useMemo(() => {
    return intervals.split(/[,，\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  }, [intervals]);

  const previewTasks = useMemo(() => {
    if (parsedIntervals.length === 0 || !name.trim()) return [];
    try {
      const result = generateTasks(
        {
          topicName: name.trim(),
          tag: tag.trim() || undefined,
          complexity,
          startDate,
          intervals: parsedIntervals,
          outlineNodeId: node.id,
        },
        store.reviewTasks,
        store.ebbSettings,
      );
      return result.tasks;
    } catch {
      return [];
    }
  }, [name, tag, complexity, startDate, parsedIntervals, node.id, store.reviewTasks, store.ebbSettings]);

  const handleConfirm = useCallback(() => {
    if (!name.trim() || parsedIntervals.length === 0 || previewTasks.length === 0) return;
    try {
      store.addReviewTasks(previewTasks);
      onClose();
    } catch (e) {
      console.error('[ebb] 生成任务失败：', e);
      alert('生成任务失败，请检查输入参数');
    }
  }, [name, parsedIntervals, previewTasks, store, onClose]);

  return createPortal(
    <div className="eb-modal-overlay" onClick={onClose}>
      <div className="eb-modal eb-gen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title">📝 为「{node.name}」添加复习计划</h3>
          <button type="button" className="eb-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="eb-modal-body">
          <div className="eb-gen-path">路径：{nodePath}</div>

          <div className="eb-gen-field">
            <label className="eb-gen-label">名称:</label>
            <input
              type="text"
              className="eb-gen-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="eb-gen-field">
            <label className="eb-gen-label">🏷️ 标签:</label>
            <input
              type="text"
              className="eb-gen-input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="可选"
            />
          </div>

          <div className="eb-gen-field">
            <label className="eb-gen-label">🎯 复杂度:</label>
            <div className="eb-gen-complexity">
              {complexityOptions.map(opt => (
                <button
                  key={opt.level}
                  type="button"
                  className={`eb-gen-complexity-btn ${complexity === opt.level ? 'eb-gen-complexity-btn--active' : ''}`}
                  onClick={() => handleComplexityChange(opt.level)}
                >
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="eb-gen-field">
            <label className="eb-gen-label">📅 起始日期:</label>
            <input
              type="date"
              className="eb-gen-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="eb-gen-field">
            <label className="eb-gen-label">间隔天数:</label>
            <input
              type="text"
              className="eb-gen-input"
              value={intervals}
              onChange={(e) => setIntervals(e.target.value)}
            />
            <div className="eb-gen-hint">💡 选择复杂度后自动调整轮次和间隔，也可手动修改</div>
          </div>

          {previewOpen && (
            <div className="eb-gen-preview">
              <div className="eb-gen-preview-title">📋 预览（共{previewTasks.length}个任务）：</div>
              <div className="eb-gen-preview-list">
                {previewTasks.map((t, i) => (
                  <div key={t.id} className="eb-gen-preview-item">
                    <span className="eb-gen-preview-round">第{i + 1}轮</span>
                    <span className="eb-gen-preview-date">{t.dueDate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="eb-modal-footer">
          <button type="button" className="eb-gen-btn eb-gen-btn--preview" onClick={() => setPreviewOpen(!previewOpen)}>
            📊 预览
          </button>
          <button type="button" className="eb-gen-btn" onClick={onClose}>取消</button>
          <button type="button" className="eb-gen-btn eb-gen-btn--primary" onClick={handleConfirm}>
            ✅ 确认生成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── 管理目录弹窗 ────────────────────────────────────────────
const ManageOutlineModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const store = useEbbStore();
  const nodes = store.outlineNodes;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<OutlineNodeType>('chapter');
  const [addTag, setAddTag] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBookName, setPasteBookName] = useState('');
  const [addBookOpen, setAddBookOpen] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookTag, setNewBookTag] = useState('');
  const [pasteBookTag, setPasteBookTag] = useState('');
  const [generateNode, setGenerateNode] = useState<StudyOutlineNode | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const rootNodes = useMemo(
    () => nodes.filter((n) => !n.parentId || !nodeMap.has(n.parentId)).sort((a, b) => a.orderIndex - b.orderIndex),
    [nodes, nodeMap],
  );

  const getChildren = useCallback(
    (parentId: string) => nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex),
    [nodes],
  );

  const getNodePath = useCallback((nodeId: string): string => {
    const path: string[] = [];
    let current = nodeMap.get(nodeId);
    while (current) {
      path.unshift(current.name);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
    return path.join(' > ');
  }, [nodeMap]);

  // 向上查找祖先书籍节点的默认标签
  const findBookDefaultTag = useCallback(
    (nodeId: string | null): string | undefined => {
      let current = nodeId ? nodeMap.get(nodeId) : null;
      while (current) {
        if (current.type === 'book') return current.defaultTag;
        current = current.parentId ? nodeMap.get(current.parentId) : null;
      }
      return undefined;
    },
    [nodeMap],
  );

  const handleAdd = useCallback(() => {
    if (!addName.trim() || !addParentId) return;
    const parentId = addParentId;
    const siblings = getChildren(parentId);
    const inheritedTag = addTag.trim() || findBookDefaultTag(parentId);
    const newNode: StudyOutlineNode = {
      id: genId('oln'),
      name: addName.trim(),
      type: addType,
      parentId,
      orderIndex: siblings.length,
      defaultTag: inheritedTag,
      childrenIds: [],
    };
    store.addOutlineNode(newNode);
    setAddName('');
    setAddTag('');
    setAddParentId(null);
  }, [addName, addType, addTag, addParentId, getChildren, store, findBookDefaultTag]);

  const handleAddBook = useCallback(() => {
    if (!newBookName.trim()) return;
    const newNode: StudyOutlineNode = {
      id: genId('oln'),
      name: newBookName.trim(),
      type: 'book',
      parentId: null,
      orderIndex: rootNodes.length,
      defaultTag: newBookTag.trim() || undefined,
      childrenIds: [],
    };
    store.addOutlineNode(newNode);
    setNewBookName('');
    setNewBookTag('');
    setAddBookOpen(false);
  }, [rootNodes.length, store, newBookName, newBookTag]);

  const handleStartEdit = useCallback((node: StudyOutlineNode) => {
    setEditingId(node.id);
    setEditName(node.name);
    setEditTag(node.defaultTag || '');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editName.trim()) return;
    store.updateOutlineNode(editingId, { name: editName.trim(), defaultTag: editTag.trim() || undefined });
    setEditingId(null);
  }, [editingId, editName, editTag, store]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm('确认删除该节点及其所有子节点？')) return;
    store.deleteOutlineNode(id);
  }, [store]);

  const handleGenerate = useCallback((nodeId: string, complexity: ComplexityLevel) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    const intervals = getIntervalsForComplexity(complexity, store.ebbSettings.complexityConfigs);
    const result = generateTasks(
      {
        topicName: node.name,
        tag: node.defaultTag,
        complexity,
        startDate: new Date().toISOString().slice(0, 10),
        intervals,
        outlineNodeId: nodeId,
      },
      store.reviewTasks,
      store.ebbSettings,
    );
    if (result.tasks.length > 0) store.addReviewTasks(result.tasks);
  }, [nodeMap, store]);

  // 粘贴目录解析
  const handlePasteImport = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return;

    const mdCount = lines.filter((l) => /^#+\s/.test(l.trim())).length;
    const isMarkdown = mdCount / lines.length > 0.5;

    let indentLevels: number[] = [];
    if (isMarkdown) {
      for (const line of lines) {
        const match = line.match(/^(#+)/);
        indentLevels.push(match ? match[1].length : 99);
      }
    } else {
      for (const line of lines) {
        const match = line.match(/^(\s*)/);
        indentLevels.push(match ? match[1].length : 0);
      }
    }

    const firstLineRaw = lines[0].trim();
    const firstLineClean = firstLineRaw.replace(/^#+\s*/, '').replace(/^[\s\d.\-•*]+/, '').trim();
    let bookName = pasteBookName.trim();
    let startIdx = 0;

    if (isMarkdown) {
      const firstHashCount = (lines[0].match(/^#+/) || [''])[0].length;
      if (!bookName && firstHashCount === 1) {
        bookName = firstLineClean || '未命名书籍';
        startIdx = 1;
      } else if (!bookName) {
        bookName = firstLineClean || '未命名书籍';
      }
    } else {
      const firstIndent = indentLevels[0];
      const looksLikeChapter = /第[一二三四五六七八九十百千\d]+[章节篇部回]/.test(firstLineRaw);
      if (!bookName && firstIndent === 0 && !looksLikeChapter) {
        bookName = firstLineClean || '未命名书籍';
        startIdx = 1;
      } else if (!bookName) {
        bookName = '未命名书籍';
      }
    }

    const contentIndentLevels = indentLevels.slice(startIdx);
    const uniqueIndents = [...new Set(contentIndentLevels.filter((v) => v < 99))].sort((a, b) => a - b);
    const indentMap = new Map(uniqueIndents.map((v, i) => [v, i]));

    const bookTag = pasteBookTag.trim() || undefined;
    const bookId = genId('oln');
    let orderIdx = 0;
    const newNodes: StudyOutlineNode[] = [
      { id: bookId, name: bookName, type: 'book', parentId: null, orderIndex: orderIdx++, defaultTag: bookTag, childrenIds: [] },
    ];

    const parentStack: { level: number; id: string }[] = [{ level: -1, id: bookId }];

    for (let i = startIdx; i < lines.length; i++) {
      const rawLine = lines[i];
      const rawLevel = indentLevels[i];
      if (rawLevel >= 99) continue;
      const level = indentMap.get(rawLevel) ?? 0;
      const cleanName = rawLine
        .replace(/^#+\s*/, '')
        .replace(/^[\s]*[\d]+[.\s、)]+/, '')
        .replace(/^[\s]*[•*\-–—]+\s*/, '')
        .replace(/^[\s]*Chapter\s*\d+\s*:?\s*/i, '')
        .trim();
      if (!cleanName) continue;
      const nodeType: OutlineNodeType = level === 0 ? 'chapter' : 'section';
      while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= level) {
        parentStack.pop();
      }
      const parentId = parentStack[parentStack.length - 1].id;
      const nodeId = genId('oln');
      newNodes.push({ id: nodeId, name: cleanName, type: nodeType, parentId, orderIndex: orderIdx++, defaultTag: bookTag, childrenIds: [] });
      parentStack.push({ level, id: nodeId });
    }

    if (newNodes.length > 1) {
      store.addOutlineNodes(newNodes);
    }
    setPasteOpen(false);
    setPasteText('');
    setPasteBookName('');
    setPasteBookTag('');
  }, [pasteText, pasteBookName, pasteBookTag, store]);

  // 递归渲染管理树
  const renderManageNode = (node: StudyOutlineNode, level: number): React.ReactNode => {
    const children = getChildren(node.id);
    return (
      <div key={node.id} className="eb-mng-node" style={{ paddingLeft: `${level * 16}px` }}>
        <div className="eb-mng-row">
          <span className="eb-mng-icon">{node.type === 'book' ? '📕' : node.type === 'chapter' ? '📗' : '📘'}</span>
          <span className={`eb-mng-type eb-mng-type--${node.type}`}>{node.type === 'book' ? '书' : node.type === 'chapter' ? '章' : '节'}</span>
          {editingId === node.id ? (
            <>
              <input className="eb-mng-edit" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
              <input className="eb-mng-edit eb-mng-edit--tag" value={editTag} onChange={(e) => setEditTag(e.target.value)} placeholder="标签" />
              <button type="button" className="eb-mng-btn" onClick={handleSaveEdit}>保存</button>
              <button type="button" className="eb-mng-btn" onClick={() => setEditingId(null)}>取消</button>
            </>
          ) : (
            <>
              <span className="eb-mng-name">{node.name}</span>
              {node.defaultTag && <span className="eb-mng-tag">{node.defaultTag}</span>}
              <div className="eb-mng-actions">
                {node.type === 'section' && (
                  <button
                    type="button"
                    className="eb-mng-btn eb-mng-btn--primary"
                    onClick={() => setGenerateNode(node)}
                  >
                    <Plus size={12} /> 生成任务
                  </button>
                )}
                <button type="button" className="eb-mng-btn" onClick={() => setAddParentId(node.id)}>+子节点</button>
                <button type="button" className="eb-mng-btn" onClick={() => handleStartEdit(node)}><Edit3 size={12} /></button>
                <button type="button" className="eb-mng-btn eb-mng-btn--danger" onClick={() => handleDelete(node.id)}><Trash2 size={12} /></button>
              </div>
            </>
          )}
        </div>
        {addParentId === node.id && (
          <div className="eb-mng-add">
            <select value={addType} onChange={(e) => setAddType(e.target.value as OutlineNodeType)}>
              <option value="chapter">章</option>
              <option value="section">节</option>
            </select>
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="名称" autoFocus />
            <input value={addTag} onChange={(e) => setAddTag(e.target.value)} placeholder={findBookDefaultTag(node.id) ? `标签（默认继承：${findBookDefaultTag(node.id)}）` : '标签（可选）'} />
            <button type="button" className="eb-mng-btn eb-mng-btn--primary" onClick={handleAdd}>添加</button>
            <button type="button" className="eb-mng-btn" onClick={() => { setAddParentId(null); setAddName(''); }}>取消</button>
          </div>
        )}
        {children.map((c) => renderManageNode(c, level + 1))}
      </div>
    );
  };

  return createPortal(
    <div className="eb-modal-overlay" onClick={onClose}>
      <div className="eb-modal eb-mng-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title">📚 管理学习目录</h3>
          <div className="eb-mng-toolbar">
            <button type="button" className="eb-mng-tool" onClick={() => setAddBookOpen(!addBookOpen)}><Plus size={13} /> 新书籍</button>
            <button type="button" className="eb-mng-tool" onClick={() => setPasteOpen(!pasteOpen)}><ClipboardPaste size={13} /> 粘贴目录</button>
            <button type="button" className="eb-modal-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="eb-modal-body">
          {addBookOpen && (
            <div className="eb-mng-add eb-mng-add--book">
              <span className="eb-mng-add-label">📕 新建书籍</span>
              <input
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                placeholder="书籍名称"
                className="eb-mng-edit eb-mng-edit--name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddBook();
                  if (e.key === 'Escape') { setAddBookOpen(false); setNewBookName(''); setNewBookTag(''); }
                }}
              />
              <input
                value={newBookTag}
                onChange={(e) => setNewBookTag(e.target.value)}
                placeholder="默认标签（可选，子节点会继承）"
                className="eb-mng-edit eb-mng-edit--tag"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddBook();
                  if (e.key === 'Escape') { setAddBookOpen(false); setNewBookName(''); setNewBookTag(''); }
                }}
              />
              <button type="button" className="eb-mng-btn eb-mng-btn--primary" onClick={handleAddBook}>添加</button>
              <button type="button" className="eb-mng-btn" onClick={() => { setAddBookOpen(false); setNewBookName(''); setNewBookTag(''); }}>取消</button>
            </div>
          )}
          {pasteOpen && (
            <div className="eb-mng-paste">
              <input
                value={pasteBookName}
                onChange={(e) => setPasteBookName(e.target.value)}
                placeholder="书籍名称（可选，留空取首行）"
                className="eb-mng-paste-name"
              />
              <input
                value={pasteBookTag}
                onChange={(e) => setPasteBookTag(e.target.value)}
                placeholder="默认标签（可选，子节点会继承）"
                className="eb-mng-paste-name"
              />
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'粘贴目录文本，支持 Markdown 标题（# 章节）或缩进格式\n例如：\n# 第一章\n## 第一节\n## 第二节'}
                rows={8}
                className="eb-mng-paste-text"
              />
              <div className="eb-mng-paste-actions">
                <button type="button" className="eb-mng-btn eb-mng-btn--primary" onClick={handlePasteImport}>解析并导入</button>
                <button type="button" className="eb-mng-btn" onClick={() => { setPasteOpen(false); setPasteText(''); }}>取消</button>
              </div>
            </div>
          )}
          {nodes.length === 0 ? (
            <div className="eb-empty">
              <p>暂无目录</p>
              <p className="eb-empty-hint">点击「新书籍」或「粘贴目录」开始</p>
            </div>
          ) : (
            <div className="eb-mng-tree">
              {rootNodes.map((n) => renderManageNode(n, 0))}
            </div>
          )}
        </div>
      </div>

      {generateNode && (
        <GenerateTaskModal
          node={generateNode}
          nodePath={getNodePath(generateNode.id)}
          settings={store.ebbSettings}
          onClose={() => setGenerateNode(null)}
        />
      )}
    </div>,
    document.body,
  );
};

export default DirectoryView;
