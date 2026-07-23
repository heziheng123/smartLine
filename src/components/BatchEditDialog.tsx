// ============================================================
// 批量编辑对话框（沙盒预览 → 确认保存）
// ============================================================

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Task, SmartTaskBlock } from '@/types';
import {
  cleanseRows,
  applyBatchSchedule,
  blocksToRows,
  summarizeRows,
  type ParsedRow,
  type BatchScheduleConfig,
} from '@/utils/excelImport';
import { DEFAULT_TAGS, requiresTaskStartDate } from '@/utils/blocks';
import { todayStr, isBeforeDay } from '@/utils/dateSafe';

import { useGraphStore } from '@/graph/store';

interface BatchEditDialogProps {
  /**
   * 需要批量编辑的 task
   */
  task: Task;
  /**
   * 需要批量编辑的 blocks，如果没传默认取 task.blocks 中所有的 smart-task
   */
  initialBlocks?: SmartTaskBlock[];
  onClose: () => void;
  /**
   * 确认保存回调。
   */
  onConfirm: (rows: ParsedRow[]) => void;
}

const BatchEditDialog: React.FC<BatchEditDialogProps> = ({
  task,
  initialBlocks,
  onClose,
  onConfirm,
}) => {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      const blocksToEdit = initialBlocks || (task.blocks?.filter(b => b.type === 'smart-task') as SmartTaskBlock[]) || [];
      setRows(blocksToRows(blocksToEdit));
      setInitialized(true);
    }
  }, [initialized, initialBlocks, task.blocks]);

  // 批量排期工具栏
  const [showScheduler, setShowScheduler] = useState(false);
  const [schedStart, setSchedStart] = useState(todayStr());
  const [schedMode, setSchedMode] = useState<'count' | 'duration'>('count');
  const [schedLimit, setSchedLimit] = useState(2);
  const [schedSkipWeekend, setSchedSkipWeekend] = useState(true);
  const [schedOnlyEmpty, setSchedOnlyEmpty] = useState(true);

  // 撤销历史
  const [history, setHistory] = useState<ParsedRow[][]>([]);

  // 历史日期警告
  const [historicalWarning, setHistoricalWarning] = useState<{
    count: number;
    sample: string[];
  } | null>(null);

  // ── 行编辑 ────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setRows(prev);
  }, [history]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  const pushHistory = useCallback((newRows: ParsedRow[]) => {
    setHistory(prev => [...prev, rows].slice(-10)); // 保留最近 10 次历史
    setRows(newRows);
  }, [rows]);

  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const canConfirm = summary.valid > 0 && summary.errors === 0;
  
  const { nodes } = useGraphStore();

  // 直接编辑模式的更新
  const updateRow = useCallback((rowId: string, field: keyof ParsedRow, value: ParsedRow[keyof ParsedRow]) => {
    setRows(prev => cleanseRows(prev.map(r => r._rowId === rowId ? { ...r, [field]: value } : r)));
  }, []);

  const handleRowChange = (rowId: string, field: keyof ParsedRow, value: ParsedRow[keyof ParsedRow]) => {
    // 这里为了性能可以防抖，但对于批量编辑场景，直接更新即可
    updateRow(rowId, field, value);
  };

  const deleteRow = (rowId: string) => {
    pushHistory(rows.filter((r) => r._rowId !== rowId));
  };

  // ── 批量排期 ──────────────────────────────────────────────

  const handleApplySchedule = () => {
    const config: BatchScheduleConfig = {
      startDate: schedStart,
      mode: schedMode,
      limit: Math.max(1, schedLimit),
      skipWeekend: schedSkipWeekend,
      onlyEmpty: schedOnlyEmpty,
    };
    pushHistory(applyBatchSchedule(rows, config));
  };

  // ── 确认保存 ──────────────────────────────────────────────

  const doConfirm = () => {
    const validRows = rows.filter((row) => row.title && !row._error);
    if (validRows.length === 0) return;
    onConfirm(rows);
  };

  const handleConfirm = () => {
    // 检测历史日期：早于今天的 block
    const today = todayStr();
    const historicalDates = rows
      .filter((row) => row.title && !row._error && row.date && isBeforeDay(row.date, today))
      .map((row) => row.date);
    if (historicalDates.length > 0) {
      // 去重取前 3 个作为样本
      const unique = Array.from(new Set(historicalDates)).sort().slice(0, 3);
      setHistoricalWarning({ count: historicalDates.length, sample: unique });
      return;
    }

    doConfirm();
  };

  const confirmAnyway = () => {
    doConfirm();
  };

  const tagStyle = () => {
    // 简易 mock tag 样式，也可复用 getTagColor
    return {
      backgroundColor: '#f3f4f6',
      color: '#374151',
    };
  };

  return (
    <div className="tl-dialog-overlay tl-dialog-overlay--workspace bi-overlay">
      <div className="tl-dialog tl-dialog--workspace bi-dialog" role="dialog" aria-modal="true" aria-label={`批量编辑任务：${task.name}`}>
        {/* ── 头部 ── */}
        <div className="tl-dialog-header bi-header">
          <h2 className="tl-dialog-title">
            批量编辑任务：{task.name}
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="tl-dialog-close" onClick={onClose} type="button" aria-label="关闭批量编辑">×</button>
          </div>
        </div>

        {/* ── 主体内容 ── */}
        <div className="tl-dialog-body bi-body">
          {/* 历史日期警告 */}
          {historicalWarning && (
            <div className="bi-historical-warning">
              <AlertTriangle size={16} />
              <div className="bi-historical-warning-text">
                <strong>检测到 {historicalWarning.count} 个任务块的日期早于今天</strong>
                <span>
                  这些 block 会落在历史周，周矩阵默认显示当前周将看不到它们。
                  样本日期：{historicalWarning.sample.join('、')}
                  {historicalWarning.count > 3 ? ' 等' : ''}
                </span>
              </div>
              <div className="bi-historical-warning-actions">
                <button
                  type="button"
                  className="tl-dialog-btn tl-dialog-btn--secondary"
                  onClick={() => setHistoricalWarning(null)}
                >
                  返回修改
                </button>
                <button
                  type="button"
                  className="tl-dialog-btn tl-dialog-btn--danger"
                  onClick={confirmAnyway}
                >
                  仍然保存
                </button>
              </div>
            </div>
          )}

          {/* 统计栏 */}
          <div className="bi-summary">
            <div className="bi-summary-item bi-summary-item--total">
              <span className="bi-summary-num">{summary.total}</span>
              <span className="bi-summary-label">总行数</span>
            </div>
            <div className="bi-summary-item bi-summary-item--valid">
              <CheckCircle2 size={14} />
              <span className="bi-summary-num">{summary.valid}</span>
              <span className="bi-summary-label">可保存</span>
            </div>
            {summary.errors > 0 && (
              <div className="bi-summary-item bi-summary-item--error">
                <AlertTriangle size={14} />
                <span className="bi-summary-num">{summary.errors}</span>
                <span className="bi-summary-label">需修正</span>
              </div>
            )}
            {summary.empty > 0 && (
              <div className="bi-summary-item bi-summary-item--empty">
                <span className="bi-summary-num">{summary.empty}</span>
                <span className="bi-summary-label">空行已忽略</span>
              </div>
            )}
          </div>

          {/* 批量排期工具栏 */}
          <div className="bi-scheduler-toggle">
            <button
              className="bi-scheduler-btn"
              onClick={() => setShowScheduler((s) => !s)}
              type="button"
            >
              <Sparkles size={13} />
              统一分配排期（空降排期）
              {showScheduler ? '▾' : '▸'}
            </button>
          </div>
          {showScheduler && (
            <div className="bi-scheduler-panel">
              <label className="bi-sched-field">
                <span>起跑线</span>
                <input
                  type="date"
                  className="tl-dialog-input"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                />
              </label>
              <label className="bi-sched-field">
                <span>排期模式</span>
                <select
                  className="tl-dialog-input"
                  value={schedMode}
                  onChange={(e) => {
                    setSchedMode(e.target.value as 'count' | 'duration');
                    setSchedLimit(e.target.value === 'count' ? 2 : 120);
                  }}
                >
                  <option value="count">按任务数量</option>
                  <option value="duration">按预估时长</option>
                </select>
              </label>
              <label className="bi-sched-field">
                <span>{schedMode === 'count' ? '每天最多(个)' : '每天最多(分钟)'}</span>
                <input
                  type="number"
                  className="tl-dialog-input bi-sched-num"
                  min={1}
                  max={schedMode === 'count' ? 20 : 600}
                  value={schedLimit}
                  onChange={(e) => setSchedLimit(parseInt(e.target.value, 10) || 1)}
                />
              </label>
              <label className="bi-sched-check">
                <input
                  type="checkbox"
                  checked={schedSkipWeekend}
                  onChange={(e) => setSchedSkipWeekend(e.target.checked)}
                />
                <span>跳过周末</span>
              </label>
              <label className="bi-sched-check">
                <input
                  type="checkbox"
                  checked={schedOnlyEmpty}
                  onChange={(e) => setSchedOnlyEmpty(e.target.checked)}
                />
                <span>仅重新排期无日期的任务</span>
              </label>
              <button
                className="tl-dialog-btn tl-dialog-btn--primary bi-sched-apply"
                onClick={handleApplySchedule}
                type="button"
              >
                <CalendarDays size={13} />
                一键分配
              </button>
            </div>
          )}

          {/* 预览表格 */}
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th className="bi-th-title">任务名称</th>
                  <th className="bi-th-tag">类型</th>
                  <th className="bi-th-duration">时长</th>
                  <th className="bi-th-date">排期</th>
                  <th className="bi-th-date">截止</th>
                  <th className="bi-th-node">知识节点</th>
                  <th className="bi-th-remark">备注</th>
                  <th className="bi-th-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="bi-empty-row">没有可显示的行</td>
                  </tr>
                )}
                {rows.map((r) => {
                  const isEmpty = !r.title;
                  const hasError = !!r._error && !isEmpty;
                  const requiresStartDate = requiresTaskStartDate({ taskKind: r._taskKind });
                  
                  // 幽灵文本（知识节点）
                  let nodeGhost = '';
                  if (r.graphNodeName && r.graphNodeName.trim()) {
                    const match = nodes.find(n => n.name.toLowerCase().startsWith(r.graphNodeName!.toLowerCase()));
                    if (match) {
                      nodeGhost = r.graphNodeName + match.name.slice(r.graphNodeName.length);
                    }
                  }

                  // 幽灵文本（任务名称）
                  let titleGhost = '';
                  if (r.title && r.title.trim()) {
                    const match = nodes.find(n => n.name.toLowerCase().startsWith(r.title.toLowerCase()));
                    if (match) {
                      titleGhost = r.title + match.name.slice(r.title.length);
                    }
                  }

                  return (
                    <tr
                      key={r._rowId}
                      className={`bi-row ${hasError ? 'bi-row--error' : ''} ${isEmpty ? 'bi-row--empty' : ''}`}
                    >
                      <td className="bi-td-title" style={{ position: 'relative' }}>
                        {hasError && (
                          <div title={r._error} style={{
                            position: 'absolute', top: -4, right: -4, width: 8, height: 8,
                            borderRadius: '50%', background: '#ef4444', zIndex: 10, cursor: 'help',
                            boxShadow: '0 0 0 2px #fff'
                          }} />
                        )}
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {titleGhost && titleGhost !== r.title && (
                            <div style={{
                              position: 'absolute', left: 8, top: 0, bottom: 0, 
                              display: 'flex', alignItems: 'center', pointerEvents: 'none',
                              color: '#9ca3af', fontSize: '13px', whiteSpace: 'pre'
                            }}>
                              <span style={{ opacity: 0 }}>{r.title}</span>
                              <span>{titleGhost.slice(r.title.length)}</span>
                            </div>
                          )}
                          <input
                            className="bi-edit-input"
                            value={r.title}
                            onChange={(e) => handleRowChange(r._rowId, 'title', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Tab' && titleGhost && titleGhost !== r.title) {
                                e.preventDefault();
                                handleRowChange(r._rowId, 'title', titleGhost);
                              }
                            }}
                            placeholder="空行"
                          />
                        </div>
                      </td>
                      <td className="bi-td-tag" style={{ position: 'relative' }}>
                        <select
                          className="bi-edit-input bi-edit-input--sm"
                          value={r.tag}
                          onChange={(e) => handleRowChange(r._rowId, 'tag', e.target.value)}
                          style={{
                            ...tagStyle(),
                            appearance: 'none',
                            paddingRight: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="未分类">未分类</option>
                          {DEFAULT_TAGS.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="bi-td-duration">
                        <input
                          type="number"
                          className="bi-edit-input bi-edit-input--sm"
                          value={r.duration}
                          onChange={(e) => handleRowChange(r._rowId, 'duration', parseInt(e.target.value, 10) || 30)}
                        />
                      </td>
                      <td className="bi-td-date">
                        <input
                          type="date"
                          className="bi-edit-input"
                          value={r.date}
                          required={requiresStartDate}
                          aria-label={requiresStartDate ? '数量任务开始日期（必填）' : '任务排期日期'}
                          title={requiresStartDate ? '数量任务从开始日期起每天生效，不能清除' : '可清除为未排期'}
                          onChange={(e) => {
                            handleRowChange(r._rowId, 'date', e.target.value);
                            handleRowChange(r._rowId, 'dateRaw', e.target.value);
                          }}
                        />
                      </td>
                      <td className="bi-td-date">
                        <input
                          type="date"
                          className="bi-edit-input"
                          value={r.deadline}
                          min={r.date || undefined}
                          onChange={(e) => {
                            handleRowChange(r._rowId, 'deadline', e.target.value);
                            handleRowChange(r._rowId, 'deadlineRaw', e.target.value);
                          }}
                        />
                      </td>
                      <td className="bi-td-node">
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {nodeGhost && nodeGhost !== r.graphNodeName && (
                            <div style={{
                              position: 'absolute', left: 8, top: 0, bottom: 0, 
                              display: 'flex', alignItems: 'center', pointerEvents: 'none',
                              color: '#9ca3af', fontSize: '13px', whiteSpace: 'pre'
                            }}>
                              <span style={{ opacity: 0 }}>{r.graphNodeName}</span>
                              <span>{nodeGhost.slice(r.graphNodeName!.length)}</span>
                            </div>
                          )}
                          <input
                            className="bi-edit-input"
                            value={r.graphNodeName || ''}
                            onChange={(e) => handleRowChange(r._rowId, 'graphNodeName', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Tab' && nodeGhost && nodeGhost !== r.graphNodeName) {
                                e.preventDefault();
                                handleRowChange(r._rowId, 'graphNodeName', nodeGhost);
                              }
                            }}
                            placeholder="可关联节点..."
                          />
                        </div>
                      </td>
                      <td className="bi-td-remark">
                        <input
                          className="bi-edit-input"
                          value={r.remark}
                          onChange={(e) => handleRowChange(r._rowId, 'remark', e.target.value)}
                          title={r.remark}
                        />
                      </td>
                      <td className="bi-td-actions">
                        <button
                          className="bi-action-btn bi-action-btn--danger"
                          onClick={() => deleteRow(r._rowId)}
                          type="button"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 错误提示（首条） */}
          {summary.errors > 0 && (
            <div className="bi-error-banner" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} />
                <span>
                  检测到 {summary.errors} 行存在问题。请修改带有红点的任务，或点击一键修正。
                </span>
              </div>
              <button 
                type="button" 
                style={{ background: 'transparent', border: '1px solid currentColor', borderRadius: 4, padding: '2px 8px', fontSize: 12, cursor: 'pointer', color: 'inherit' }}
                onClick={() => {
                  const newRows = rows.map(r => {
                    if (r._error === '截止日期不能早于排期日期') {
                      return { ...r, deadline: r.date, deadlineRaw: r.date, _error: '' };
                    }
                    return r;
                  });
                  pushHistory(newRows);
                }}
              >
                一键修正日期冲突
              </button>
            </div>
          )}
        </div>

        {/* ── 底部按钮 ── */}
        <div className="tl-dialog-footer bi-footer">
          <div className="bi-footer-left">
            {history.length > 0 && (
              <button className="tl-dialog-btn" onClick={undo} type="button" title="撤销上一步操作">
                撤销 (Ctrl+Z)
              </button>
            )}
          </div>
          <div className="tl-dialog-footer-right">
            <button className="tl-dialog-btn tl-dialog-btn--secondary" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="tl-dialog-btn tl-dialog-btn--primary"
              onClick={handleConfirm}
              disabled={!canConfirm}
              type="button"
            >
              确认修改 {summary.valid > 0 ? `（${summary.valid} 项）` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchEditDialog;
