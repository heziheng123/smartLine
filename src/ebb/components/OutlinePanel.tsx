// ============================================================
// Ebb - 大纲管理面板（Phase 3）
// 书籍/章节/知识点三级树形结构
// 增删改查 · 拖拽排序 · 关联复习任务 · 批量生成
// ============================================================

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Trash2, Edit3, ChevronRight, BookOpen,
  FolderOpen, FileText, Link2,
} from 'lucide-react';
import { useEbbStore } from '../store';
import { genId, generateTasks } from '../scheduler';
import { getIntervalsForComplexity } from '../complexity';
import { COMPLEXITY_LEVELS } from '../constants';
import type {
  StudyOutlineNode,
  OutlineNodeType,
  ReviewTask,
  ComplexityLevel,
} from '../types';

interface OutlinePanelProps {
  onClose: () => void;
  inline?: boolean;
}

const NODE_TYPE_ICONS: Record<OutlineNodeType, React.ReactNode> = {
  book: <BookOpen size={14} />,
  chapter: <FolderOpen size={14} />,
  section: <FileText size={14} />,
};

const NODE_TYPE_LABELS: Record<OutlineNodeType, string> = {
  book: '书籍',
  chapter: '章节',
  section: '知识点',
};

const OutlinePanel: React.FC<OutlinePanelProps> = ({ onClose, inline = false }) => {
  const store = useEbbStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [addActive, setAddActive] = useState(false);
  const [addType, setAddType] = useState<OutlineNodeType>('chapter');
  const [addName, setAddName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [linkingMode, setLinkingMode] = useState(false);

  // 粘贴目录导入
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBookName, setPasteBookName] = useState('');
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [genComplexity, setGenComplexity] = useState<ComplexityLevel>('normal');
  const addInputRef = useRef<HTMLInputElement>(null);

  const nodes = store.outlineNodes;

  // 构建树结构
  const rootNodes = useMemo(() => {
    const nodeMap = new Map<string, StudyOutlineNode>();
    for (const n of nodes) nodeMap.set(n.id, n);
    // 顶层节点：无父节点或父节点不存在
    return nodes
      .filter((n) => !n.parentId || !nodeMap.has(n.parentId))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [nodes]);

  // 获取子节点
  const getChildren = useCallback(
    (parentId: string) =>
      nodes
        .filter((n) => n.parentId === parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [nodes],
  );

  // 获取节点关联的复习任务
  const getLinkedTasks = useCallback(
    (nodeId: string) => store.reviewTasks.filter((t) => t.outlineNodeId === nodeId),
    [store.reviewTasks],
  );

  // 展开/折叠
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 开始编辑名称
  const startEdit = useCallback((node: StudyOutlineNode) => {
    setEditingId(node.id);
    setEditName(node.name);
  }, []);

  // 保存编辑
  const saveEdit = useCallback(() => {
    if (editingId && editName.trim()) {
      store.updateOutlineNode(editingId, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName('');
  }, [editingId, editName, store]);

  // 添加子节点
  const startAdd = useCallback(
    (parentId: string | null, type: OutlineNodeType) => {
      setAddParentId(parentId);
      setAddActive(true);
      setAddType(type);
      setAddName('');
      setTimeout(() => addInputRef.current?.focus(), 50);
    },
    [],
  );

  const confirmAdd = useCallback(() => {
    if (!addName.trim()) return;
    const parentId = addParentId;
    const siblings = parentId ? getChildren(parentId) : rootNodes;
    const newNode: StudyOutlineNode = {
      id: genId('oln'),
      type: addType,
      name: addName.trim(),
      parentId,
      childrenIds: [],
      orderIndex: siblings.length,
      defaultTag: undefined,
    };
    store.addOutlineNode(newNode);
    // 展开父节点
    if (parentId) {
      setExpandedIds((prev) => new Set(prev).add(parentId));
    }
    setAddName('');
    addInputRef.current?.focus();
  }, [addName, addParentId, addType, getChildren, rootNodes, store]);

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      confirmAdd();
    } else if (e.key === 'Escape') {
      setAddActive(false);
      setAddName('');
    }
  };

  // 删除节点
  const handleDelete = useCallback(
    (id: string) => {
      store.deleteOutlineNode(id);
      setConfirmDeleteId(null);
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [store, selectedNodeId],
  );

  // 移动节点（上移/下移）
  const moveNode = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const siblings = node.parentId
        ? getChildren(node.parentId)
        : rootNodes;
      const idx = siblings.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= siblings.length) return;
      // 交换 orderIndex
      store.updateOutlineNode(id, { orderIndex: siblings[targetIdx].orderIndex });
      store.updateOutlineNode(siblings[targetIdx].id, { orderIndex: siblings[idx].orderIndex });
    },
    [nodes, getChildren, rootNodes, store],
  );

  // 为知识点生成复习任务
  const handleGenerateTasks = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const intervals = getIntervalsForComplexity(genComplexity, store.ebbSettings.complexityConfigs);
      try {
        const result = generateTasks(
          {
            topicName: node.name,
            tag: node.defaultTag,
            complexity: genComplexity,
            startDate: new Date().toISOString().slice(0, 10),
            intervals,
            outlineNodeId: nodeId,
          },
          store.reviewTasks,
          store.ebbSettings,
        );
        if (result.tasks.length > 0) {
          store.addReviewTasks(result.tasks);
        }
      } catch (e) {
        console.error('生成复习任务失败:', e);
      }
    },
    [nodes, genComplexity, store],
  );

  // 解析粘贴的目录文本为大纲节点
  const handlePasteImport = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;

    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return;

    // 检测是否为 Markdown 标题格式（多数行以 # 开头）
    const mdCount = lines.filter((l) => /^#+\s/.test(l.trim())).length;
    const isMarkdown = mdCount / lines.length > 0.5;

    let indentLevels: number[] = [];

    if (isMarkdown) {
      // Markdown 模式：用 # 数量作为层级
      for (const line of lines) {
        const match = line.match(/^(#+)/);
        indentLevels.push(match ? match[1].length : 99);
      }
    } else {
      // 缩进模式：计算每行前导空白
      for (const line of lines) {
        const match = line.match(/^(\s*)/);
        indentLevels.push(match ? match[1].length : 0);
      }
    }

    // 归一化缩进层级（0, 1, 2...）
    const uniqueIndents = [...new Set(indentLevels.filter((v) => v < 99))].sort((a, b) => a - b);
    const indentMap = new Map(uniqueIndents.map((v, i) => [v, i]));

    // 书籍节点
    const bookId = genId('oln');
    const bookName = pasteBookName.trim() || lines[0].replace(/^[\s\d.\-•*#]+/, '').trim() || '未命名书籍';
    let orderIdx = 0;
    const newNodes: import('../types').StudyOutlineNode[] = [
      {
        id: bookId,
        name: bookName,
        type: 'book',
        parentId: null,
        orderIndex: orderIdx++,
        defaultTag: '',
        childrenIds: [],
      },
    ];

    // 用栈追踪当前路径的父节点
    const parentStack: { level: number; id: string }[] = [{ level: -1, id: bookId }];

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const rawLevel = indentLevels[i];
      if (rawLevel >= 99) continue;
      const level = indentMap.get(rawLevel) ?? 0;
      // 清理行：移除序号、项目符号、Markdown #
      const cleanName = rawLine
        .replace(/^#+\s*/, '')                          // "# " / "## "
        .replace(/^[\s]*[\d]+[.\s、)]+/, '')           // "1. " / "1、" / "1) "
        .replace(/^[\s]*[•*\-–—]+\s*/, '')              // "• " / "* " / "- "
        .replace(/^[\s]*第[一二三四五六七八九十百千\d]+[章节篇部回]\s*/, '') // "第一章 "
        .replace(/^[\s]*Chapter\s*\d+\s*:?\s*/i, '')    // "Chapter 1:"
        .trim();

      if (!cleanName) continue;

      // 确定节点类型
      const nodeType: OutlineNodeType = level === 0 ? 'chapter' : 'section';

      // 找到父节点：栈中 level < 当前 level 的最后一个
      while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= level) {
        parentStack.pop();
      }
      const parentId = parentStack[parentStack.length - 1].id;

      const nodeId = genId('oln');
      newNodes.push({
        id: nodeId,
        name: cleanName,
        type: nodeType,
        parentId,
        orderIndex: orderIdx++,
        defaultTag: '',
        childrenIds: [],
      });

      parentStack.push({ level, id: nodeId });
    }

    if (newNodes.length > 1) {
      store.addOutlineNodes(newNodes);
      // 展开书籍节点
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(bookId);
        return next;
      });
    }

    setPasteOpen(false);
    setPasteText('');
    setPasteBookName('');
  }, [pasteText, pasteBookName, store]);

  // 选中节点查看详情
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [selectedNodeId, nodes],
  );

  const selectedLinkedTasks = useMemo(
    () => (selectedNodeId ? getLinkedTasks(selectedNodeId) : []),
    [selectedNodeId, getLinkedTasks],
  );

  // 递归渲染树节点
  const renderNode = (node: StudyOutlineNode, depth: number = 0) => {
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isEditing = editingId === node.id;
    const isAdding = addActive && addParentId === node.id;
    const linkedTasks = getLinkedTasks(node.id);
    const isSelected = selectedNodeId === node.id;

    return (
      <div key={node.id} className="eb-outline-node-wrap">
        <div
          className={[
            'eb-outline-node',
            isSelected ? 'eb-outline-node--selected' : '',
            isEditing ? 'eb-outline-node--editing' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: depth * 20 + 8 }}
        >
          {/* 展开/折叠箭头 */}
          {hasChildren ? (
            <button
              type="button"
              className={`eb-outline-caret ${isExpanded ? 'eb-outline-caret--expanded' : ''}`}
              onClick={() => toggleExpand(node.id)}
            >
              <ChevronRight size={14} />
            </button>
          ) : (
            <span className="eb-outline-caret-placeholder" />
          )}

          {/* 类型图标 */}
          <span className="eb-outline-icon">{NODE_TYPE_ICONS[node.type]}</span>

          {/* 名称（编辑态/显示态） */}
          {isEditing ? (
            <input
              type="text"
              className="eb-outline-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') {
                  setEditingId(null);
                  setEditName('');
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="eb-outline-name"
              onClick={() => setSelectedNodeId(node.id)}
              onDoubleClick={() => startEdit(node)}
            >
              {node.name}
            </span>
          )}

          {/* 关联任务数 */}
          {linkedTasks.length > 0 && (
            <span className="eb-outline-task-count" title={`${linkedTasks.length} 个复习任务`}>
              {linkedTasks.length}
            </span>
          )}

          {/* 操作按钮 */}
          <div className="eb-outline-node-actions">
            {node.type !== 'section' && (
              <button
                type="button"
                className="eb-icon-btn"
                onClick={() => startAdd(node.id, node.type === 'book' ? 'chapter' : 'section')}
                title={`添加${node.type === 'book' ? '章节' : '知识点'}`}
              >
                <Plus size={13} />
              </button>
            )}
            <button
              type="button"
              className="eb-icon-btn"
              onClick={() => startEdit(node)}
              title="重命名"
            >
              <Edit3 size={13} />
            </button>
            {node.type === 'section' && (
              <button
                type="button"
                className="eb-icon-btn"
                onClick={() => handleGenerateTasks(node.id)}
                title="生成复习任务"
              >
                <Link2 size={13} />
              </button>
            )}
            <button
              type="button"
              className={`eb-icon-btn eb-icon-btn--danger ${confirmDeleteId === node.id ? 'eb-icon-btn--confirm' : ''}`}
              onClick={() => {
                if (confirmDeleteId === node.id) {
                  handleDelete(node.id);
                } else {
                  setConfirmDeleteId(node.id);
                  setTimeout(() => setConfirmDeleteId(null), 2500);
                }
              }}
              title={confirmDeleteId === node.id ? '再次确认删除（含子节点）' : '删除'}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* 子节点 */}
        {hasChildren && isExpanded && (
          <div className="eb-outline-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}

        {/* 添加子节点输入框 */}
        {isAdding && (
          <div className="eb-outline-add-row" style={{ paddingLeft: (depth + 1) * 20 + 8 }}>
            <span className="eb-outline-icon">{NODE_TYPE_ICONS[addType]}</span>
            <input
              ref={addInputRef}
              type="text"
              className="eb-outline-name-input"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder={`${NODE_TYPE_LABELS[addType]}名称...`}
              autoFocus
            />
          </div>
        )}
      </div>
    );
  };

  const content = (
    <div className={inline ? 'eb-inline-panel' : 'eb-panel eb-panel--outline'} onClick={inline ? undefined : undefined}>
      <div className="eb-panel-header">
        <h3 className="eb-panel-title">学习大纲</h3>
        <button type="button" className="eb-panel-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

        <div className="eb-panel-body">
          {/* 顶部添加根节点 */}
          <div className="eb-outline-toolbar">
            <button
              type="button"
              className="eb-btn eb-btn--secondary eb-btn--sm"
              onClick={() => startAdd(null, 'book')}
            >
              <Plus size={14} />
              添加书籍
            </button>
            <button
              type="button"
              className="eb-btn eb-btn--ghost eb-btn--sm"
              onClick={() => {
                setPasteOpen(!pasteOpen);
                if (!pasteOpen) setTimeout(() => pasteRef.current?.focus(), 50);
              }}
            >
              粘贴目录
            </button>
            <span className="eb-outline-summary">
              {nodes.length} 个节点 · {new Set(nodes.filter((n) => n.type === 'section').map((n) => n.id))
                .size} 个知识点
            </span>
          </div>

          {/* 粘贴目录导入区 */}
          {pasteOpen && (
            <div className="eb-paste-import">
              <input
                type="text"
                className="eb-field-input"
                value={pasteBookName}
                onChange={(e) => setPasteBookName(e.target.value)}
                placeholder="书籍名称（可选，默认取首行）"
              />
              <textarea
                ref={pasteRef}
                className="eb-paste-textarea"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`粘贴目录文本，支持缩进识别层级，例如：\n\n第一章 绪论\n  1.1 研究背景\n  1.2 研究意义\n第二章 文献综述\n  2.1 国内研究\n  2.2 国外研究`}
                rows={8}
              />
              <div className="eb-paste-actions">
                <span className="eb-paste-hint">通过缩进自动识别章节/知识点层级</span>
                <button
                  type="button"
                  className="eb-btn eb-btn--ghost eb-btn--sm"
                  onClick={() => { setPasteOpen(false); setPasteText(''); setPasteBookName(''); }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="eb-btn eb-btn--primary eb-btn--sm"
                  onClick={handlePasteImport}
                  disabled={!pasteText.trim()}
                >
                  导入
                </button>
              </div>
            </div>
          )}

          {/* 树形结构 */}
          <div className="eb-outline-tree">
            {rootNodes.length === 0 && !addActive ? (
              <div className="eb-outline-empty">
                <div className="eb-outline-empty-icon">📚</div>
                <div className="eb-outline-empty-text">
                  暂无大纲，点击「添加书籍」开始构建知识体系
                </div>
              </div>
            ) : (
              rootNodes.map((node) => renderNode(node))
            )}

            {/* 添加根节点输入框 */}
            {addActive && addParentId === null && addType === 'book' && (
              <div className="eb-outline-add-row" style={{ paddingLeft: 8 }}>
                <span className="eb-outline-icon">{NODE_TYPE_ICONS.book}</span>
                <input
                  ref={addInputRef}
                  type="text"
                  className="eb-outline-name-input"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={handleAddKeyDown}
                  placeholder="书籍名称..."
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* 选中节点详情 */}
          {selectedNode && (
            <div className="eb-outline-detail">
              <div className="eb-outline-detail-header">
                <span className="eb-outline-detail-type">
                  {NODE_TYPE_LABELS[selectedNode.type]}
                </span>
                <span className="eb-outline-detail-name">{selectedNode.name}</span>
              </div>

              {/* 默认标签 */}
              <div className="eb-outline-detail-tag">
                <label>默认标签</label>
                <input
                  type="text"
                  className="eb-outline-tag-input"
                  value={selectedNode.defaultTag}
                  placeholder="如：考研政治"
                  onChange={(e) => store.updateOutlineNode(selectedNode.id, { defaultTag: e.target.value })}
                />
              </div>

              {/* 关联的复习任务 */}
              <div className="eb-outline-detail-tasks">
                <h5 className="eb-outline-detail-tasks-title">
                  关联复习任务（{selectedLinkedTasks.length}）
                </h5>
                {selectedLinkedTasks.length === 0 ? (
                  <div className="eb-outline-detail-tasks-empty">
                    暂无关联复习任务
                  {selectedNode.type === 'section' && (
                    <>
                      <div className="eb-complexity-switch eb-complexity-switch--sm" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                        {COMPLEXITY_LEVELS.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`eb-complexity-btn eb-complexity-btn--sm ${genComplexity === level ? 'eb-complexity-btn--active' : ''}`}
                            onClick={() => setGenComplexity(level)}
                          >
                            {store.ebbSettings.complexityConfigs[level].label.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="eb-text-btn"
                        onClick={() => handleGenerateTasks(selectedNode.id)}
                      >
                        生成复习任务
                      </button>
                    </>
                  )}
                  </div>
                ) : (
                  <div className="eb-outline-detail-task-list">
                    {selectedLinkedTasks.map((t) => {
                      const dateLabel = (() => {
                        const d = new Date(t.dueDate);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      })();
                      return (
                        <div key={t.id} className="eb-outline-detail-task">
                          <input
                            type="checkbox"
                            checked={t.isCompleted}
                            onChange={() => store.toggleReviewTask(t.id)}
                            className="eb-round-check"
                          />
                          <span className={`eb-outline-task-name ${t.isCompleted ? 'eb-outline-task-name--done' : ''}`}>
                            {t.topicName}
                          </span>
                          <span className="eb-outline-task-date">{dateLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 上下移动 + 生成任务 */}
              <div className="eb-outline-detail-actions">
                <button
                  type="button"
                  className="eb-btn eb-btn--ghost eb-btn--sm"
                  onClick={() => moveNode(selectedNode.id, 'up')}
                >
                  ↑ 上移
                </button>
                <button
                  type="button"
                  className="eb-btn eb-btn--ghost eb-btn--sm"
                  onClick={() => moveNode(selectedNode.id, 'down')}
                >
                  ↓ 下移
                </button>
                {selectedNode.type === 'section' && selectedLinkedTasks.length === 0 && (
                  <>
                    <div className="eb-complexity-switch eb-complexity-switch--sm">
                      {COMPLEXITY_LEVELS.map((level) => (
                        <button
                          key={level}
                          type="button"
                          className={`eb-complexity-btn eb-complexity-btn--sm ${genComplexity === level ? 'eb-complexity-btn--active' : ''}`}
                          onClick={() => setGenComplexity(level)}
                        >
                          {store.ebbSettings.complexityConfigs[level].label.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="eb-btn eb-btn--secondary eb-btn--sm"
                      onClick={() => handleGenerateTasks(selectedNode.id)}
                    >
                      <Link2 size={13} />
                      生成复习任务
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="eb-panel-footer">
          <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>
            关闭
          </button>
        </div>
    </div>
  );

  if (inline) return content;

  return createPortal(
    <div className="eb-panel-overlay" onClick={onClose}>
      {content}
    </div>,
    document.body,
  );
};

export default OutlinePanel;
