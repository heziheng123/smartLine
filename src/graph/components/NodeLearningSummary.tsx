import React from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Layers3,
  ListChecks,
  RotateCcw,
} from 'lucide-react';
import { formatDate, todayStr } from '@/utils/dateSafe';

export type NodeMasteryState = 'not-started' | 'learning' | 'needs-review' | 'mastered';
export type NodeDetailScope = 'direct' | 'subtree';

export interface NodeLearningSummaryData {
  masteryState: NodeMasteryState;
  masteryLabel: string;
  masteryReason: string;
  nodeCount: number;
  taskTotal: number;
  taskCompleted: number;
  reviewTotal: number;
  reviewCompleted: number;
  reviewPending: number;
  reviewOverdue: number;
  nextReviewDate?: string;
}

interface NodeLearningSummaryProps {
  data: NodeLearningSummaryData;
  scope: NodeDetailScope;
  canIncludeSubtree: boolean;
  onScopeChange: (scope: NodeDetailScope) => void;
}

const masteryTone: Record<NodeMasteryState, string> = {
  'not-started': 'border-slate-200 bg-slate-50 text-slate-600',
  learning: 'border-blue-200 bg-blue-50 text-blue-700',
  'needs-review': 'border-amber-200 bg-amber-50 text-amber-700',
  mastered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const progressWidth = (completed: number, total: number) =>
  total > 0 ? `${Math.min(100, Math.round((completed / total) * 100))}%` : '0%';

const nextReviewLabel = (date?: string) => {
  if (!date) return '暂无待复习';
  if (date === todayStr()) return '今天';
  return formatDate(date, 'M月D日');
};

const NodeLearningSummary: React.FC<NodeLearningSummaryProps> = ({
  data,
  scope,
  canIncludeSubtree,
  onScopeChange,
}) => (
  <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm" aria-label="学习状态总览">
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <BookOpenCheck size={14} className="text-indigo-500" />学习状态总览
      </div>
      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${masteryTone[data.masteryState]}`}>
        {data.masteryLabel}
      </span>
    </div>

    {canIncludeSubtree && (
      <div className="flex items-center justify-between gap-3 px-3 pt-3">
        <span className="flex items-center gap-1 text-[10px] font-medium text-slate-500">
          <Layers3 size={11} />统计范围
        </span>
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="节点统计范围">
          <button type="button" className={`rounded-md px-2 py-1 text-[10px] font-semibold ${scope === 'direct' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`} onClick={() => onScopeChange('direct')}>仅当前节点</button>
          <button type="button" className={`rounded-md px-2 py-1 text-[10px] font-semibold ${scope === 'subtree' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`} onClick={() => onScopeChange('subtree')}>包含子节点</button>
        </div>
      </div>
    )}

    <div className="grid grid-cols-2 gap-2 p-3">
      <div className="rounded-lg bg-slate-50 p-2.5">
        <div className="flex items-center gap-1 text-[10px] text-slate-500"><ListChecks size={11} />关联任务</div>
        <div className="mt-1 text-base font-bold text-slate-800">{data.taskTotal}</div>
        <div className="text-[10px] text-slate-500">已完成 {data.taskCompleted}/{data.taskTotal}</div>
      </div>
      <div className="rounded-lg bg-slate-50 p-2.5">
        <div className="flex items-center gap-1 text-[10px] text-slate-500"><RotateCcw size={11} />复习轮次</div>
        <div className="mt-1 text-base font-bold text-slate-800">{data.reviewCompleted}/{data.reviewTotal}</div>
        <div className="text-[10px] text-slate-500">待复习 {data.reviewPending}</div>
      </div>
      <div className={`rounded-lg p-2.5 ${data.reviewOverdue > 0 ? 'bg-rose-50' : 'bg-slate-50'}`}>
        <div className={`flex items-center gap-1 text-[10px] ${data.reviewOverdue > 0 ? 'text-rose-600' : 'text-slate-500'}`}><AlertTriangle size={11} />逾期复习</div>
        <div className={`mt-1 text-base font-bold ${data.reviewOverdue > 0 ? 'text-rose-600' : 'text-slate-800'}`}>{data.reviewOverdue}</div>
        <div className="text-[10px] text-slate-500">需要优先处理</div>
      </div>
      <div className="rounded-lg bg-slate-50 p-2.5">
        <div className="flex items-center gap-1 text-[10px] text-slate-500"><CalendarClock size={11} />下次复习</div>
        <div className="mt-1 truncate text-sm font-bold text-slate-800">{nextReviewLabel(data.nextReviewDate)}</div>
        <div className="text-[10px] text-slate-500">{data.nodeCount > 1 ? `汇总 ${data.nodeCount} 个节点` : '当前知识节点'}</div>
      </div>
    </div>

    <div className="space-y-2 px-3 pb-3">
      <div>
        <div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>任务完成</span><span>{data.taskCompleted}/{data.taskTotal}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: progressWidth(data.taskCompleted, data.taskTotal) }} /></div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>复习进度</span><span>{data.reviewCompleted}/{data.reviewTotal}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: progressWidth(data.reviewCompleted, data.reviewTotal) }} /></div>
      </div>
      <div className="flex gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-600">
        <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-slate-400" />
        <span>{data.masteryReason}</span>
      </div>
    </div>
  </section>
);

export default React.memo(NodeLearningSummary);
