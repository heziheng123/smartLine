// ============================================================
// Smart Timeline - 右键上下文菜单
// ============================================================

import React, { type FC, Fragment, useEffect, useRef, useState } from 'react';
import type { ContextMenuItem } from '@/types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the first menuitem on open so keyboard navigation works immediately
    const firstBtn = menuRef.current?.querySelector<HTMLButtonElement>('[data-menu-idx]');
    firstBtn?.focus();

    // P3 D-6：pointerdown 比 mousedown 更早一步，支持触摸/笔设备
    const handleClickOutside = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // P3 D-6：mouseup 作为兜底，避免某些浏览器 mousedown 与 dragstart 事件交错时不触发关闭
    const handleMouseUp = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // resize/scroll 时关闭菜单（防止菜单位置与触发元素错位）
    const handleResizeOrScroll = () => onClose();

    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
    };
  }, [onClose]);

  const [origin, setOrigin] = useState('top left');
  const [position, setPosition] = useState({ top: y, left: x });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let newOriginY = 'top';
      let newOriginX = 'left';
      let newTop = y;
      let newLeft = x;

      // 视口边界 clamp：避免菜单跑出视口
      const padding = 8;
      if (x + rect.width > viewportW) {
        newLeft = Math.max(padding, x - rect.width);
        newOriginX = 'right';
      }
      if (y + rect.height > viewportH) {
        newTop = Math.max(padding, y - rect.height);
        newOriginY = 'bottom';
      }
      // 左/上溢出兜底
      newLeft = Math.max(padding, Math.min(newLeft, viewportW - rect.width - padding));
      newTop = Math.max(padding, Math.min(newTop, viewportH - rect.height - padding));

      setPosition({ top: newTop, left: newLeft });
      setOrigin(`${newOriginY} ${newOriginX}`);
    }
  }, [x, y]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const btns = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-idx]') ?? [];
    const currentIdx = Array.from(btns).indexOf(e.currentTarget as HTMLButtonElement);
    if (currentIdx < 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(currentIdx + 1) % btns.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(currentIdx - 1 + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      btns[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      btns[btns.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="上下文菜单"
      tabIndex={-1}
      className="tl-context-menu"
      style={{ left: position.left, top: position.top, transformOrigin: origin }}
    >
      {items.map((item, idx) => {
        if (item.divider && !item.label) {
          return <div key={`div|${idx}`} role="separator" className="tl-context-menu-divider" />;
        }
        if (!item.label) return null;
        return (
          <Fragment key={`item|${idx}`}>
            {item.divider && <div role="separator" className="tl-context-menu-divider" />}
            <button
              role="menuitem"
              data-menu-idx={idx}
              className={`tl-context-menu-item ${item.danger ? 'tl-context-menu-item--danger' : ''}`}
              onClick={() => { item.action(); onClose(); }}
              type="button"
              onKeyDown={handleMenuKeyDown}
            >
              {item.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
};

export default ContextMenu;
