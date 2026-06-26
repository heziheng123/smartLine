// ============================================================
// Smart Timeline - Markdown 编辑器（无缝阅读/编辑）
// 无传统工具栏：预览态点击进入编辑，编辑失焦自动保存并回预览
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  renderMarkdown,
  toggleTodoLine,
} from '@/utils/markdown';

export type EditorMode = 'edit' | 'preview' | 'split';

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** 编辑模式：edit / preview / split（外部受控，用于持久化偏好） */
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** 保存回调（Ctrl+S / 失焦时触发） */
  onSave: () => void;
  /** 是否有未保存的改动 */
  dirty: boolean;
  /** 最近一次保存提示文案（如"已保存"） */
  saveHint?: string;
}

// ── 工具栏按钮定义 ──────────────────────────────────────────

interface ToolbarBtn {
  label: string;
  title: string;
  onClick: () => void;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  mode,
  onModeChange,
  onSave,
  dirty,
  saveHint,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  // 防抖预览
  const [previewHtml, setPreviewHtml] = useState<string>('');

  // ── 预览渲染（防抖 150ms）──────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewHtml(renderMarkdown(value));
    }, 150);
    return () => clearTimeout(timer);
  }, [value]);

  // ── 选区辅助：包裹/替换选中文本 ────────────────────────────
  const wrapSelection = useCallback(
    (before: string, after: string = before, placeholder: string = '') => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end) || placeholder;
      const next = value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(next);
      // 还原光标
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const pos = start + before.length;
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos + selected.length;
        textareaRef.current.focus();
      });
    },
    [value, onChange],
  );

  // ── 在当前行前插入一行文本 ───────────────────────────────
  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      // 找到当前行起点
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      onChange(next);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + prefix.length;
        textareaRef.current.focus();
      });
    },
    [value, onChange],
  );

  // ── 追加待办行 ──────────────────────────────────────────
  const insertTodo = useCallback(() => {
    const ta = textareaRef.current;
    const today = dayjs().format('YYYY-MM-DD');
    const todoLine = `- [ ] 新待办 @${today}\n`;
    if (!ta) {
      onChange(value + (value.endsWith('\n') ? '' : '\n') + todoLine);
      return;
    }
    const end = ta.selectionEnd;
    // 在光标后插入
    const next = value.slice(0, end) + todoLine + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = end + todoLine.length;
      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = pos;
      textareaRef.current.focus();
    });
  }, [value, onChange]);

  // ── 工具栏按钮（仅编辑模式下底部浮现） ──────────────────────
  const toolbarBtns: ToolbarBtn[] = useMemo(() => [
    { label: 'B', title: '粗体', onClick: () => wrapSelection('**', '**', '粗体') },
    { label: 'I', title: '斜体', onClick: () => wrapSelection('*', '*', '斜体') },
    { label: 'H1', title: '一级标题', onClick: () => insertLinePrefix('# ') },
    { label: 'H2', title: '二级标题', onClick: () => insertLinePrefix('## ') },
    { label: '•', title: '无序列表', onClick: () => insertLinePrefix('- ') },
    { label: '☑', title: '插入待办（带今日日期）', onClick: insertTodo },
    { label: '❝', title: '引用块', onClick: () => insertLinePrefix('> ') },
  ], [wrapSelection, insertLinePrefix, insertTodo]);

  // ── 快捷键：Ctrl/Cmd+S 保存 ─────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
      // Esc：退出编辑回到预览（阻止冒泡，避免触发外层抽屉的 Esc 关闭）
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onSave();
        onModeChange('preview');
      }
    },
    [onSave, onModeChange],
  );

  // ── 预览区 checkbox 点击：写回 textarea ───────────────────
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains('tl-md-todo-check')) {
        // 阻止 input 自身切换 checked 状态，避免视觉闪烁
        // 实际状态由 toggleTodoLine 重写 textarea 后重新渲染控制
        e.preventDefault();
        const lineAttr = target.getAttribute('data-line');
        if (lineAttr == null) return;
        const line = parseInt(lineAttr, 10);
        if (Number.isNaN(line)) return;
        const next = toggleTodoLine(value, line);
        onChange(next);
        return;
      }
      // 点击预览区非 checkbox 的任意位置 → 进入编辑模式
      onModeChange('edit');
    },
    [value, onChange, onModeChange],
  );

  // ── 编辑模式：textarea 失焦时自动保存并回预览 ───────────────
  const handleTextareaBlur = useCallback(() => {
    onSave();
    onModeChange('preview');
  }, [onSave, onModeChange]);

  // ── 进入编辑模式时自动聚焦 textarea ───────────────────────
  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      // 延迟聚焦避免与 click 事件冲突
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [mode]);

  return (
    <div className="tl-md-editor" ref={editorRootRef}>
      {/* 主体区 ───────────────────────────────────────────── */}
      <div className={`tl-md-body tl-md-body--${mode}`}>
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            className="tl-md-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleTextareaBlur}
            placeholder="在此输入 Markdown 内容…"
            spellCheck={false}
          />
        ) : (
          <div
            ref={previewRef}
            className="tl-md-preview"
            // 预览 HTML 已经过 DOMPurify 净化
            dangerouslySetInnerHTML={{ __html: previewHtml }}
            onClick={handlePreviewClick}
          />
        )}
      </div>

      {/* 编辑模式底部浮动工具条（极简） ─────────────────── */}
      {mode === 'edit' && (
        <div className="tl-md-floating-toolbar">
          {toolbarBtns.map((b, i) => (
            <button
              key={i}
              type="button"
              className="tl-md-tool-btn"
              title={b.title}
              onClick={b.onClick}
              // 阻止按钮点击导致 textarea 失焦（否则会触发 onBlur 退出编辑）
              onMouseDown={(e) => e.preventDefault()}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* 右下角极淡状态提示（不抢视觉） ─────────────────── */}
      <div className="tl-md-status-hint">
        {dirty ? (
          <span className="tl-md-status-hint--dirty">未保存</span>
        ) : saveHint ? (
          <span className="tl-md-status-hint--saved">{saveHint}</span>
        ) : null}
      </div>

      {/* 底部：日期图例（仅 preview 显示） ───────────── */}
      {mode === 'preview' && (
        <div className="tl-md-legend">
          <span className="tl-md-legend-item">
            <span className="tl-md-date-pill tl-md-date-pill--future">@未来</span>
            <span className="tl-md-legend-text">未到期</span>
          </span>
          <span className="tl-md-legend-item">
            <span className="tl-md-date-pill tl-md-date-pill--overdue">@已过期</span>
            <span className="tl-md-legend-text">已逾期</span>
          </span>
          <span className="tl-md-legend-item">
            <span className="tl-md-date-pill tl-md-date-pill--done">@完成日</span>
            <span className="tl-md-legend-text">已完成</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default MarkdownEditor;
