import React, { useMemo, useState } from 'react';
import { BookOpenCheck, CheckCircle2, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import type {
  CompletedActivity,
  DailyRetrospective,
  RetrospectiveCategory,
  RetrospectiveEntry,
} from './retrospectiveTypes';
import type { GraphNode } from '@/graph/types';
import {
  buildOverallFromEntries,
  mergeRetrospectiveWithActivities,
} from '@/domain/dailyRetrospective';
import styles from './DailyRetrospectiveDialog.module.css';

interface DailyRetrospectiveDialogProps {
  date: string;
  activities: CompletedActivity[];
  graphNodes: GraphNode[];
  existing?: DailyRetrospective;
  onSave: (retrospective: DailyRetrospective) => void;
  onClose: () => void;
}

const typeLabel = (entry: RetrospectiveEntry) => {
  if (entry.sourceType === 'review') return `复习 ${entry.round ?? 1}/${entry.totalRounds ?? 1}`;
  if (entry.sourceType === 'quantity') return '数量任务';
  if (entry.sourceType === 'vocabulary') return '单词任务';
  if (entry.sourceType === 'free') return '生活安排';
  return '项目任务';
};

const hasReflection = (entry: RetrospectiveEntry) =>
  entry.reflection.content.trim().length > 0;

const categoryOptions: Array<{ value: RetrospectiveCategory; label: string }> = [
  { value: 'insight', label: '收获' },
  { value: 'problem', label: '问题' },
  { value: 'next-action', label: '下一步行动' },
];

const DailyRetrospectiveDialog: React.FC<DailyRetrospectiveDialogProps> = ({
  date,
  activities,
  graphNodes,
  existing,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState(() => mergeRetrospectiveWithActivities(date, activities, existing));
  const editableEntries = useMemo(
    () => draft.entries.filter((entry) => entry.completionSource !== 'project-task'),
    [draft.entries],
  );
  const linkedEntries = useMemo(
    () => draft.entries.filter((entry) => entry.completionSource === 'project-task'),
    [draft.entries],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [showOverall, setShowOverall] = useState(editableEntries.length === 0);
  const [showPending, setShowPending] = useState(false);
  const availableNodes = useMemo(
    () => graphNodes.filter((node) => !node.isArchived).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [graphNodes],
  );
  const pendingEntries = useMemo(
    () => editableEntries.filter((entry) => entry.nodeIds.length === 0),
    [editableEntries],
  );

  const persist = (next: DailyRetrospective) => {
    setDraft(next);
    onSave(next);
  };

  const updateEntry = (entryId: string, value: string) => {
    const now = new Date().toISOString();
    persist({
      ...draft,
      status: 'draft',
      finalizedAt: undefined,
      updatedAt: now,
      entries: draft.entries.map((entry) => entry.id === entryId
        ? { ...entry, reflection: { content: value }, updatedAt: now }
        : entry),
    });
  };

  const updateEntryMetadata = (
    entryId: string,
    update: (entry: RetrospectiveEntry) => RetrospectiveEntry,
  ) => {
    const now = new Date().toISOString();
    persist({
      ...draft,
      status: 'draft',
      finalizedAt: undefined,
      updatedAt: now,
      entries: draft.entries.map((entry) => entry.id === entryId
        ? { ...update(entry), updatedAt: now }
        : entry),
    });
  };

  const toggleCategory = (entryId: string, category: RetrospectiveCategory) => {
    updateEntryMetadata(entryId, (entry) => ({
      ...entry,
      categories: entry.categories.includes(category)
        ? entry.categories.filter((value) => value !== category)
        : [...entry.categories, category],
    }));
  };

  const addNode = (entryId: string, nodeId: string) => {
    const node = graphNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    updateEntryMetadata(entryId, (entry) => entry.nodeIds.includes(node.id)
      ? entry
      : {
        ...entry,
        nodeIds: [...entry.nodeIds, node.id],
        nodeSnapshots: [...entry.nodeSnapshots, { id: node.id, name: node.name }],
      });
  };

  const removeNode = (entryId: string, nodeId: string) => {
    updateEntryMetadata(entryId, (entry) => ({
      ...entry,
      nodeIds: entry.nodeIds.filter((id) => id !== nodeId),
      nodeSnapshots: entry.nodeSnapshots.filter((node) => node.id !== nodeId),
    }));
  };

  const updateOverall = (value: string) => {
    persist({
      ...draft,
      status: 'draft',
      finalizedAt: undefined,
      updatedAt: new Date().toISOString(),
      overall: { summary: value },
    });
  };

  const generateOverall = () => {
    persist({
      ...draft,
      status: 'draft',
      finalizedAt: undefined,
      updatedAt: new Date().toISOString(),
      overall: buildOverallFromEntries(draft.entries),
    });
  };

  const finalize = () => {
    const now = new Date().toISOString();
    const nextOverall = draft.overall.summary.trim()
      ? draft.overall
      : buildOverallFromEntries(draft.entries);
    onSave({ ...draft, overall: nextOverall, status: 'completed', updatedAt: now, finalizedAt: now });
    onClose();
  };

  const activeEntry = editableEntries[Math.min(activeIndex, Math.max(0, editableEntries.length - 1))];
  const reviewedCount = editableEntries.filter(hasReflection).length;
  const destinationIds = new Set(draft.entries.flatMap((entry) => entry.nodeIds));
  const unlinkedCount = editableEntries.filter((entry) => entry.nodeIds.length === 0).length;
  const progressPercent = editableEntries.length > 0
    ? Math.round((reviewedCount / editableEntries.length) * 100)
    : 100;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="每日复盘">
      <div className={styles.dialog}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <div className={styles.eyebrow}><BookOpenCheck size={15} />Daily reflection</div>
            <h1 className={styles.title}>把今天沉淀下来</h1>
            <div className={styles.date}>{date} · 每项写一句，就足够形成可回看的学习记录</div>
          </div>
          <div className={styles.headerStats} aria-label="复盘进度概览">
            <div className={styles.stat}><strong>{editableEntries.length}</strong><span>今日完成</span></div>
            <div className={styles.stat}><strong>{reviewedCount}</strong><span>已写复盘</span></div>
            <div className={styles.stat}><strong>{destinationIds.size}</strong><span>关联节点</span></div>
          </div>
          <button type="button" onClick={onClose} className={styles.close} aria-label="关闭每日复盘"><X size={18} /></button>
        </header>
        <div className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${progressPercent}%` }} /></div>

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarLabel}>复盘步骤</div>
            <button
              type="button"
              onClick={() => { setShowOverall(false); setShowPending(false); }}
              className={`${styles.sectionButton} ${!showOverall && !showPending ? styles.activeNav : ''}`}
            >
              <span>逐项复盘</span><span>{reviewedCount}/{editableEntries.length}</span>
            </button>
            <div>
              {editableEntries.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => { setActiveIndex(index); setShowOverall(false); setShowPending(false); }}
                  className={`${styles.entryButton} ${!showOverall && !showPending && index === activeIndex ? styles.activeNav : ''}`}
                >
                  <span className={`${styles.dot} ${hasReflection(entry) ? styles.dotDone : ''}`} />
                  <span className={styles.entryTitle}>{entry.title}</span>
                </button>
              ))}
            </div>
            <div className={styles.divider} />
            <button
              type="button"
              onClick={() => { setShowOverall(false); setShowPending(true); }}
              className={`${styles.sectionButton} ${showPending ? styles.activeNav : ''}`}
            >
              <span>待关联</span>
              <span className={styles.count}>{pendingEntries.length}</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowOverall(true); setShowPending(false); }}
              className={`${styles.sectionButton} ${showOverall && !showPending ? styles.activeNav : ''}`}
            >
              <span>总体复盘</span><Sparkles size={13} />
            </button>
          </aside>

          <main className={styles.main}>
            {showPending ? (
              <div className={styles.canvas}>
                <div className={styles.sectionIntro}>
                  <h2>补全知识关联</h2>
                  <p>把零散完成项放回知识体系。这里只更新历史复盘的关联，不会改动原任务。</p>
                </div>
                <div className={styles.pendingList}>
                  {pendingEntries.length === 0 && (
                    <div className={styles.emptyState}>当前没有待关联内容，全部内容都已找到归属。</div>
                  )}
                  {pendingEntries.map((entry) => (
                    <article key={entry.id} className={styles.pendingCard}>
                      <div className={styles.entryHeroTop}>
                        <h3>{entry.title}</h3>
                        <span className={styles.badge}>{typeLabel(entry)}</span>
                      </div>
                      <label>
                        <span className={styles.fieldLabel}>关联知识节点</span>
                        <select
                          value=""
                          onChange={(event) => addNode(entry.id, event.target.value)}
                          aria-label={`为${entry.title}选择知识节点`}
                          className={styles.nodeSelect}
                        >
                          <option value="">选择一个节点…</option>
                          {availableNodes.filter((node) => !entry.nodeIds.includes(node.id)).map((node) => (
                            <option key={node.id} value={node.id}>{node.name}</option>
                          ))}
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
              </div>
            ) : !showOverall && activeEntry ? (
              <div className={styles.canvas}>
                <div className={styles.entryHero}>
                  <div className={styles.entryHeroTop}>
                    <h2>{activeEntry.title}</h2>
                    <span className={styles.badge}>{typeLabel(activeEntry)}</span>
                    {activeEntry.completionStatusChanged && (
                      <span className={`${styles.badge} ${styles.dangerBadge}`}>任务完成状态已变化</span>
                    )}
                  </div>
                  <div className={styles.meta}>
                    {activeEntry.projectName && <span>{activeEntry.projectName} · </span>}
                    {activeEntry.quantityActual !== undefined && (
                      <span>今日完成 {activeEntry.quantityActual} {activeEntry.quantityUnit} · 总进度 {activeEntry.quantityCompleted}/{activeEntry.quantityTotal} {activeEntry.quantityUnit}</span>
                    )}
                  </div>
                  <div className={styles.nodeRow}>
                    {activeEntry.nodeSnapshots.length > 0
                      ? activeEntry.nodeSnapshots.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => removeNode(activeEntry.id, node.id)}
                          title="解除这条复盘与节点的关联"
                          className={styles.nodeChip}
                        >
                          {node.name} ×
                        </button>
                      ))
                      : <span className={styles.unlinked}>未绑定知识节点，内容仍会保留</span>}
                  </div>
                  {availableNodes.some((node) => !activeEntry.nodeIds.includes(node.id)) && (
                    <select
                      value=""
                      onChange={(event) => addNode(activeEntry.id, event.target.value)}
                      aria-label={`为${activeEntry.title}选择知识节点`}
                      className={styles.nodeSelect}
                    >
                      <option value="">添加知识节点…</option>
                      {availableNodes.filter((node) => !activeEntry.nodeIds.includes(node.id)).map((node) => (
                        <option key={node.id} value={node.id}>{node.name}</option>
                      ))}
                    </select>
                  )}
                  {linkedEntries.filter((entry) => entry.linkedProjectSourceId === activeEntry.sourceId).map((entry) => (
                    <div key={entry.id} className={styles.linkedNotice}>
                      同时联动完成：{entry.title}第 {entry.round ?? 1} 轮复习
                    </div>
                  ))}
                </div>
                <div className={styles.writingCard}>
                <label>
                  <span className={styles.fieldLabel}>今天这项任务，最值得记住什么？</span>
                  <textarea
                    aria-label="复盘内容"
                    value={activeEntry.reflection.content}
                    onChange={(event) => updateEntry(activeEntry.id, event.target.value)}
                    placeholder="写一句话就可以，例如：今天理解了核心概念，但应用还不够熟练。"
                    rows={6}
                    autoFocus
                    className={styles.editor}
                  />
                  <span className={styles.fieldHint}>输入会自动保存，并显示在关联知识节点的复盘记录中。</span>
                </label>
                <div className={styles.categoryArea}>
                  <div className={styles.fieldLabel}>这条记录属于什么？（可多选）</div>
                  <div className={styles.categoryRow}>
                    {categoryOptions.map((option) => {
                      const selected = activeEntry.categories.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleCategory(activeEntry.id, option.value)}
                          className={`${styles.category} ${selected ? styles.categorySelected : ''}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                </div>
              </div>
            ) : (
              <div className={styles.canvas}>
                <div className={styles.summaryHeader}>
                  <div className={styles.sectionIntro}>
                    <h2>形成今天的整体结论</h2>
                    <p>系统按逐项内容生成结构化汇总，你可以继续修改后再完成复盘。</p>
                  </div>
                  <button type="button" onClick={generateOverall} className={styles.summaryAction}><Sparkles size={14} />自动汇总</button>
                </div>
                <div className={styles.summaryCard}>
                  <label>
                    <span className={styles.fieldLabel}>今天最重要的收获、问题与下一步</span>
                    <textarea
                      aria-label="总体复盘"
                      value={draft.overall.summary}
                      onChange={(event) => updateOverall(event.target.value)}
                      placeholder="系统可以把每项的一句话汇总到这里，你也可以只写一句总体感受。"
                      rows={8}
                      className={`${styles.editor} ${styles.summaryEditor}`}
                    />
                  </label>
                  <div className={styles.summaryInfo}>
                    {linkedEntries.length > 0 && (
                      <div className={`${styles.infoBox} ${styles.infoBlue}`}>
                        {linkedEntries.length} 个复习轮次由项目任务自动联动完成，已作为关联结果保存，不会重复要求填写。
                      </div>
                    )}
                    <div className={styles.infoBox}>
                      将关联 {destinationIds.size} 个知识节点
                      {unlinkedCount > 0 && <> · {unlinkedCount} 项未绑定节点</>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className={styles.footer}>
          <span className={styles.autosave}>内容已自动保存为草稿</span>
          <div className={styles.footerActions}>
            {!showOverall && !showPending && (
              <>
                <button type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((value) => Math.max(0, value - 1))} className={styles.secondary}><ChevronLeft size={14} />上一项</button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeIndex >= editableEntries.length - 1) setShowOverall(true);
                    else setActiveIndex((value) => value + 1);
                  }}
                  className={styles.primary}
                >
                  {activeIndex >= editableEntries.length - 1 ? '进入总体复盘' : '下一项'}<ChevronRight size={14} />
                </button>
              </>
            )}
            {showOverall && !showPending && (
              <button type="button" onClick={finalize} className={styles.complete}><CheckCircle2 size={14} />完成复盘</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default DailyRetrospectiveDialog;
