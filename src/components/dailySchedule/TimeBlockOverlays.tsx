import React, { useEffect, useRef, useState } from 'react';
import type { TimeBlock } from './types';

export const QuickCreateInput: React.FC<{
  initialTime: string;
  onCreate: (name: string, startTime: string) => void;
  onCancel: () => void;
}> = ({ initialTime, onCreate, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = useRef(false);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = () => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed, initialTime);
    else onCancel();
  };

  return (
    <div className="tb-quick-create" onClick={(event) => event.stopPropagation()}>
      <input
        ref={inputRef}
        className="tb-quick-create-input"
        value={name}
        placeholder={`在 ${initialTime} 添加...`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') {
            isSubmitting.current = true;
            onCancel();
          }
        }}
        onBlur={submit}
      />
    </div>
  );
};

export const BlockEditor: React.FC<{
  block: TimeBlock;
  rect: DOMRect;
  onSave: (blockId: string, patch: Partial<TimeBlock>) => void;
  onDelete: (blockId: string) => void;
  onClose: () => void;
}> = ({ block, rect, onSave, onDelete, onClose }) => {
  const [startTime, setStartTime] = useState(block.startTime);
  const [endTime, setEndTime] = useState(block.endTime);

  return (
    <div className="tb-editor-overlay" onClick={onClose}>
      <div
        className="tb-editor"
        style={{
          top: Math.min(rect.bottom + 4, window.innerHeight - 180),
          left: Math.min(rect.left, window.innerWidth - 240),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tb-editor-name">{block.name}</div>
        <div className="tb-editor-times">
          <label>开始<input type="time" className="tb-editor-input" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label>结束<input type="time" className="tb-editor-input" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
        </div>
        <div className="tb-editor-actions">
          <button type="button" className="tb-editor-save" onClick={() => onSave(block.id, { startTime, endTime })}>保存</button>
          <button type="button" className="tb-editor-delete" onClick={() => onDelete(block.id)}>删除</button>
        </div>
      </div>
    </div>
  );
};
