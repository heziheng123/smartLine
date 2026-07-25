import React, { useMemo, useState } from 'react';
import { BookOpenCheck, ChevronDown, ChevronUp } from 'lucide-react';
import type { RetrospectiveEntry } from '@/components/dailySchedule/retrospectiveTypes';

interface NodeRetrospectiveRecordsProps {
  entries: RetrospectiveEntry[];
}

const sourceLabel = (entry: RetrospectiveEntry) => {
  if (entry.sourceType === 'review') return `复习 ${entry.round ?? 1}/${entry.totalRounds ?? 1}`;
  if (entry.sourceType === 'quantity') return '数量任务';
  if (entry.sourceType === 'vocabulary') return '单词任务';
  return '项目任务';
};

type RecordFilter = 'all' | 'project' | 'review' | 'insight' | 'problem' | 'next-action';

const filterOptions: Array<{ value: RecordFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'project', label: '项目任务' },
  { value: 'review', label: '复习任务' },
  { value: 'insight', label: '收获' },
  { value: 'problem', label: '问题' },
  { value: 'next-action', label: '下一步行动' },
];

const NodeRetrospectiveRecords: React.FC<NodeRetrospectiveRecordsProps> = ({ entries }) => {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<RecordFilter>('all');
  const sorted = useMemo(
    () => entries
      .filter((entry) => entry.completionSource !== 'project-task')
      .filter((entry) => {
        if (filter === 'all') return true;
        if (filter === 'project') return entry.sourceType !== 'review' && entry.sourceType !== 'free';
        if (filter === 'review') return entry.sourceType === 'review';
        return (entry.categories ?? []).includes(filter);
      })
      .sort((left, right) => right.completedDate.localeCompare(left.completedDate)),
    [entries, filter],
  );
  const visible = expanded ? sorted : sorted.slice(0, 5);

  return (
    <section className="space-y-2" aria-label="复盘记录">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-slate-400/80">
          <BookOpenCheck size={12} className="text-indigo-500" />
          节点纲要 · 复盘内容
          <span className="font-medium text-slate-400">{sorted.length}</span>
        </div>
        {sorted.length > 5 && (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
            {expanded ? <>收起<ChevronUp size={11} /></> : <>全部<ChevronDown size={11} /></>}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="复盘记录筛选">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => { setFilter(option.value); setExpanded(false); }}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${filter === option.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {visible.length === 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">当前筛选条件下暂无复盘记录</div>
        )}
        {visible.map((entry) => (
          <article key={entry.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-800">{entry.title}</div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {entry.completedDate} · {sourceLabel(entry)}
                  {entry.projectName ? ` · ${entry.projectName}` : ''}
                </div>
              </div>
              {entry.nodeIds.length > 1 && (
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-semibold text-indigo-600">
                  关联{entry.nodeIds.length}节点
                </span>
              )}
            </div>
            {entry.completionStatusChanged && (
              <div className="mt-2 inline-flex rounded-full bg-rose-50 px-2 py-1 text-[9px] font-semibold text-rose-700">
                任务完成状态已变化
              </div>
            )}
            {entry.quantityActual !== undefined && (
              <div className="mt-2 text-[10px] text-slate-500">
                今日完成 {entry.quantityActual} {entry.quantityUnit} · 总进度 {entry.quantityCompleted}/{entry.quantityTotal} {entry.quantityUnit}
              </div>
            )}
            <div className="mt-2 text-[11px] leading-5 text-slate-600">
              {entry.reflection.content
                ? <p>{entry.reflection.content}</p>
                : (
                <p className="text-slate-400">该任务已记录完成，尚未填写具体复盘内容。</p>
                )}
            </div>
            {(entry.categories ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(entry.categories ?? []).map((category) => (
                  <span key={category} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] text-indigo-600">
                    {category === 'insight' ? '收获' : category === 'problem' ? '问题' : '下一步行动'}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default React.memo(NodeRetrospectiveRecords);
