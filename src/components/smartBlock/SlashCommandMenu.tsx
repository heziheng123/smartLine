// ============================================================
// Slash 命令菜单（/ 触发）
// P1 a11y：键盘导航（Arrow Up/Down/Enter）+ ARIA menuitem 模式
// ============================================================

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ListTodo, Type } from 'lucide-react';

interface SlashMenuItem {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
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
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndexRef = useRef<number>(0);

  // 视口边界 clamp（避免菜单越界）
  const getClampedPosition = useCallback(() => {
    if (typeof window === 'undefined') return position;
    const padding = 8;
    const estimatedWidth = 280;
    const estimatedHeight = MENU_ITEMS.length * 56 + 56;
    const left = Math.max(padding, Math.min(position.left, window.innerWidth - estimatedWidth - padding));
    const top = Math.max(padding, Math.min(position.top, window.innerHeight - estimatedHeight - padding));
    return { top, left };
  }, [position]);

  const moveActive = useCallback((delta: 1 | -1) => {
    const next = (activeIndexRef.current + delta + MENU_ITEMS.length) % MENU_ITEMS.length;
    activeIndexRef.current = next;
    itemRefs.current[next]?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        activeIndexRef.current = 0;
        itemRefs.current[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        activeIndexRef.current = MENU_ITEMS.length - 1;
        itemRefs.current[MENU_ITEMS.length - 1]?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, moveActive]);

  useEffect(() => {
    // pointerdown 比 mousedown 早一步，且支持触摸/笔
    const handler = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onClose]);

  // 打开时聚焦第一个菜单项
  useEffect(() => {
    const id = window.setTimeout(() => itemRefs.current[0]?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const handleItemKeyDown = (e: React.KeyboardEvent, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key);
    }
  };

  const clamped = getClampedPosition();
  const isBrowser = typeof document !== 'undefined';

  const menuContent = (
    <div
      ref={menuRef}
      className="slash-menu"
      role="menu"
      aria-label="插入块类型"
      style={{ top: clamped.top, left: clamped.left }}
    >
      <div className="slash-menu-title" id="slash-menu-title">命令</div>
      {MENU_ITEMS.map((item, idx) => (
        <button
          key={item.key}
          ref={(el) => { itemRefs.current[idx] = el; }}
          type="button"
          role="menuitem"
          tabIndex={idx === 0 ? 0 : -1}
          aria-describedby="slash-menu-title"
          className="slash-menu-item"
          onClick={() => onSelect(item.key)}
          onKeyDown={(e) => handleItemKeyDown(e, item.key)}
        >
          <span className="slash-menu-icon" aria-hidden="true">{item.icon}</span>
          <div className="slash-menu-text">
            <span className="slash-menu-label">/{item.label}</span>
            <span className="slash-menu-desc">{item.description}</span>
          </div>
        </button>
      ))}
    </div>
  );

  if (!isBrowser) return null;
  return createPortal(menuContent, document.body);
};

export default SlashCommandMenu;