import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { useOperationHistory } from '@/services/operationHistory';
import { useRecycleBin, type RecycledTask } from '@/services/recycleBin';
import { useTimelineStore } from '@/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { registerUndoExecutor, runWithoutOperationRecording } from '@/services/operationHistory';
import { getUniqueTasks } from '@/store/timelineData';

const timeLabel = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const restoreRecycledTask = (item: RecycledTask) => {
  const timeline = useTimelineStore.getState();
  if (getUniqueTasks(timeline.tasks, timeline.groups).some((task) => task.id === item.task.id)) return '同一任务已经存在，未覆盖当前数据';
  runWithoutOperationRecording(() => useTimelineStore.getState().restoreTask(item.task, item.groupId));
  if (item.placements?.length) useDailyScheduleStore.setState((state) => {
    const schedules = { ...state.schedules };
    for (const placement of item.placements ?? []) {
      const day = schedules[placement.date] ?? { date: placement.date, items: [], blocks: [] };
      schedules[placement.date] = {
        ...day,
        items: [...day.items.filter((existing) => !placement.items.some((saved) => saved.id === existing.id)), ...placement.items],
        blocks: [...day.blocks.filter((existing) => !placement.blocks.some((saved) => saved.id === existing.id)), ...placement.blocks],
      };
    }
    return { schedules };
  });
  useRecycleBin.getState().remove(item.id);
};
registerUndoExecutor('restore-recycled', (raw) => {
  const { recycledId } = raw as { recycledId: string };
  const item = useRecycleBin.getState().items.find((candidate) => candidate.id === recycledId);
  if (!item) return '回收站中的任务已经不存在';
  return restoreRecycledTask(item);
});
export default function OperationHistoryPanel() {
  const { entries, panelOpen, setPanelOpen, undo, dismiss, clear } = useOperationHistory();
  const { items: recycledItems, remove: removeRecycled, clear: clearRecycled } = useRecycleBin();
  return <>
    {panelOpen && <aside className="operation-history-panel" aria-label="最近操作面板">
      <header><div><History size={18} /><strong>最近操作</strong></div><button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭最近操作"><X size={18} /></button></header>
      <div className="operation-history-list">{entries.length === 0 ? <div className="operation-history-empty">暂无可撤销操作</div> : entries.map((entry) => <article key={entry.id}>
        <div className="operation-history-row"><strong>{entry.label}</strong><time>{timeLabel(entry.createdAt)}</time></div>
                <p>{entry.detail}</p>{entry.error && <p className="operation-history-error">撤销失败：{entry.error}</p>}<div className="operation-history-modules">{entry.modules.join('、')}</div>
        <div className="operation-history-item-actions">{entry.canUndo && <button type="button" onClick={() => void undo(entry.id)}><RotateCcw size={14} />撤销</button>}<button type="button" onClick={() => dismiss(entry.id)}><X size={14} />移除记录</button></div>
      </article>)}</div>
      <div className="operation-history-trash-title"><Trash2 size={15} /><strong>回收站</strong><span>保留 30 天</span></div>
      <div className="operation-history-list operation-history-trash">
        {recycledItems.length === 0 ? <div className="operation-history-empty">回收站为空</div> : recycledItems.map((item) => <article key={item.id}>
          <div className="operation-history-row"><strong>{item.task.name}</strong><time>{timeLabel(item.deletedAt)}</time></div>
          <p>{item.groupId ? '原位于项目分组中' : '原为独立项目'}，恢复时保留原 ID、内容和节点绑定。</p>
          <div className="operation-history-item-actions">
            <button type="button" onClick={() => restoreRecycledTask(item)}>恢复</button>
            <button type="button" onClick={() => removeRecycled(item.id)}>永久删除</button>
          </div>
        </article>)}
      </div>
      {(entries.length > 0 || recycledItems.length > 0) && <footer>{entries.length > 0 && <button type="button" onClick={clear}>清空记录</button>}{recycledItems.length > 0 && <button type="button" onClick={clearRecycled}><Trash2 size={14} />清空回收站</button>}</footer>}
    </aside>}
  </>;
}
