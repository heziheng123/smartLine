import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, Trash2 as TrashIcon } from 'lucide-react';
import dayjs from 'dayjs';
import type { TodoItem } from '@/utils/markdown';
import {
  toggleTodoLine,
  updateTodoText,
  changeTodoDate,
  deleteTodoLine,
  smartAppendTodo,
  isOverdue,
} from '@/utils/markdown';
import DatePicker from './DatePicker';

interface TodoListProps {
  todos: TodoItem[];
  value: string;
  onChange: (next: string) => void;
}

const TodoList: React.FC<TodoListProps> = ({ todos, value, onChange }) => {
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [datePickerFor, setDatePickerFor] = useState<number | null>(null);
  const [datePickerAnchor, setDatePickerAnchor] = useState<DOMRect | null>(null);
  const [newTodoText, setNewTodoText] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const newTodoInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLine !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLine]);

  const handleToggle = useCallback((line: number) => {
    onChange(toggleTodoLine(value, line));
  }, [value, onChange]);

  const handleDelete = useCallback((line: number) => {
    onChange(deleteTodoLine(value, line));
  }, [value, onChange]);

  const handleStartEdit = useCallback((todo: TodoItem) => {
    setEditingLine(todo.line);
    setEditText(todo.text);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingLine === null) return;
    const trimmed = editText.trim();
    if (trimmed) {
      onChange(updateTodoText(value, editingLine, trimmed));
    }
    setEditingLine(null);
  }, [editingLine, editText, value, onChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingLine(null);
    setEditText('');
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancelEdit();
    }
  }, [handleSaveEdit, handleCancelEdit]);

  const handleOpenDatePicker = useCallback((line: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    setDatePickerAnchor(btn.getBoundingClientRect());
    setDatePickerFor(line);
  }, []);

  const handleCloseDatePicker = useCallback(() => {
    setDatePickerFor(null);
    setDatePickerAnchor(null);
  }, []);

  const handleDateChange = useCallback((newDate: string | undefined) => {
    if (datePickerFor === null) return;
    onChange(changeTodoDate(value, datePickerFor, newDate));
  }, [datePickerFor, value, onChange]);

  const handleAddTodo = useCallback(() => {
    const trimmed = newTodoText.trim();
    if (!trimmed) return;
    onChange(smartAppendTodo(value, trimmed));
    setNewTodoText('');
    requestAnimationFrame(() => {
      newTodoInputRef.current?.focus();
    });
  }, [newTodoText, value, onChange]);

  const handleNewTodoKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTodo();
    }
  }, [handleAddTodo]);

  const handleToggleGroupCollapse = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const formatDateLabel = (dateStr: string) => {
    const d = dayjs(dateStr);
    const today = dayjs();
    if (d.isSame(today, 'day')) return '今天';
    if (d.isSame(today.add(1, 'day'), 'day')) return '明天';
    if (d.isSame(today.subtract(1, 'day'), 'day')) return '昨天';
    return d.format('M月D日');
  };

  // 根据分组组织待办列表（只对有 group 的待办分组，无 group 的直接平铺）
  const groupedTodos = useMemo(() => {
    const groups: Map<string | null, TodoItem[]> = new Map();
    todos.forEach((todo) => {
      const group = todo.group || null; // 无 group 用 null 表示
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(todo);
    });
    return groups;
  }, [todos]);

  // 根据emoji获取颜色类名
  const getEmojiColorClass = (emoji?: string): string => {
    if (!emoji) return '';
    const colorMap: Record<string, string> = {
      '📖': 'tl-todo-item--new',      // 新课 - 蓝色
      '🔄': 'tl-todo-item--review',   // 复习 - 绿色
      '☕': 'tl-todo-item--rest',     // 休息 - 灰色
      '📚': 'tl-todo-item--study',    // 学习 - 蓝色
      '✍️': 'tl-todo-item--write',    // 写作 - 紫色
      '🎧': 'tl-todo-item--listen',   // 听课 - 蓝色
      '🗣️': 'tl-todo-item--speak',    // 背诵 - 橙色
    };
    return colorMap[emoji] || '';
  };

  // 渲染单个待办项（支持emoji、双日期、嵌套列表）
  const renderTodoItem = (todo: TodoItem) => {
    const indentClass = todo.indent ? `tl-todo-indent--${todo.indent}` : '';
    const emojiColorClass = getEmojiColorClass(todo.emoji);

    return (
      <div
        key={todo.line}
        className={`tl-todo-item ${todo.done ? 'tl-todo-item--done' : ''} ${indentClass} ${emojiColorClass}`}
      >
        {/* 左侧颜色边框 */}
        <div className="tl-todo-item-accent" />

        {/* 主内容区 */}
        <div className="tl-todo-item-body">
          {/* 头部：checkbox + emoji + 文本 */}
          <div className="tl-todo-item-header">
            <input
              type="checkbox"
              className="tl-todo-check"
              checked={todo.done}
              onChange={() => handleToggle(todo.line)}
              onClick={(e) => e.stopPropagation()}
            />

            {/* Emoji醒目显示 */}
            {todo.emoji && (
              <span className="tl-todo-emoji">{todo.emoji}</span>
            )}

            {/* 文本（可编辑） */}
            {editingLine === todo.line ? (
              <input
                ref={editInputRef}
                type="text"
                className="tl-todo-edit"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={handleEditKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="tl-todo-text"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit(todo);
                }}
              >
                {todo.text}
              </span>
            )}

            {/* 日期显示 */}
            {todo.planDate && todo.doneDate && (
              <span className="tl-todo-date-row">
                <span className="tl-todo-date-pill tl-todo-date-pill--plan">
                  ⏳{formatDateLabel(todo.planDate)}
                </span>
                <span className="tl-todo-date-pill tl-todo-date-pill--done">
                  ✅{formatDateLabel(todo.doneDate)}
                  {dayjs(todo.doneDate).diff(dayjs(todo.planDate), 'day') > 0 && (
                    <span className="tl-todo-delay">
                      (+{dayjs(todo.doneDate).diff(dayjs(todo.planDate), 'day')}天)
                    </span>
                  )}
                </span>
              </span>
            )}
            {todo.planDate && !todo.doneDate && (
              <span className={`tl-todo-date-pill ${isOverdue(todo.planDate) ? 'tl-todo-date-pill--overdue' : 'tl-todo-date-pill--plan'}`}>
                ⏳{formatDateLabel(todo.planDate)}
              </span>
            )}
            {todo.date && !todo.planDate && (
              <span className={`tl-md-date-pill ${todo.done ? 'tl-md-date-pill--done' : (isOverdue(todo.date) ? 'tl-md-date-pill--overdue' : 'tl-md-date-pill--future')}`}>
                {formatDateLabel(todo.date)}
              </span>
            )}
          </div>

          {/* 嵌套内容（树状渲染） */}
          {todo.nestedLines && todo.nestedLines.length > 0 && (
            <div className="tl-todo-nested">
              {todo.nestedLines.map((nestedText, nestedIdx) => (
                <div key={nestedIdx} className="tl-todo-nested-item">
                  <span className="tl-todo-nested-line">{nestedIdx === todo.nestedLines!.length - 1 ? '└' : '├'}</span>
                  <span className="tl-todo-nested-text">{nestedText}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 日历按钮 */}
        <button
          type="button"
          className="tl-todo-calendar"
          onClick={(e) => handleOpenDatePicker(todo.line, e)}
          title="设置日期"
        >
          <CalendarIcon size={14} />
        </button>

        {/* 删除按钮 */}
        <button
          type="button"
          className="tl-todo-delete"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(todo.line);
          }}
          title="删除待办"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    );
  };

  // 渲染分组区块
  const renderGroupedTodos = () => {
    if (groupedTodos.size === 0) {
      return <div className="tl-todo-list-empty">暂无待办，在下方添加第一个子任务</div>;
    }

    return Array.from(groupedTodos.entries()).map(([group, groupTodos]) => {
      // 无分组（group === null）的待办直接平铺，不显示分组标题
      if (group === null) {
        return (
          <React.Fragment key="__no-group__">
            {groupTodos.map(renderTodoItem)}
          </React.Fragment>
        );
      }

      // 有分组的待办显示分组标题（可折叠）
      return (
        <div key={group} className="tl-todo-group">
          <div
            className="tl-todo-group-header"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleGroupCollapse(group);
            }}
          >
            <span className="tl-todo-group-title">{group}</span>
            <span className="tl-todo-group-count">{groupTodos.length}</span>
            <button className="tl-todo-group-collapse">
              {collapsedGroups.has(group) ? '▶' : '▼'}
            </button>
          </div>

          {!collapsedGroups.has(group) && (
            <div className="tl-todo-group-body">
              {groupTodos.map(renderTodoItem)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="tl-todo-list">
      {renderGroupedTodos()}

      {/* 常驻添加输入框 */}
      <div className="tl-todo-add-row">
        <span className="tl-todo-add-plus">+</span>
        <input
          ref={newTodoInputRef}
          type="text"
          className="tl-todo-add-input"
          placeholder="添加子任务..."
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          onKeyDown={handleNewTodoKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {datePickerFor !== null && (
        <DatePicker
          value={todos.find((t) => t.line === datePickerFor)?.planDate || todos.find((t) => t.line === datePickerFor)?.date}
          onChange={handleDateChange}
          onClose={handleCloseDatePicker}
          anchorRect={datePickerAnchor}
        />
      )}
    </div>
  );
};

export default TodoList;
