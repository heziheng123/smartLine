// ============================================================
// Slash 命令菜单（/ 触发）
// ============================================================

import React, { useEffect, useRef } from 'react';
import { ListTodo, Type } from 'lucide-react';

interface SlashMenuItem {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const MENU_ITEMS: SlashMenuItem[] = [
  {
    key: 'task',
    label: '任务',
    description: '插入一个空的智能任务块',
    icon: <ListTodo size={16} />,
  },
  {
    key: 'text',
    label: '文本',
    description: '插入一个纯文本段落',
    icon: <Type size={16} />,
  },
];

interface SlashCommandMenuProps {
  onSelect: (key: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  onSelect,
  onClose,
  position,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="slash-menu"
      style={{ top: position.top, left: position.left }}
    >
      <div className="slash-menu-title">命令</div>
      {MENU_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className="slash-menu-item"
          onClick={() => onSelect(item.key)}
        >
          <span className="slash-menu-icon">{item.icon}</span>
          <div className="slash-menu-text">
            <span className="slash-menu-label">/{item.label}</span>
            <span className="slash-menu-desc">{item.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
};

export default SlashCommandMenu;
