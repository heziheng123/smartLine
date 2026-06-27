import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import dayjs from 'dayjs';
import type { TodoItem } from '@/utils/markdown';
import {
  toggleTodoLine,
  updateTodoText,
  changeTodoDate,
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

  const getDatePillClass = (todo: TodoItem) => {
    if (todo.done) return 'tl-md-date-pill tl-md-date-pill--done';
    if (todo.date && isOverdue(todo.date)) return 'tl-md-date-pill tl-md-date-pill--overdue';
    return 'tl-md-date-pill tl-md-date-pill--future';
  };

  const formatDateLabel = (dateStr: string) => {
    const d = dayjs(dateStr);
    const today = dayjs();
    if (d.isSame(today, 'day')) return '今天';
    if (d.isSame(today.add(1, 'day'), 'day')) return '明天';
    if (d.isSame(today.subtract(1, 'day'), 'day')) return '昨天';
    return d.format('M月D日');
  };

  return (
    <div className="tl-todo-list">
      {todos.length === 0 && (
        <div className="tl-todo-list-empty">暂无待办，在下方添加第一个子任务</div>
      )}

      {todos.map((todo) => (
        <div
          key={todo.line}
          className={`tl-todo-item ${todo.done ? 'tl-todo-item--done' : ''}`}
        >
          <input
            type="checkbox"
            className="tl-todo-item-check"
            checked={todo.done}
            onChange={() => handleToggle(todo.line)}
            onClick={(e) => e.stopPropagation()}
          />

          <div className="tl-todo-item-body">
            {editingLine === todo.line ? (
              <input
                ref={editInputRef}
                type="text"
                className="tl-todo-item-edit"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={handleEditKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="tl-todo-item-text"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit(todo);
                }}
              >
                {todo.text}
              </span>
            )}

            {todo.date && (
              <span className={getDatePillClass(todo)}>
                {formatDateLabel(todo.date)}
              </span>
            )}
          </div>

          <button
            type="button"
            className="tl-todo-item-calendar"
            onClick={(e) => handleOpenDatePicker(todo.line, e)}
            title="设置日期"
          >
            <CalendarIcon size={14} />
          </button>
        </div>
      ))}

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
          value={todos.find((t) => t.line === datePickerFor)?.date}
          onChange={handleDateChange}
          onClose={handleCloseDatePicker}
          anchorRect={datePickerAnchor}
        />
      )}
    </div>
  );
};

export default TodoList;
