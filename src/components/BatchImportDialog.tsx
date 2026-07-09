// ============================================================
// 批量导入对话框（Excel/CSV → 沙盒预览 → 确认入库）
// 流程：下载模板 → 拖拽上传 → 解析预览 → 校验/微调 → 确认导入
// ============================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CalendarDays,
  Sparkles,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Task } from '@/types';
import {
  parseImportFile,
  downloadTemplate,
  cleanseRows,
  applyBatchSchedule,
  mapRowsToBlocks,
  computeTaskDateRange,
  summarizeRows,
  type ParsedRow,
  type BatchScheduleConfig,
} from '@/utils/excelImport';
import { todayStr, isBeforeDay } from '@/utils/dateSafe';

interface BatchImportDialogProps {
  /**
   * 固定目标任务：从项目详情面板打开时传入。
   * 此时隐藏"导入到"选择区，blocks 直接追加到该任务。
   */
  fixedTask?: Task;
  /** 现有任务列表（仅在没有 fixedTask 时用于"追加到已有项目"下拉） */
  existingTasks?: Task[];
  onClose: () => void;
  /**
   * 确认导入回调。
   * - target.taskId → 追加 blocks 到该任务
   * - target.newTaskName → 创建新任务（项目）
   */
  onConfirm: (
    blocks: ReturnType<typeof mapRowsToBlocks>,
    target: { taskId: string } | { newTaskName: string; start: string; end: string; tag: string },
  ) => void;
}

type Stage = 'upload' | 'preview';

const BatchImportDialog: React.FC<BatchImportDialogProps> = ({
  fixedTask,
  existingTasks = [],
  onClose,
  onConfirm,
}) => {
  const [stage, setStage] = useState<Stage>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 导入目标（仅在没有 fixedTask 时使用）
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskTag, setNewTaskTag] = useState('');
  const [existingTaskId, setExistingTaskId] = useState('');

  // 批量排期工具栏
  const [showScheduler, setShowScheduler] = useState(false);
  const [schedStart, setSchedStart] = useState(todayStr());
  const [schedPerDay, setSchedPerDay] = useState(2);
  const [schedSkipWeekend, setSchedSkipWeekend] = useState(true);
  const [schedOnlyEmpty, setSchedOnlyEmpty] = useState(true);

  // 内联编辑
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ParsedRow | null>(null);

  // 历史日期警告
  const [historicalWarning, setHistoricalWarning] = useState<{
    count: number;
    sample: string[];
  } | null>(null);

  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const canConfirm = summary.valid > 0 && summary.errors === 0 && (
    fixedTask
      ? true
      : targetMode === 'existing'
        ? !!existingTaskId
        : !!newTaskName.trim()
  );

  // ── 文件解析 ──────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    setParseError('');
    try {
      const parsed = await parseImportFile(file);
      if (parsed.length === 0) {
        setParseError('未在文件中识别到任何数据行，请检查表头与内容。');
        setRows([]);
      } else {
        setRows(parsed);
        setStage('preview');
      }
    } catch (e) {
      console.error('[batch-import] 解析失败:', e);
      setParseError(`文件解析失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setParsing(false);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── 行编辑 ────────────────────────────────────────────────

  const startEditRow = (r: ParsedRow) => {
    setEditingRowId(r._rowId);
    setEditDraft({ ...r });
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditDraft(null);
  };

  const saveEditRow = () => {
    if (!editDraft) return;
    setRows((prev) =>
      cleanseRows(prev.map((r) => (r._rowId === editingRowId ? editDraft : r))),
    );
    cancelEditRow();
  };

  const deleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r._rowId !== rowId));
  };

  // ── 批量排期 ──────────────────────────────────────────────

  const handleApplySchedule = () => {
    const config: BatchScheduleConfig = {
      startDate: schedStart,
      mode: 'count',
      limit: Math.max(1, schedPerDay),
      skipWeekend: schedSkipWeekend,
      onlyEmpty: schedOnlyEmpty,
    };
    setRows((prev) => applyBatchSchedule(prev, config));
  };

  // ── 确认导入 ──────────────────────────────────────────────

  const doConfirm = () => {
    const blocks = mapRowsToBlocks(rows);
    if (blocks.length === 0) return;

    // 固定任务模式：直接追加到 fixedTask
    if (fixedTask) {
      onConfirm(blocks, { taskId: fixedTask.id });
      return;
    }

    if (targetMode === 'existing' && existingTaskId) {
      onConfirm(blocks, { taskId: existingTaskId });
    } else {
      const name = newTaskName.trim();
      if (!name) return;
      // 新任务的日期范围：基于导入的 blocks
      const placeholderTask: Task = {
        id: '__placeholder__',
        name,
        start: todayStr(),
        end: todayStr(),
        blocks: [],
      };
      const { start, end } = computeTaskDateRange(placeholderTask, blocks);
      onConfirm(blocks, { newTaskName: name, start, end, tag: newTaskTag.trim() || '未分类' });
    }
  };

  const handleConfirm = () => {
    const blocks = mapRowsToBlocks(rows);
    if (blocks.length === 0) return;

    // 检测历史日期：早于今天的 block
    const today = todayStr();
    const historicalDates: string[] = [];
    for (const b of blocks) {
      if (b.header.date && isBeforeDay(b.header.date, today)) {
        historicalDates.push(b.header.date);
      }
    }
    if (historicalDates.length > 0) {
      // 去重取前 3 个作为样本
      const unique = Array.from(new Set(historicalDates)).sort().slice(0, 3);
      setHistoricalWarning({ count: historicalDates.length, sample: unique });
      return;
    }

    doConfirm();
  };

  const confirmAnyway = () => {
    setHistoricalWarning(null);
    doConfirm();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ── 渲染 ──────────────────────────────────────────────────

  return (
    <div className="tl-dialog-overlay bi-overlay" onClick={handleOverlayClick}>
      <div className="tl-dialog bi-dialog">
        <div className="tl-dialog-header bi-header">
          <div className="bi-header-titles">
            <h3>批量导入任务</h3>
            {fixedTask && (
              <span className="bi-header-sub">
                导入到项目：<strong>{fixedTask.name}</strong>
              </span>
            )}
          </div>
          <button className="bi-close-btn" onClick={onClose} type="button" aria-label="关闭">×</button>
        </div>

        <div className="tl-dialog-body bi-body">
          {/* ── 阶段 1：上传 ── */}
          {stage === 'upload' && (
            <>
              <div className="bi-upload-section">
                <button
                  className="tl-dialog-btn tl-dialog-btn--secondary bi-template-btn"
                  onClick={downloadTemplate}
                  type="button"
                >
                  <Download size={14} />
                  下载标准模板（.xlsx）
                </button>
                <p className="bi-hint">
                  模板包含表头：任务名称(必填)、任务类型、预估时长(分钟)、排期日期、截止日期、复杂度、详情备注。
                  利用 Excel「下拉递增」可一秒生成 50 节课与连续日期。
                </p>
              </div>

              <div
                className={`bi-dropzone ${dragOver ? 'bi-dropzone--active' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                {parsing ? (
                  <>
                    <Loader2 size={32} className="bi-spinner" />
                    <p className="bi-dropzone-title">正在解析文件…</p>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={32} />
                    <p className="bi-dropzone-title">拖拽 Excel/CSV 文件到此处</p>
                    <p className="bi-dropzone-sub">或点击选择文件 · 支持 .xlsx / .xls / .csv</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </div>

              {parseError && (
                <div className="bi-error-banner">
                  <XCircle size={14} />
                  <span>{parseError}</span>
                </div>
              )}
            </>
          )}

          {/* ── 阶段 2：预览沙盒 ── */}
          {stage === 'preview' && (
            <>
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
                      仍然导入
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
                  <span className="bi-summary-label">可导入</span>
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
                    <span>每天任务数</span>
                    <input
                      type="number"
                      className="tl-dialog-input bi-sched-num"
                      min={1}
                      max={20}
                      value={schedPerDay}
                      onChange={(e) => setSchedPerDay(parseInt(e.target.value, 10) || 1)}
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
                    <span>仅填充空日期</span>
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
                      <th className="bi-th-remark">备注</th>
                      <th className="bi-th-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="bi-empty-row">没有可显示的行</td>
                      </tr>
                    )}
                    {rows.map((r) => {
                      const isEditing = editingRowId === r._rowId;
                      const isEmpty = !r.title;
                      const hasError = !!r._error && !isEmpty;
                      return (
                        <tr
                          key={r._rowId}
                          className={`bi-row ${hasError ? 'bi-row--error' : ''} ${isEmpty ? 'bi-row--empty' : ''}`}
                        >
                          <td className="bi-td-title">
                            {isEditing ? (
                              <input
                                className="bi-edit-input"
                                value={editDraft?.title ?? ''}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, title: e.target.value } : d)}
                              />
                            ) : (
                              <span className="bi-title-text">{r.title || <em className="bi-muted">（空行）</em>}</span>
                            )}
                          </td>
                          <td className="bi-td-tag">
                            {isEditing ? (
                              <input
                                className="bi-edit-input bi-edit-input--sm"
                                value={editDraft?.tag ?? ''}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, tag: e.target.value } : d)}
                              />
                            ) : (
                              <span className="bi-tag" style={tagStyle(r.tag)}>{r.tag}</span>
                            )}
                          </td>
                          <td className="bi-td-duration">
                            {isEditing ? (
                              <input
                                type="number"
                                className="bi-edit-input bi-edit-input--sm"
                                value={editDraft?.duration ?? 30}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, duration: parseInt(e.target.value, 10) || 30 } : d)}
                              />
                            ) : (
                              <span>{r.duration}m</span>
                            )}
                          </td>
                          <td className="bi-td-date">
                            {isEditing ? (
                              <input
                                type="date"
                                className="bi-edit-input"
                                value={editDraft?.date ?? ''}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, date: e.target.value, dateRaw: e.target.value } : d)}
                              />
                            ) : (
                              <span className={r.date ? '' : 'bi-muted'}>{r.date || '—'}</span>
                            )}
                          </td>
                          <td className="bi-td-date">
                            {isEditing ? (
                              <input
                                type="date"
                                className="bi-edit-input"
                                value={editDraft?.deadline ?? ''}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, deadline: e.target.value, deadlineRaw: e.target.value } : d)}
                              />
                            ) : (
                              <span className={r.deadline ? '' : 'bi-muted'}>{r.deadline || '—'}</span>
                            )}
                          </td>
                          <td className="bi-td-remark">
                            {isEditing ? (
                              <input
                                className="bi-edit-input"
                                value={editDraft?.remark ?? ''}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, remark: e.target.value } : d)}
                              />
                            ) : (
                              <span className="bi-remark-text" title={r.remark}>{r.remark || '—'}</span>
                            )}
                          </td>
                          <td className="bi-td-actions">
                            {isEditing ? (
                              <>
                                <button className="bi-action-btn bi-action-btn--save" onClick={saveEditRow} type="button" title="保存">✓</button>
                                <button className="bi-action-btn" onClick={cancelEditRow} type="button" title="取消">×</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="bi-action-btn"
                                  onClick={() => startEditRow(r)}
                                  type="button"
                                  title="编辑"
                                  disabled={isEmpty}
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  className="bi-action-btn bi-action-btn--danger"
                                  onClick={() => deleteRow(r._rowId)}
                                  type="button"
                                  title="删除"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 错误提示（首条） */}
              {summary.errors > 0 && (
                <div className="bi-error-banner">
                  <AlertTriangle size={14} />
                  <span>
                    检测到 {summary.errors} 行存在问题（标红显示）。请双击修改后再导入，
                    或删除错误行。当前无法确认导入。
                  </span>
                </div>
              )}

              {/* 导入目标选择（固定任务模式下隐藏，blocks 直接追加到 fixedTask） */}
              {!fixedTask && (
                <div className="bi-target-section">
                  <label className="tl-dialog-label">导入到</label>
                  <div className="bi-target-tabs">
                    <button
                      type="button"
                      className={`bi-target-tab ${targetMode === 'new' ? 'bi-target-tab--active' : ''}`}
                      onClick={() => setTargetMode('new')}
                    >
                      新建项目
                    </button>
                    <button
                      type="button"
                      className={`bi-target-tab ${targetMode === 'existing' ? 'bi-target-tab--active' : ''}`}
                      onClick={() => setTargetMode('existing')}
                    >
                      追加到已有项目
                    </button>
                  </div>
                  {targetMode === 'new' ? (
                    <div className="bi-target-form">
                      <input
                        className="tl-dialog-input"
                        placeholder="新项目名称（如：27考研政治）"
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                      />
                      <input
                        className="tl-dialog-input"
                        placeholder="默认标签（如：看课；留空则用'未分类'）"
                        value={newTaskTag}
                        onChange={(e) => setNewTaskTag(e.target.value)}
                      />
                    </div>
                  ) : (
                    <select
                      className="tl-dialog-input"
                      value={existingTaskId}
                      onChange={(e) => setExistingTaskId(e.target.value)}
                    >
                      <option value="">— 选择目标项目 —</option>
                      {existingTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}（{t.start} ~ {t.end}）
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 底部按钮 ── */}
        <div className="tl-dialog-footer bi-footer">
          <div className="bi-footer-left">
            {stage === 'preview' && (
              <button
                className="tl-dialog-btn tl-dialog-btn--secondary"
                onClick={() => { setStage('upload'); setRows([]); setParseError(''); }}
                type="button"
              >
                重新选择文件
              </button>
            )}
          </div>
          <div className="tl-dialog-footer-right">
            <button className="tl-dialog-btn tl-dialog-btn--secondary" onClick={onClose} type="button">
              取消
            </button>
            {stage === 'preview' && (
              <button
                className="tl-dialog-btn tl-dialog-btn--primary"
                onClick={handleConfirm}
                disabled={!canConfirm}
                type="button"
              >
                确认导入 {summary.valid > 0 ? `（${summary.valid} 项）` : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 辅助：根据 tag 生成淡色 chip 样式 ────────────────────────

function tagStyle(tag: string): React.CSSProperties {
  // 简单 hash → 莫兰迪色 chip
  const palette = ['#FECDD3', '#BFDBFE', '#FDE68A', '#D9F993', '#DDD6FE', '#FBCFE8', '#A5F3FC', '#FED7AA'];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  const bg = palette[Math.abs(hash) % palette.length];
  return {
    background: bg,
    color: '#374151',
  };
}

export default BatchImportDialog;
