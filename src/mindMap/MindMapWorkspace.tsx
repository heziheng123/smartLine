import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  CalendarRange,
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  FileCode2,
  FolderOpen,
  GitFork,
  Image as ImageIcon,
  Link2,
  Maximize2,
  MoreHorizontal,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Upload,
  Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/auth/AuthContext';
import { createEmptyLifeMapData } from '@/lifeMap/data';
import { projectTaskReferenceId, useProjectPlanningSnapshot } from '@/projectPlanning/adapter';
import MindMapCanvas from './canvas/MindMapCanvas';
import MindMapCatalog from './MindMapCatalog';
import { MIND_MAP_SYNC_ENABLED } from './config';
import {
  downloadMindMapJson,
  downloadMindMapSvg,
  parseMindMapDocumentJson,
  type MindMapPngScope,
} from './importExport';
import type { TreeDirection } from './layout';
import { migrateLifeMapIntoDocument } from './lifeMapMigration';
import LifePlanningPanel from './LifePlanningPanel';
import { createProjectReferenceCard, createTimelineSection, DEFAULT_DOCUMENT_TITLE, type MindMapNodeType, type ProjectReferenceCard } from './model';
import { mindMapRepository } from './repository';
import { useMindMapStore } from './store';
import { MindMapCatalogSession, MindMapSyncSession, type MindMapSyncViewState } from './sync';
import type { MindMapPresence } from './syncCore';
import { useLifeMapDataSnapshot, useLifeMapHydrated } from './timelineProjectionHooks';
import styles from './styles/MindMapWorkspace.module.css';
import { mindMapVisualCssVariables } from './styles/visualTokens';

const SAVE_LABEL = {
  idle: '准备就绪',
  saving: '正在保存…',
  saved: '已保存',
  error: '未保存',
} as const;

const SYNC_LABEL = {
  local: '仅本地',
  connecting: '正在同步…',
  connected: '云端已同步',
  offline: '离线，等待重连',
  error: '云同步异常',
} as const;

const MindMapWorkspace = () => {
  const auth = useAuth();
  const {
    isHydrated,
    index,
    document,
    history,
    saveStatus,
    error,
    hydrate,
    createDocument,
    renameDocument,
    duplicateDocument,
    switchDocument,
    deleteCurrentDocument,
    deleteDocument,
    importDocument,
    applyRemoteDocument,
    cacheRemoteDocument,
    applyRemoteCatalog,
    execute,
    undo,
    redo,
    flushSave,
    saveEmergency,
    clearError,
  } = useMindMapStore(useShallow((state) => state));
  const [scale, setScale] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const [pngRequest, setPngRequest] = useState(0);
  const [pngScope, setPngScope] = useState<MindMapPngScope>('viewport');
  const [treeDirection, setTreeDirection] = useState<TreeDirection>('left-right');
  const [treeLayoutRequest, setTreeLayoutRequest] = useState(0);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [lifePlanningOpen, setLifePlanningOpen] = useState(false);
  const [selectedNodeCount, setSelectedNodeCount] = useState(0);
  const [creationType, setCreationType] = useState<MindMapNodeType>('text');
  const [connectionMode, setConnectionMode] = useState(false);
  const [referenceTarget, setReferenceTarget] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [assetSyncError, setAssetSyncError] = useState<string | null>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const [syncRetry, setSyncRetry] = useState(0);
  const [syncState, setSyncState] = useState<MindMapSyncViewState>({
    status: 'local',
    roomId: null,
    error: null,
    others: [],
  });
  const importInputRef = useRef<HTMLInputElement>(null);
  const canvasSectionRef = useRef<HTMLElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const layoutMenuRef = useRef<HTMLDetailsElement>(null);
  const syncSessionRef = useRef<MindMapSyncSession | null>(null);
  const catalogSessionRef = useRef<MindMapCatalogSession | null>(null);
  const documentRef = useRef(document);
  const indexDocumentsRef = useRef(index.documents);
  documentRef.current = document;
  indexDocumentsRef.current = index.documents;
  const documentId = document?.id;
  const projectPlanning = useProjectPlanningSnapshot();
  const lifeMapData = useLifeMapDataSnapshot();
  const lifeMapHydrated = useLifeMapHydrated();
  const referenceOptions = useMemo(() => [
    ...projectPlanning.projects.map((project) => ({ value: `project:${project.id}`, label: `项目 · ${project.name}` })),
    ...projectPlanning.projects.flatMap((project) => project.blocks.flatMap((block) => block.type === 'smart-task'
      ? [{ value: `task:${projectTaskReferenceId(project.id, block.id)}`, label: `任务 · ${project.name} / ${block.header.title}` }]
      : [])),
    ...projectPlanning.milestones.map((milestone) => ({ value: `milestone:${milestone.id}`, label: `关键日期 · ${milestone.name}` })),
  ], [projectPlanning]);

  useEffect(() => setConnectionMode(false), [documentId]);

  useEffect(() => {
    const retry = () => setSyncRetry((value) => value + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  useEffect(() => {
    void hydrate();
    const handleVisibility = () => {
      if (window.document.visibilityState === 'hidden') void flushSave();
    };
    const handlePageHide = () => saveEmergency();
    window.document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      void flushSave();
    };
  }, [flushSave, hydrate, saveEmergency]);

  useEffect(() => {
    syncSessionRef.current?.stop();
    syncSessionRef.current = null;
    const currentDocument = documentRef.current;
    if (!MIND_MAP_SYNC_ENABLED || !currentDocument || !auth.enabled || auth.status !== 'authenticated' || !auth.userId) {
      setSyncState({ status: 'local', roomId: null, error: null, others: [] });
      return;
    }
    const session = new MindMapSyncSession({
      identity: auth.userId,
      name: auth.login || auth.userId,
      document: currentDocument,
      onDocument: applyRemoteDocument,
      onState: (state) => {
        if (syncSessionRef.current === session) setSyncState(state);
      },
    });
    syncSessionRef.current = session;
    void session.start();
    return () => {
      if (syncSessionRef.current === session) syncSessionRef.current = null;
      session.stop();
    };
  }, [applyRemoteDocument, auth.enabled, auth.login, auth.status, auth.userId, documentId, syncRetry]);

  useEffect(() => {
    catalogSessionRef.current?.stop();
    catalogSessionRef.current = null;
    if (!MIND_MAP_SYNC_ENABLED || !isHydrated || !auth.enabled || auth.status !== 'authenticated' || !auth.userId) return;
    const session = new MindMapCatalogSession({
      identity: auth.userId,
      name: auth.login || auth.userId,
      documents: indexDocumentsRef.current,
      onEntries: (entries) => void applyRemoteCatalog(entries),
      onError: setLocalError,
    });
    catalogSessionRef.current = session;
    void session.start();
    return () => {
      if (catalogSessionRef.current === session) catalogSessionRef.current = null;
      session.stop();
    };
  }, [applyRemoteCatalog, auth.enabled, auth.login, auth.status, auth.userId, isHydrated, syncRetry]);

  useEffect(() => {
    catalogSessionRef.current?.publish(index.documents);
  }, [index.documents]);

  useEffect(() => {
    if (!MIND_MAP_SYNC_ENABLED || !isHydrated || !auth.enabled || auth.status !== 'authenticated' || !auth.userId) return;
    const identity = auth.userId;
    const name = auth.login || identity;
    let cancelled = false;
    let activeSession: MindMapSyncSession | null = null;
    void (async () => {
      for (const summary of indexDocumentsRef.current) {
        if (cancelled || summary.id === documentRef.current?.id) continue;
        const backgroundDocument = await mindMapRepository.loadDocument(summary.id);
        if (!backgroundDocument) continue;
        let sessionError: string | null = null;
        let mergedDocument = null as typeof backgroundDocument | null;
        const session = new MindMapSyncSession({
          identity,
          name,
          document: backgroundDocument,
          onDocument: (remote) => { mergedDocument = remote; },
          onState: (state) => { sessionError = state.error; },
        });
        activeSession = session;
        await session.start();
        if (sessionError) throw new Error(sessionError);
        const syncedDocument = mergedDocument ?? backgroundDocument;
        await session.syncImageAssets(syncedDocument);
        await session.flush();
        if (mergedDocument) await cacheRemoteDocument(mergedDocument);
        session.stop();
        activeSession = null;
      }
    })().catch((syncError) => {
      if (!cancelled) setLocalError(syncError instanceof Error ? syncError.message : '后台导图同步失败。');
    });
    return () => {
      cancelled = true;
      activeSession?.stop();
    };
  }, [auth.enabled, auth.login, auth.status, auth.userId, cacheRemoteDocument, isHydrated, syncRetry]);

  useEffect(() => {
    if (!document || !MIND_MAP_SYNC_ENABLED || !auth.enabled || auth.status !== 'authenticated' || !auth.userId) {
      setAssetSyncError(null);
      return;
    }
    if (syncState.status !== 'connected' || !syncSessionRef.current) return;
    let cancelled = false;
    void syncSessionRef.current.syncImageAssets(document).then(({ downloaded }) => {
      if (cancelled) return;
      setAssetSyncError(null);
      if (downloaded > 0) setAssetRevision((value) => value + 1);
      const latest = documentRef.current;
      if (latest?.id === document.id) syncSessionRef.current?.publish(latest);
    }).catch((assetError) => {
      if (cancelled) return;
      setAssetSyncError(assetError instanceof Error ? assetError.message : '思维导图图片同步失败。');
      const latest = documentRef.current;
      if (latest?.id === document.id) syncSessionRef.current?.publish(latest);
    });
    return () => { cancelled = true; };
  }, [auth.enabled, auth.status, auth.userId, document, syncRetry, syncState.status]);

  const updatePresence = useCallback((patch: Partial<Pick<MindMapPresence, 'cursor' | 'draggingId' | 'editingId'>>) => {
    syncSessionRef.current?.updatePresence(patch);
  }, []);

  const confirmDelete = () => {
    if (!document) return;
    if (window.confirm('确定删除“' + document.title + '”吗？此操作只删除这张独立思维导图。')) {
      const deletedId = document.id;
      void deleteCurrentDocument().then((deleted) => {
        if (deleted) catalogSessionRef.current?.deleteDocument(deletedId);
      });
    }
  };

  const handleCatalogOpen = (id: string) => {
    setCatalogOpen(false);
    if (id !== documentId) void switchDocument(id);
  };

  const handleCatalogNew = () => {
    setCatalogOpen(false);
    void createDocument();
  };

  const handleCatalogDuplicate = (id: string) => {
    setCatalogOpen(false);
    void duplicateDocument(id);
  };

  const handleCatalogDelete = (id: string, title: string) => {
    if (!window.confirm('确定删除“' + title + '”吗？此操作只删除这张独立思维导图。')) return;
    void deleteDocument(id).then((deleted) => {
      if (deleted) catalogSessionRef.current?.deleteDocument(id);
    });
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLocalError(null);
    try {
      const imported = parseMindMapDocumentJson(await file.text());
      await importDocument(imported);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : '导入思维导图失败。');
    }
  };

  const runTreeLayout = useCallback(() => setTreeLayoutRequest((request) => request + 1), []);

  const runTreeLayoutInDirection = (direction: TreeDirection) => {
    setTreeDirection(direction);
    setTreeLayoutRequest((request) => request + 1);
    if (layoutMenuRef.current) layoutMenuRef.current.open = false;
  };

  const closeMoreMenu = () => {
    if (moreMenuRef.current) moreMenuRef.current.open = false;
  };

  const migrateLifeMap = async () => {
    if (!document || !lifeMapHydrated || migrationRunning) return;
    if (!window.confirm(document.lifeMap
      ? '这会用旧 Life Store 的内容替换当前地图内的人生规划，并先下载备份。是否继续？'
      : '将完整人生地图复制到当前导图，并先下载迁移前备份。是否继续？')) return;
    setMigrationRunning(true);
    setLocalError(null);
    try {
      let source = document;
      let result = await migrateLifeMapIntoDocument(source, lifeMapData);
      const latest = documentRef.current;
      if (latest?.id === source.id && latest.updatedAt !== source.updatedAt) {
        source = latest;
        result = await migrateLifeMapIntoDocument(source, lifeMapData);
      }
      const blob = new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `smartline-life-map-backup-${result.backup.createdAt.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      if (!result.changed) return;
      if (documentRef.current?.id !== source.id || documentRef.current.updatedAt !== source.updatedAt) {
        throw new Error('迁移期间地图已更新；已下载备份，请重新发起迁移。');
      }
      execute('迁移人生地图', (current) => current.id === result.document.id ? result.document : current);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : '迁移人生地图失败。');
    } finally {
      setMigrationRunning(false);
    }
  };

  const createProjectReference = () => {
    if (!document || !referenceTarget) return;
    const separator = referenceTarget.indexOf(':');
    const targetType = referenceTarget.slice(0, separator) as ProjectReferenceCard['targetType'];
    const targetId = referenceTarget.slice(separator + 1);
    if (separator < 1 || !targetId || !['project', 'task', 'milestone'].includes(targetType)) return;
    const rect = canvasSectionRef.current?.getBoundingClientRect();
    const center = {
      x: ((rect?.width ?? 800) / 2 - document.viewport.x) / document.viewport.scale,
      y: ((rect?.height ?? 600) / 2 - document.viewport.y) / document.viewport.scale,
    };
    const reference = createProjectReferenceCard(center, { targetType, targetId });
    execute('创建项目引用', (current) => ({
      ...current,
      projectReferences: { ...current.projectReferences, [reference.id]: reference },
    }));
    setReferenceTarget('');
  };

  const createTimeline = () => {
    if (!document) return;
    const rect = canvasSectionRef.current?.getBoundingClientRect();
    const center = {
      x: ((rect?.width ?? 800) / 2 - document.viewport.x) / document.viewport.scale,
      y: ((rect?.height ?? 600) / 2 - document.viewport.y) / document.viewport.scale,
    };
    const timeline = createTimelineSection({
      x: center.x,
      y: center.y + (Object.keys(document.projectReferences).length > 0 ? 240 : 0),
    });
    execute('创建时间线', (current) => ({
      ...current,
      timelineSections: { ...current.timelineSections, [timeline.id]: timeline },
    }));
  };

  const hasCanvasContent = Boolean(document && (
    Object.keys(document.nodes).length
    || Object.keys(document.projectReferences).length
    || Object.keys(document.timelineSections).length
  ));

  return (
    <main
      className={styles.workspace}
      style={mindMapVisualCssVariables}
      data-testid="mind-map-workspace"
      aria-label="地图工作区"
    >
      <header className={styles.header}>
        <h1 className={styles.srOnly}>地图工作区</h1>
        <div className={styles.documentControls}>
          {isHydrated && document ? (
            <div className={styles.documentRow}>
              <input
                className={styles.titleInput}
                data-testid="mind-map-title"
                aria-label="思维导图名称"
                value={document.title}
                placeholder={DEFAULT_DOCUMENT_TITLE}
                maxLength={120}
                onChange={(event) => renameDocument(event.target.value)}
                onBlur={(event) => {
                  if (!event.target.value.trim()) renameDocument(DEFAULT_DOCUMENT_TITLE);
                }}
              />
              <button
                type="button"
                className={styles.catalogToggle}
                data-testid="mind-map-catalog-toggle"
                aria-label="导图目录"
                aria-haspopup="dialog"
                aria-expanded={catalogOpen}
                title="导图目录"
                onClick={() => setCatalogOpen(true)}
              >
                <FolderOpen size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <span className={styles.loadingTitle}>地图工作区</span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconAction}
            title="撤销"
            aria-label="撤销"
            data-testid="mind-map-undo"
            disabled={history.undo.length === 0}
            onClick={undo}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconAction}
            title="重做"
            aria-label="重做"
            data-testid="mind-map-redo"
            disabled={history.redo.length === 0}
            onClick={redo}
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconAction}
            title="新建导图"
            aria-label="新建导图"
            data-testid="mind-map-new-document"
            onClick={() => void createDocument()}
          >
            <FilePlus2 size={16} aria-hidden="true" />
          </button>
          <details ref={moreMenuRef} className={styles.moreMenu}>
            <summary aria-label="更多操作" title="更多操作">
              <MoreHorizontal size={17} aria-hidden="true" />
            </summary>
            <div className={styles.moreMenuPanel} role="menu" aria-label="更多操作菜单">
              <button type="button" role="menuitem" onClick={() => {
                void duplicateDocument();
                closeMoreMenu();
              }} disabled={!document}>
                <Copy size={15} aria-hidden="true" />复制当前导图
              </button>
              <button type="button" role="menuitem" onClick={() => {
                void flushSave();
                closeMoreMenu();
              }} disabled={!document}>
                <Save size={15} aria-hidden="true" />立即保存
              </button>
              <button type="button" role="menuitem" onClick={() => {
                closeMoreMenu();
                void migrateLifeMap();
              }} disabled={!document || !lifeMapHydrated || migrationRunning}>
                <RefreshCw size={15} aria-hidden="true" />
                {migrationRunning ? '正在迁移…' : document?.lifeMap ? '从旧人生地图恢复' : '迁移人生地图'}
              </button>
              <span className={styles.menuDivider} aria-hidden="true" />
              <button type="button" role="menuitem" onClick={() => {
                importInputRef.current?.click();
                closeMoreMenu();
              }}>
                <Upload size={15} aria-hidden="true" />导入 JSON
              </button>
              <button type="button" role="menuitem" onClick={() => {
                if (document) void downloadMindMapJson(document);
                closeMoreMenu();
              }} disabled={!document}>
                <Download size={15} aria-hidden="true" />导出 JSON
              </button>
              <button type="button" role="menuitem" onClick={() => {
                if (document) downloadMindMapSvg(document);
                closeMoreMenu();
              }} disabled={!document}>
                <FileCode2 size={15} aria-hidden="true" />导出 SVG
              </button>
              <div className={styles.pngExportRow}>
                <button type="button" onClick={() => {
                  setPngRequest((value) => value + 1);
                  closeMoreMenu();
                }} disabled={!document || (pngScope === 'selection' && selectedNodeCount === 0)}>
                  <ImageIcon size={15} aria-hidden="true" />导出 PNG
                </button>
                <select
                  aria-label="PNG 导出范围"
                  value={pngScope}
                  onChange={(event) => setPngScope(event.target.value as MindMapPngScope)}
                >
                  <option value="viewport">当前视口</option>
                  <option value="all">全部内容</option>
                  <option value="selection">当前选择</option>
                </select>
              </div>
              <span className={styles.menuDivider} aria-hidden="true" />
              <button className={styles.dangerMenuItem} type="button" role="menuitem" onClick={() => {
                closeMoreMenu();
                confirmDelete();
              }} disabled={!document}>
                <Trash2 size={15} aria-hidden="true" />删除当前导图
              </button>
            </div>
          </details>
        </div>
      </header>
      <input
        ref={importInputRef}
        className={styles.hiddenInput}
        type="file"
        accept="application/json,.json"
        aria-label="选择思维导图 JSON 文件"
        onChange={(event) => void handleImport(event)}
      />

      {catalogOpen && (
        <MindMapCatalog
          documents={index.documents}
          activeDocumentId={documentId ?? null}
          onOpen={handleCatalogOpen}
          onNew={handleCatalogNew}
          onDuplicate={handleCatalogDuplicate}
          onDelete={handleCatalogDelete}
          onClose={() => setCatalogOpen(false)}
        />
      )}

      {(localError || error || assetSyncError || syncState.error) && (
        <div className={styles.errorBanner} role="alert">
          <span>{localError || error || assetSyncError || syncState.error}</span>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              setAssetSyncError(null);
              clearError();
              if (assetSyncError || syncState.error) setSyncRetry((value) => value + 1);
            }}
          >
            {assetSyncError || syncState.error ? '重试' : '关闭'}
          </button>
        </div>
      )}

      <section ref={canvasSectionRef} className={styles.canvas} aria-label="思维导图画布">
        <nav className={styles.floatingToolbar} aria-label="思维导图工具">
          <label className={styles.creationTool}>
            <span>节点</span>
            <select
              aria-label="新节点类型"
              value={creationType}
              onChange={(event) => setCreationType(event.target.value as MindMapNodeType)}
            >
              <option value="text">文本</option>
              <option value="markdown">Markdown</option>
              <option value="latex">LaTeX</option>
              <option value="url">URL</option>
              <option value="image">图片</option>
            </select>
          </label>
          <span className={styles.referenceGroup}>
            <label className={`${styles.creationTool} ${styles.referenceTool}`}>
              <span>引用</span>
              <select
                aria-label="选择项目规划引用"
                value={referenceTarget}
                disabled={referenceOptions.length === 0}
                onChange={(event) => setReferenceTarget(event.target.value)}
              >
                <option value="">选择项目或任务</option>
                {referenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className={styles.referenceCreateButton} type="button" aria-label="将引用放入画布" title="将引用放入画布" disabled={!referenceTarget} onClick={createProjectReference}>
              <Plus size={15} aria-hidden="true" />
            </button>
          </span>
          <button type="button" onClick={createTimeline} disabled={!document}>
            <CalendarRange size={15} aria-hidden="true" />时间规划
          </button>
          <button type="button" onClick={() => {
            if (!document) return;
            if (!document.lifeMap) execute('启用人生规划', (current) => ({ ...current, lifeMap: createEmptyLifeMapData(), lifeMapMigration: null }));
            setLifePlanningOpen(true);
          }} disabled={!document}>
            <CalendarRange size={15} aria-hidden="true" />人生规划
          </button>
          <button
            type="button"
            className={connectionMode ? styles.toolActive : undefined}
            aria-pressed={connectionMode}
            disabled={!document || Object.keys(document.nodes).length + Object.keys(document.projectReferences).length < 2}
            title="依次点击起点和终点对象；也可以拖动对象的关联入口"
            onClick={() => setConnectionMode((active) => !active)}
          >
            <Link2 size={15} aria-hidden="true" />连线
          </button>
          <details ref={layoutMenuRef} className={styles.layoutMenu}>
            <summary data-testid="mind-map-layout-menu">
              <GitFork size={15} aria-hidden="true" />
              {layoutRunning ? '布局中…' : '布局'}
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div className={styles.layoutMenuPanel} role="menu" aria-label="布局菜单">
              <button
                type="button"
                role="menuitem"
                data-testid="mind-map-layout-tree"
                disabled={layoutRunning || !document || Object.keys(document.nodes).length < 2}
                onClick={() => {
                  runTreeLayout();
                  if (layoutMenuRef.current) layoutMenuRef.current.open = false;
                }}
              >{selectedNodeCount === 1 ? '整理当前分支' : '整理全部节点'}</button>
              <span className={styles.menuDivider} aria-hidden="true" />
              <button type="button" role="menuitem" onClick={() => runTreeLayoutInDirection('left-right')}>左 → 右</button>
              <button type="button" role="menuitem" onClick={() => runTreeLayoutInDirection('right-left')}>右 → 左</button>
              <button type="button" role="menuitem" onClick={() => runTreeLayoutInDirection('top-bottom')}>上 → 下</button>
              <button type="button" role="menuitem" onClick={() => runTreeLayoutInDirection('bottom-top')}>下 → 上</button>
              <span className={styles.menuDivider} aria-hidden="true" />
              <button type="button" role="menuitem" disabled={!hasCanvasContent} onClick={() => {
                setFitRequest((value) => value + 1);
                if (layoutMenuRef.current) layoutMenuRef.current.open = false;
              }}><Maximize2 size={14} aria-hidden="true" />适合画布</button>
            </div>
          </details>
        </nav>
        {!isHydrated ? (
          <div className={styles.loading} role="status">正在加载独立思维导图…</div>
        ) : document ? (
          <MindMapCanvas
            document={document}
            assetRevision={assetRevision}
            fitRequest={fitRequest}
            treeLayoutRequest={treeLayoutRequest}
            treeDirection={treeDirection}
            onLayoutRunningChange={setLayoutRunning}
            pngRequest={pngRequest}
            pngScope={pngScope}
            creationType={creationType}
            connectionMode={connectionMode}
            onConnectionModeChange={setConnectionMode}
            remotePresences={syncState.others}
            onPresenceChange={updatePresence}
            onSelectionChange={setSelectedNodeCount}
            onScaleChange={setScale}
          />
        ) : (
          <div className={styles.loading} role="status">暂时无法打开思维导图。</div>
        )}
      </section>

      {lifePlanningOpen && document?.lifeMap && <LifePlanningPanel
        data={document.lifeMap}
        onClose={() => setLifePlanningOpen(false)}
        onChange={(lifeMap, label) => execute(label, (current) => ({
          ...current,
          lifeMap,
          lifeMapMigration: null,
          updatedAt: Date.now(),
        }))}
      />}

      <footer className={styles.statusBar}>
        <span>{Math.round(scale * 100)}%</span>
        <span data-testid="mind-map-save-status">{SAVE_LABEL[saveStatus]}</span>
        <details className={styles.statusDetails}>
          <summary aria-label="查看地图状态详情" title="查看地图状态详情"><MoreHorizontal size={14} aria-hidden="true" /></summary>
          <div>
            <span>{document ? Object.keys(document.nodes).length : 0} 个节点</span>
            <span>{document ? Object.keys(document.projectReferences).length : 0} 个项目引用</span>
            <span>{document ? Object.keys(document.timelineSections).length : 0} 个时间规划</span>
            <span className={styles.syncStatus} data-testid="mind-map-sync-status" title={syncState.roomId || undefined}>
              <Cloud size={12} aria-hidden="true" />{SYNC_LABEL[assetSyncError ? 'error' : syncState.status]}
            </span>
            {syncState.others.length > 0 && <span>{syncState.others.length + 1} 人在线</span>}
            {(syncState.status === 'offline' || syncState.status === 'error' || assetSyncError) && <button className={styles.syncRetry} type="button" aria-label="重试思维导图云同步" onClick={() => setSyncRetry((value) => value + 1)}><RefreshCw size={12} aria-hidden="true" /></button>}
          </div>
        </details>
      </footer>
    </main>
  );
};

export default MindMapWorkspace;
