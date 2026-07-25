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

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-label="每日复盘">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <BookOpenCheck size={18} className="text-indigo-600" />每日复盘
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {date} · 已完成 {editableEntries.length} 项 · 已复盘 {reviewedCount}/{editableEntries.length}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭每日复盘"><X size={18} /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[230px_1fr]">
          <aside className="overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-3 md:border-b-0 md:border-r">
            <button
              type="button"
              onClick={() => { setShowOverall(false); setShowPending(false); }}
              className={`mb-2 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${!showOverall && !showPending ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-white'}`}
            >
              逐项复盘
            </button>
            <div className="space-y-1">
              {editableEntries.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => { setActiveIndex(index); setShowOverall(false); setShowPending(false); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${!showOverall && !showPending && index === activeIndex ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white'}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${hasReflection(entry) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="truncate">{entry.title}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setShowOverall(false); setShowPending(true); }}
              className={`mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold ${showPending ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-white'}`}
            >
              <span>待关联</span>
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px]">{pendingEntries.length}</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowOverall(true); setShowPending(false); }}
              className={`mt-2 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${showOverall && !showPending ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-white'}`}
            >
              总体复盘
            </button>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5 md:p-6">
            {showPending ? (
              <div className="mx-auto max-w-2xl">
                <h2 className="text-lg font-bold text-slate-900">待关联</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">为未绑定内容选择知识节点。这里只调整这条历史复盘的关联，不会改动原任务。</p>
                <div className="mt-5 space-y-3">
                  {pendingEntries.length === 0 && (
                    <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">当前没有待关联内容。</div>
                  )}
                  {pendingEntries.map((entry) => (
                    <article key={entry.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-800">{entry.title}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{typeLabel(entry)}</span>
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[11px] font-semibold text-slate-600">关联知识节点</span>
                        <select
                          value=""
                          onChange={(event) => addNode(entry.id, event.target.value)}
                          aria-label={`为${entry.title}选择知识节点`}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
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
              <div className="mx-auto max-w-2xl">
                <div className="mb-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900">{activeEntry.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{typeLabel(activeEntry)}</span>
                    {activeEntry.completionStatusChanged && (
                      <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">任务完成状态已变化</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {activeEntry.projectName && <span>{activeEntry.projectName} · </span>}
                    {activeEntry.quantityActual !== undefined && (
                      <span>今日完成 {activeEntry.quantityActual} {activeEntry.quantityUnit} · 总进度 {activeEntry.quantityCompleted}/{activeEntry.quantityTotal} {activeEntry.quantityUnit}</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeEntry.nodeSnapshots.length > 0
                      ? activeEntry.nodeSnapshots.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => removeNode(activeEntry.id, node.id)}
                          title="解除这条复盘与节点的关联"
                          className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] text-indigo-700"
                        >
                          {node.name} ×
                        </button>
                      ))
                      : <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-700">未绑定知识节点，内容仍会保留</span>}
                  </div>
                  {availableNodes.some((node) => !activeEntry.nodeIds.includes(node.id)) && (
                    <select
                      value=""
                      onChange={(event) => addNode(activeEntry.id, event.target.value)}
                      aria-label={`为${activeEntry.title}选择知识节点`}
                      className="mt-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
                    >
                      <option value="">添加知识节点…</option>
                      {availableNodes.filter((node) => !activeEntry.nodeIds.includes(node.id)).map((node) => (
                        <option key={node.id} value={node.id}>{node.name}</option>
                      ))}
                    </select>
                  )}
                  {linkedEntries.filter((entry) => entry.linkedProjectSourceId === activeEntry.sourceId).map((entry) => (
                    <div key={entry.id} className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      同时联动完成：{entry.title}第 {entry.round ?? 1} 轮复习
                    </div>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">复盘内容</span>
                  <textarea
                    value={activeEntry.reflection.content}
                    onChange={(event) => updateEntry(activeEntry.id, event.target.value)}
                    placeholder="写一句话就可以，例如：今天理解了核心概念，但应用还不够熟练。"
                    rows={6}
                    autoFocus
                    className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                  <span className="mt-2 block text-[11px] text-slate-400">保存后会显示在上方关联知识节点的节点纲要中。</span>
                </label>
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-700">内容分类（可多选）</div>
                  <div className="flex flex-wrap gap-2">
                    {categoryOptions.map((option) => {
                      const selected = activeEntry.categories.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleCategory(activeEntry.id, option.value)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">总体复盘</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">系统按逐项内容生成结构化汇总，你可以继续修改后再完成复盘。</p>
                  </div>
                  <button type="button" onClick={generateOverall} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"><Sparkles size={14} />自动汇总</button>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">总体复盘</span>
                  <textarea
                    value={draft.overall.summary}
                    onChange={(event) => updateOverall(event.target.value)}
                    placeholder="系统可以把每项的一句话汇总到这里，你也可以只写一句总体感受。"
                    rows={8}
                    className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                {linkedEntries.length > 0 && (
                  <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                    {linkedEntries.length} 个复习轮次由项目任务自动联动完成，已作为关联结果保存，不会重复要求填写。
                  </div>
                )}
                <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                  将关联 {destinationIds.size} 个知识节点
                  {unlinkedCount > 0 && <> · {unlinkedCount} 项未绑定节点</>}
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-[11px] text-slate-500">内容已自动保存为草稿</span>
          <div className="flex items-center gap-2">
            {!showOverall && !showPending && (
              <>
                <button type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((value) => Math.max(0, value - 1))} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40"><ChevronLeft size={14} />上一项</button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeIndex >= editableEntries.length - 1) setShowOverall(true);
                    else setActiveIndex((value) => value + 1);
                  }}
                  className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                >
                  {activeIndex >= editableEntries.length - 1 ? '进入总体复盘' : '下一项'}<ChevronRight size={14} />
                </button>
              </>
            )}
            {showOverall && !showPending && (
              <button type="button" onClick={finalize} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"><CheckCircle2 size={14} />完成复盘</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default DailyRetrospectiveDialog;
