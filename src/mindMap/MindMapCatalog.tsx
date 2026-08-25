import { useEffect } from 'react';
import dayjs from 'dayjs';
import { Copy, FilePlus2, Trash2, X } from 'lucide-react';
import type { MindMapDocumentSummary } from './model';
import styles from './styles/MindMapWorkspace.module.css';

interface MindMapCatalogProps {
  documents: MindMapDocumentSummary[];
  activeDocumentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onClose: () => void;
}

const formatUpdatedAt = (updatedAt: number) => dayjs(updatedAt).format('YYYY-MM-DD HH:mm');

const MindMapCatalog = ({
  documents,
  activeDocumentId,
  onOpen,
  onNew,
  onDuplicate,
  onDelete,
  onClose,
}: MindMapCatalogProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.catalogOverlay}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.catalogPanel}
        role="dialog"
        aria-modal="true"
        aria-label="导图目录"
        data-testid="mind-map-catalog"
      >
        <header className={styles.catalogHeader}>
          <h2 className={styles.catalogTitle}>导图目录</h2>
          <div className={styles.catalogHeaderActions}>
            <button
              type="button"
              className={styles.catalogNewButton}
              data-testid="mind-map-catalog-new"
              onClick={onNew}
            >
              <FilePlus2 size={15} aria-hidden="true" />
              新建导图
            </button>
            <button
              type="button"
              className={styles.catalogClose}
              aria-label="关闭导图目录"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        {documents.length === 0 ? (
          <p className={styles.catalogEmpty}>还没有思维导图，点击「新建导图」开始。</p>
        ) : (
          <ul className={styles.catalogList} aria-label="思维导图列表">
            {documents.map((item) => {
              const active = item.id === activeDocumentId;
              return (
                <li key={item.id} className={active ? styles.catalogItemActive : undefined}>
                  <div
                    className={styles.catalogItem}
                    role="button"
                    tabIndex={0}
                    data-testid="mind-map-catalog-item"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onOpen(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpen(item.id);
                      }
                    }}
                  >
                    <div className={styles.catalogItemMain}>
                      <span className={styles.catalogItemTitle}>{item.title}</span>
                      <span className={styles.catalogItemMeta}>
                        {item.nodeCount} 个节点 · {item.edgeCount} 条连线 · 更新于 {formatUpdatedAt(item.updatedAt)}
                      </span>
                    </div>
                    {active && <span className={styles.catalogItemBadge}>当前</span>}
                    <div className={styles.catalogItemActions}>
                      <button
                        type="button"
                        aria-label={'复制 ' + item.title}
                        title="复制导图"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDuplicate(item.id);
                        }}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.catalogDelete}
                        aria-label={'删除 ' + item.title}
                        title="删除导图"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(item.id, item.title);
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MindMapCatalog;
