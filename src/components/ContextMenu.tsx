// ============================================================
// Smart Timeline - 右键上下文菜单
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import type { ContextMenuItem } from '@/types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 计算 transform-origin
  // 如果菜单在鼠标右下角展开，origin 是 top left
  // 根据视口边缘自适应（如靠近右侧则改为右展开）
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

      if (x + rect.width > viewportW) {
        newLeft = x - rect.width;
        newOriginX = 'right';
      }
      if (y + rect.height > viewportH) {
        newTop = y - rect.height;
        newOriginY = 'bottom';
      }
      
      setPosition({ top: newTop, left: newLeft });
      setOrigin(`${newOriginY} ${newOriginX}`);
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="tl-context-menu"
      style={{ left: position.left, top: position.top, transformOrigin: origin }}
    >
      {items.map((item, idx) => {
        // 纯分隔线项：只渲染分割线，不渲染按钮
        if (item.divider && !item.label) {
          return <div key={idx} className="tl-context-menu-divider" />;
        }
        return (
          <React.Fragment key={idx}>
            {item.divider && <div className="tl-context-menu-divider" />}
            <button
              className={`tl-context-menu-item ${item.danger ? 'tl-context-menu-item--danger' : ''}`}
              onClick={() => {
                item.action();
                onClose();
              }}
              type="button"
            >
              {item.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ContextMenu;
