import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { requestConfirmation } from '@/services/confirmation';
import { useShallow } from 'zustand/react/shallow';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Settings2, X, Info, Search, ChevronDown, Command, Zap, Archive, Network, Focus, MoveRight, Check, ListFilter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MOTION_SPRING_GENTLE, MOTION_TRANSITION_STANDARD } from '@/motion/system';
import { createPortal } from 'react-dom';
import { ArchiveLibraryModal, TimeCapsuleModal } from '@/components/GlobalSearch';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import {
  getQuantityCompleted,
  getQuantityProgressPercent,
  getQuantityTotal,
  getQuantityUnit,
  getValidGraphNodeIds,
  isQuantityTask,
  shouldAutoSyncEbb,
} from '@/utils/blocks';
import { computeNodeActivationStates } from '../activation';
import styles from './GraphConsole.module.css';
import { useGraphBindingStore } from '../bindingStore';
import NodeLearningSummary, { type NodeDetailScope, type NodeLearningSummaryData, type NodeMasteryState } from './NodeLearningSummary';
import type { SmartTaskBlock, Task } from '@/types';
import { getUniqueTasks } from '@/store/timelineData';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import NodeRetrospectiveRecords from './NodeRetrospectiveRecords';
import { isRetrospectiveEntryCurrentlyCompleted } from '@/domain/dailyRetrospective';
import { clearKnowledgeNodeFocus, peekKnowledgeNodeFocus } from '@/services/actionBridge';

import { stratify, partition, type HierarchyNode, type HierarchyRectangularNode } from 'd3-hierarchy';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { select } from 'd3-selection';
import { arc } from 'd3-shape';
import 'd3-transition';

type NodeRollupStats = {
  totalReviewCount: number;
  pendingCount: number;
  completedCount: number;
  overdueCount: number;
};

type NodeVisualState = 'inactive' | 'completed-no-review' | 'reviewing' | 'mastered';

type GraphRadiusMode = 'overview' | 'reading' | 'expanded';
type GraphStatusFilter = 'all' | 'inactive' | 'overdue' | 'reviewing' | 'completed-no-review' | 'mastered';
type DockPanel = 'view' | 'filter' | 'search' | null;

const GRAPH_RADIUS_FLOOR: Record<GraphRadiusMode, number> = {
  overview: 0,
  reading: 640,
  expanded: 880,
};

const GRAPH_STATUS_OPTIONS: Array<{
  value: Exclude<GraphStatusFilter, 'all'>;
  label: string;
  dotClass: string;
}> = [
  { value: 'inactive', label: '未激活', dotClass: 'bg-slate-500' },
  { value: 'overdue', label: '严重逾期', dotClass: 'bg-rose-500' },
  { value: 'completed-no-review', label: '已激活 · 无复习计划', dotClass: 'bg-blue-500' },
  { value: 'reviewing', label: '复习中', dotClass: 'bg-emerald-500' },
  { value: 'mastered', label: '复习已完成', dotClass: 'bg-amber-500' },
];

const NODE_STATE_COLOR: Record<NodeVisualState, string> = {
  inactive: '#64748b',
  'completed-no-review': '#3b82f6',
  reviewing: '#10b981',
  mastered: '#eab308',
};

const NODE_STATE_LABEL: Record<NodeVisualState, string> = {
  inactive: '未激活',
  'completed-no-review': '已激活 · 无复习计划',
  reviewing: '复习中',
  mastered: '复习已完成',
};

const getNodeStateLabel = (value: unknown): string =>
  typeof value === 'string' && value in NODE_STATE_LABEL
    ? NODE_STATE_LABEL[value as NodeVisualState]
    : NODE_STATE_LABEL.inactive;

type ViewNode = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  status: string;
  visualState: NodeVisualState;
  isActivated: boolean;
  depth: number;
  rootId: string;
  isLeaf: boolean;
  activeCount: number;
  totalLeafCount: number;
  pendingCount: number;
  completedCount: number;
  overdueCount: number;
  totalReviewCount: number;
};

type GraphIsland = {
  rootId: string;
  root: HierarchyNode<ViewNode>;
  nodes: HierarchyRectangularNode<ViewNode>[];
  flatNodes: ViewNode[];
  centerX: number;
  centerY: number;
  radius: number;
};

const getAccessibleTextColor = (hexcolor: string) => {
  const normalized = hexcolor.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#ffffff';
  const channels = normalized.match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255);
  const luminance = channels
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (textLuminance: number) => (Math.max(luminance, textLuminance) + 0.05)
    / (Math.min(luminance, textLuminance) + 0.05);
  return contrast(0.0152) > contrast(1) ? '#0f172a' : '#ffffff';
};

export const KnowledgeGraphView: React.FC = () => {
  const [bridgeNodeId] = useState(peekKnowledgeNodeFocus);
  const { isHydrated, hydrateStore, nodes: allNodes, addNode, deleteNode, updateNode, archiveNodeCascade } = useGraphStore(
    useShallow((state) => ({
      isHydrated: state.isHydrated,
      hydrateStore: state.hydrateStore,
      nodes: state.nodes,
      addNode: state.addNode,
      deleteNode: state.deleteNode,
      updateNode: state.updateNode,
      archiveNodeCascade: state.archiveNodeCascade,
    })),
  );
  const nodes = useMemo(() => allNodes.filter(n => !n.isArchived), [allNodes]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const children = map.get(node.parentId) ?? [];
      children.push(node.id);
      map.set(node.parentId, children);
    }
    return map;
  }, [nodes]);
  const getSubtreeNodeIds = useCallback((rootId: string): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      ids.push(nodeId);
      const childIds = childrenByParent.get(nodeId) ?? [];
      for (let index = childIds.length - 1; index >= 0; index -= 1) stack.push(childIds[index]);
    }
    return ids;
  }, [childrenByParent]);
  const getDescendants = useCallback(
    (nodeId: string) => getSubtreeNodeIds(nodeId).slice(1),
    [getSubtreeNodeIds],
  );
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const { retrospectives, schedules } = useDailyScheduleStore(useShallow((state) => ({
    retrospectives: state.retrospectives,
    schedules: state.schedules,
  })));
  const { tasks, groups } = useTimelineStore(useShallow((state) => ({ tasks: state.tasks, groups: state.groups })));
  const allProjectTasks = useMemo(() => getUniqueTasks(tasks, groups), [tasks, groups]);
  const bindingSession = useGraphBindingStore(useShallow((state) => ({
    active: state.active,
    isConfirming: state.isConfirming,
    taskTitle: state.taskTitle,
    selectedNodeIds: state.selectedNodeIds,
    toggleNode: state.toggleNode,
    setSelectedNodeIds: state.setSelectedNodeIds,
    cancel: state.cancel,
    confirm: state.confirm,
  })));
  const [bindingError, setBindingError] = useState('');

  const [newRootName, setNewRootName] = useState('');
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newChildName, setNewChildName] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [detailScope, setDetailScope] = useState<NodeDetailScope>('subtree');

  // Filter States
  const [selectedRootFilter, setSelectedRootFilter] = useState<string>('all');
  const [radiusMode, setRadiusMode] = useState<GraphRadiusMode>('overview');
  const [statusFilter, setStatusFilter] = useState<GraphStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDockPanel, setActiveDockPanel] = useState<DockPanel>(null);
  const [moveError, setMoveError] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dockControlsRef = useRef<HTMLDivElement>(null);
  const dockPanelRef = useRef<HTMLDivElement>(null);
  const recenterButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewportShiftedRef = useRef(false);
  const setRecenterButtonRef = useCallback((button: HTMLButtonElement | null) => {
    recenterButtonRef.current = button;
    if (button) button.hidden = !viewportShiftedRef.current;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomTransformRef = useRef<ZoomTransform | null>(null);
  const userZoomInProgressRef = useRef(false);
  const didInitialViewportFitRef = useRef(false);
  const lastViewportModeRef = useRef<string | null>(null);
  const lastSelectedNodeIdRef = useRef<string | null>(null);
  const isEditingNameRef = useRef(false);

  // Hover states
  const [capsuleNodeId, setCapsuleNodeId] = useState<string | null>(null);
  const [isArchiveLibraryOpen, setIsArchiveLibraryOpen] = useState(false);

  const [showHint, setShowHint] = useState(() => {
    return localStorage.getItem('knowledge-graph-hint-dismissed') !== 'true';
  });

  useEffect(() => {
    if (!bridgeNodeId || !nodeById.has(bridgeNodeId)) return;
    setSelectedNodeId(bridgeNodeId);
    setIsPanelOpen(true);
  }, [bridgeNodeId, nodeById]);

  useEffect(() => {
    if (bridgeNodeId) clearKnowledgeNodeFocus();
  }, [bridgeNodeId]);

  useEffect(() => {
    if (!activeDockPanel) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!dockControlsRef.current?.contains(target) && !dockPanelRef.current?.contains(target)) {
        setActiveDockPanel(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !bindingSession.active) setActiveDockPanel(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeDockPanel, bindingSession.active]);

  useEffect(() => {
    if (activeDockPanel !== 'search') return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [activeDockPanel]);

  // Rotation angles for islands
  const [islandRotations, setIslandRotations] = useState<Record<string, number>>({});

  const focusRoot = useCallback((rootId: string) => {
    setSelectedRootFilter(rootId);
    setRadiusMode(rootId === 'all' ? 'overview' : 'reading');
  }, []);

  useEffect(() => {
    if (!isHydrated) hydrateStore();
  }, [isHydrated, hydrateStore]);

  useEffect(() => {
    if (!bindingSession.active) return;
    setSelectedNodeId(null);
    setIsPanelOpen(false);
    setIsMoveMode(false);
    setMoveError('');
    setBindingError('');
  }, [bindingSession.active]);

  useEffect(() => {
    if (!bindingSession.active || !isHydrated) return;
    const validLeafIds = new Set(nodes.filter((node) => !childrenByParent.has(node.id)).map((node) => node.id));
    const validSelection = bindingSession.selectedNodeIds.filter((id) => validLeafIds.has(id));
    if (validSelection.length !== bindingSession.selectedNodeIds.length) {
      bindingSession.setSelectedNodeIds(validSelection);
    }
  }, [bindingSession, childrenByParent, isHydrated, nodes]);

  useEffect(() => {
    if (!bindingSession.active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') bindingSession.cancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bindingSession]);

  useEffect(() => {
    if (showHint) {
      const timer = setTimeout(() => {
        setShowHint(false);
        localStorage.setItem('knowledge-graph-hint-dismissed', 'true');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showHint]);

  const activationStates = useMemo(
    () => computeNodeActivationStates(nodes),
    [nodes],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const commitSize = (width: number, height: number) => {
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      if (nextWidth <= 0 || nextHeight <= 0) return false;
      setDimensions((previous) => (
        previous.width === nextWidth && previous.height === nextHeight
          ? previous
          : { width: nextWidth, height: nextHeight }
      ));
      return true;
    };

    const updateSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (!commitSize(width, height)) {
        // Fallback to approximate window size if container is hidden/0
        setDimensions((previous) => (
          previous.width === 0
            ? { width: window.innerWidth - 64, height: window.innerHeight - 100 }
            : previous
        ));
      }
    };
    
    updateSize();

    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        commitSize(width, height);
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isHydrated]);

  const reviewsByNode = useMemo(() => {
    const map = new Map<string, typeof reviewTasks>();
    for (const task of reviewTasks) {
      if (!task.graphNodeId || task.isArchived) continue;
      const list = map.get(task.graphNodeId) ?? [];
      list.push(task);
      map.set(task.graphNodeId, list);
    }
    return map;
  }, [reviewTasks]);

  const completedBindingsByNode = useMemo(() => {
    const map = new Map<string, { hasAutoReview: boolean; hasNoAutoReview: boolean }>();
    allProjectTasks.forEach((task) => {
      const blocks = Array.isArray(task.blocks) ? task.blocks : [];
      blocks.forEach((block) => {
        if (block.type !== 'smart-task' || block.header.isArchived || !block.header.isCompleted) return;
        getValidGraphNodeIds(block.header).forEach((nodeId) => {
          const current = map.get(nodeId) ?? { hasAutoReview: false, hasNoAutoReview: false };
          if (shouldAutoSyncEbb(block.header)) current.hasAutoReview = true;
          else current.hasNoAutoReview = true;
          map.set(nodeId, current);
        });
      });
    });
    return map;
  }, [allProjectTasks]);

  const nodeVisualStates = useMemo(() => {
    const states = new Map<string, NodeVisualState>();
    const visiting = new Set<string>();
    const visit = (nodeId: string): NodeVisualState => {
      const cached = states.get(nodeId);
      if (cached) return cached;
      if (visiting.has(nodeId)) {
        return 'inactive';
      }
      if (!(activationStates.get(nodeId)?.isActivated ?? false)) {
        states.set(nodeId, 'inactive');
        return 'inactive';
      }

      visiting.add(nodeId);
      const childIds = childrenByParent.get(nodeId) ?? [];
      let state: NodeVisualState;
      if (childIds.length === 0) {
        const rounds = reviewsByNode.get(nodeId) ?? [];
        state = rounds.length > 0
          ? (rounds.every((task) => task.isCompleted) ? 'mastered' : 'reviewing')
          : (completedBindingsByNode.get(nodeId)?.hasAutoReview ? 'reviewing' : 'completed-no-review');
      } else {
        const childStates = childIds.map(visit);
        state = childStates.every((childState) => childState === 'mastered')
          ? 'mastered'
          : childStates.some((childState) => childState === 'reviewing')
            ? 'reviewing'
            : 'completed-no-review';
      }
      visiting.delete(nodeId);
      states.set(nodeId, state);
      return state;
    };

    nodes.forEach((node) => visit(node.id));
    return states;
  }, [activationStates, childrenByParent, completedBindingsByNode, nodes, reviewsByNode]);

  const getNodeVisualState = useCallback(
    (nodeId: string): NodeVisualState => nodeVisualStates.get(nodeId) ?? 'inactive',
    [nodeVisualStates],
  );

  const getNodeColorHex = useCallback(
    (nodeId: string): string => NODE_STATE_COLOR[getNodeVisualState(nodeId)],
    [getNodeVisualState],
  );

  const islandsData = useMemo(() => {
    const today = todayStr();
    const directStatsByNode = new Map<string, NodeRollupStats>();
    for (const [nodeId, tasksForNode] of reviewsByNode) {
      const stats: NodeRollupStats = {
        totalReviewCount: 0,
        pendingCount: 0,
        completedCount: 0,
        overdueCount: 0,
      };
      for (const task of tasksForNode) {
        stats.totalReviewCount += 1;
        if (task.isCompleted) stats.completedCount += 1;
        else {
          stats.pendingCount += 1;
          if (diffDays(today, task.dueDate) > 0) stats.overdueCount += 1;
        }
      }
      directStatsByNode.set(nodeId, stats);
    }

    const nodeStatsMap = new Map<string, NodeRollupStats>();
    const collectStats = (nodeId: string, path = new Set<string>()): NodeRollupStats => {
      const cached = nodeStatsMap.get(nodeId);
      if (cached) return cached;
      if (path.has(nodeId)) {
        return { totalReviewCount: 0, pendingCount: 0, completedCount: 0, overdueCount: 0 };
      }

      const direct = directStatsByNode.get(nodeId);
      const stats: NodeRollupStats = direct
        ? { ...direct }
        : { totalReviewCount: 0, pendingCount: 0, completedCount: 0, overdueCount: 0 };
      path.add(nodeId);
      for (const childId of childrenByParent.get(nodeId) ?? []) {
        const childStats = collectStats(childId, path);
        stats.totalReviewCount += childStats.totalReviewCount;
        stats.pendingCount += childStats.pendingCount;
        stats.completedCount += childStats.completedCount;
        stats.overdueCount += childStats.overdueCount;
      }
      path.delete(nodeId);
      nodeStatsMap.set(nodeId, stats);
      return stats;
    };
    nodes.forEach((node) => collectStats(node.id));

    let rootsToProcess: string[] = [];
    if (selectedRootFilter !== 'all' && nodeById.has(selectedRootFilter)) {
      rootsToProcess = [selectedRootFilter];
    } else {
      rootsToProcess = nodes.filter(n => !n.parentId).map(n => n.id);
    }

    if (dimensions.width === 0 || dimensions.height === 0 || rootsToProcess.length === 0) {
      return { islands: [], allFlatNodes: [] };
    }

    const islands: GraphIsland[] = [];
    let allFlatNodes: ViewNode[] = [];

    // Calculate grid layout for islands
    const cols = Math.ceil(Math.sqrt(rootsToProcess.length));
    const naturalRadius = Math.max(100, Math.min(dimensions.width, dimensions.height) / 2 - 60);
    const baseRadius = rootsToProcess.length === 1
      ? Math.max(naturalRadius, GRAPH_RADIUS_FLOOR[radiusMode])
      : 400; // 折中方案：从 500 回调到 400，既保证文字展示量，又不会导致环太宽显得笨重
    
    const cellWidth = baseRadius * 2 + 160;
    const cellHeight = baseRadius * 2 + 160;
    
    const totalWidth = cols * cellWidth;
    const rows = Math.ceil(rootsToProcess.length / cols);
    const totalHeight = rows * cellHeight;
    
    const startX = -totalWidth / 2 + cellWidth / 2;
    const startY = -totalHeight / 2 + cellHeight / 2;

    rootsToProcess.forEach((rootId, index) => {
      const flatData = getSubtreeNodeIds(rootId)
        .flatMap((nodeId) => {
          const node = nodeById.get(nodeId);
          if (!node) return [];
          const activationState = activationStates.get(node.id);
          const isLeaf = activationState?.isLeaf ?? !childrenByParent.has(node.id);
          const stats = nodeStatsMap.get(node.id) ?? {
            totalReviewCount: 0, pendingCount: 0, completedCount: 0, overdueCount: 0,
          };

          return [{
            id: node.id,
            name: node.name,
            parentId: node.id === rootId ? null : node.parentId,
            color: getNodeColorHex(node.id),
            status: activationState?.isActivated ? 'activated' : 'unactivated',
            visualState: getNodeVisualState(node.id),
            isActivated: activationState?.isActivated ?? false,
            isLeaf,
            activeCount: isLeaf ? 0 : activationState?.activatedLeafCount ?? 0,
            totalLeafCount: isLeaf ? 0 : activationState?.totalLeafCount ?? 0,
            ...stats,
            depth: 0,
            rootId: rootId
          } as ViewNode];
        });

      allFlatNodes = allFlatNodes.concat(flatData);

      try {
        const root = stratify<ViewNode>()
          .id(d => d.id)
          .parentId(d => d.parentId)(flatData);

        root.sum(d => childrenByParent.has(d.id) ? 0 : 1);
        root.sort((a, b) => (b.value || 0) - (a.value || 0));

        const partitionLayout = partition<ViewNode>().size([2 * Math.PI, baseRadius]);
        partitionLayout(root);

        const col = index % cols;
        const row = Math.floor(index / cols);
        const centerX = rootsToProcess.length === 1 ? 0 : startX + col * cellWidth;
        const centerY = rootsToProcess.length === 1 ? 0 : startY + row * cellHeight;

        islands.push({
          rootId,
          root,
          nodes: root.descendants() as HierarchyRectangularNode<ViewNode>[],
          flatNodes: flatData,
          centerX,
          centerY,
          radius: baseRadius
        });
      } catch (e) {
        console.error('D3 Stratify error for root', rootId, e);
      }
    });

    return { islands, allFlatNodes };
  }, [activationStates, childrenByParent, dimensions.height, dimensions.width, getNodeColorHex, getNodeVisualState, getSubtreeNodeIds, nodeById, nodes, radiusMode, reviewsByNode, selectedRootFilter]);

  const arcGenerator = useMemo(() => {
    return arc<HierarchyRectangularNode<ViewNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => d.depth === 0 ? 0 : d.y0 + 3)
      .outerRadius(d => d.depth === 0 ? d.y1 - 5 : Math.max(0, d.y1 - 3))
      .cornerRadius(4)
      .padAngle(0.006);
  }, []);

  const rootNodes = useMemo(() => nodes.filter(n => !n.parentId), [nodes]);
  const hasFocusedRoot = selectedRootFilter !== 'all' && nodeById.has(selectedRootFilter);
  const canExpandRadius = rootNodes.length === 1 || hasFocusedRoot;

  useEffect(() => {
    if (!canExpandRadius && radiusMode !== 'overview') setRadiusMode('overview');
  }, [canExpandRadius, radiusMode]);

  const changeRadiusMode = useCallback((mode: GraphRadiusMode) => {
    if (mode === 'overview') {
      focusRoot('all');
      return;
    }

    if (!canExpandRadius) {
      let targetRootId = rootNodes[0]?.id;
      let current = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
      const visited = new Set<string>();
      while (current?.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = nodeById.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      if (current && !current.parentId) targetRootId = current.id;
      if (targetRootId) setSelectedRootFilter(targetRootId);
    }
    setRadiusMode(mode);
  }, [canExpandRadius, focusRoot, nodeById, rootNodes, selectedNodeId]);

  const statusCounts = useMemo(() => {
    const counts: Record<Exclude<GraphStatusFilter, 'all'>, number> = {
      inactive: 0,
      overdue: 0,
      reviewing: 0,
      'completed-no-review': 0,
      mastered: 0,
    };
    islandsData.allFlatNodes.forEach((node: ViewNode) => {
      if (node.visualState === 'inactive') counts.inactive += 1;
      if (node.isActivated && node.overdueCount > 0) counts.overdue += 1;
      if (node.visualState === 'reviewing' && node.overdueCount === 0) counts.reviewing += 1;
      if (node.visualState === 'completed-no-review') counts['completed-no-review'] += 1;
      if (node.visualState === 'mastered') counts.mastered += 1;
    });
    return counts;
  }, [islandsData.allFlatNodes]);

  const matchingNodeIds = useMemo(() => {
    if (statusFilter === 'all' && !searchQuery.trim()) return null;
    const query = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();

    islandsData.allFlatNodes.forEach((node: ViewNode) => {
      let isMatch = false;
      const matchStatus = statusFilter === 'all' 
        || (statusFilter === 'inactive' && node.visualState === 'inactive')
        || (statusFilter === 'overdue' && node.isActivated && node.overdueCount > 0)
        || (statusFilter === 'reviewing' && node.visualState === 'reviewing' && node.overdueCount === 0)
        || (statusFilter === 'completed-no-review' && node.visualState === 'completed-no-review')
        || (statusFilter === 'mastered' && node.visualState === 'mastered');

      const matchQuery = !query || node.name.toLowerCase().includes(query);

      if (matchStatus && matchQuery) isMatch = true;

      if (isMatch) {
        matched.add(node.id);
        let currId = node.id;
        while (currId) {
          matched.add(currId);
          const parent = nodeById.get(currId);
          currId = parent?.parentId || '';
        }
      }
    });

    return matched;
  }, [islandsData.allFlatNodes, nodeById, searchQuery, statusFilter]);

  // Setup D3 Zoom
  useEffect(() => {
    if (!isHydrated || !svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    const commitPendingZoomTransform = () => {
      const transform = pendingZoomTransformRef.current;
      if (transform && gRef.current) gRef.current.setAttribute('transform', transform.toString());
    };
    zoomBehaviorRef.current = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('start', (event) => {
        if (!event.sourceEvent) return;
        svg.interrupt();
        userZoomInProgressRef.current = true;
      })
      .on('zoom', (event) => {
        pendingZoomTransformRef.current = event.transform;
        if (zoomFrameRef.current !== null) return;
        zoomFrameRef.current = requestAnimationFrame(() => {
          zoomFrameRef.current = null;
          commitPendingZoomTransform();
        });
      })
      .on('end', () => {
        if (!userZoomInProgressRef.current) return;
        userZoomInProgressRef.current = false;
        if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
        commitPendingZoomTransform();
        if (!viewportShiftedRef.current) {
          viewportShiftedRef.current = true;
          recenterButtonRef.current?.removeAttribute('hidden');
        }
      });
    svg.call(zoomBehaviorRef.current);
    return () => {
      if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
      pendingZoomTransformRef.current = null;
      userZoomInProgressRef.current = false;
      svg.on('.zoom', null);
    };
  }, [isHydrated]);

  const zoomToFit = useCallback((animate = true) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = select(svgRef.current);
    viewportShiftedRef.current = false;
    recenterButtonRef.current?.setAttribute('hidden', '');
    
    const islands = islandsData.islands;
    if (islands.length === 0 || dimensions.width === 0 || dimensions.height === 0) return;
    const minX = Math.min(...islands.map((island) => island.centerX - island.radius));
    const maxX = Math.max(...islands.map((island) => island.centerX + island.radius));
    const minY = Math.min(...islands.map((island) => island.centerY - island.radius));
    const maxY = Math.max(...islands.map((island) => island.centerY + island.radius + 46));
    const padding = 64;
    const scale = Math.min(
      1,
      (dimensions.width - padding * 2) / Math.max(1, maxX - minX),
      (dimensions.height - padding * 2) / Math.max(1, maxY - minY),
    );
    const centerX = dimensions.width / 2 + (minX + maxX) / 2;
    const centerY = dimensions.height / 2 + (minY + maxY) / 2;
    const transform = zoomIdentity
      .translate(dimensions.width / 2, dimensions.height / 2)
      .scale(scale)
      .translate(-centerX, -centerY);

    svg.interrupt();
    if (animate) {
      svg.transition().duration(220).call(zoomBehaviorRef.current.transform, transform);
    } else {
      svg.call(zoomBehaviorRef.current.transform, transform);
    }
  }, [islandsData.islands, dimensions.height, dimensions.width]);

  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0 || islandsData.islands.length === 0) return;
    const modeKey = `${selectedRootFilter}:${radiusMode}`;
    if (didInitialViewportFitRef.current && lastViewportModeRef.current === modeKey) return;
    zoomToFit(false);
    didInitialViewportFitRef.current = true;
    lastViewportModeRef.current = modeKey;
  }, [islandsData.islands.length, zoomToFit, selectedRootFilter, radiusMode, dimensions.height, dimensions.width]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const selectedActivationState = selectedNodeId
    ? activationStates.get(selectedNodeId) ?? null
    : null;
  const selectedVisualState = selectedNodeId ? getNodeVisualState(selectedNodeId) : 'inactive';
  
  // Auto-focus rotation logic
  useEffect(() => {
    if (!selectedNodeId || !islandsData) return;
    
    // Find the node in the d3 hierarchy to get its angles
    let targetNode: HierarchyRectangularNode<ViewNode> | null = null;
    let islandRootId: string | null = null;
    
    for (const island of islandsData.islands) {
      const found = island.nodes.find((node) => node.data.id === selectedNodeId);
      if (found) {
        targetNode = found;
        islandRootId = island.rootId;
        break;
      }
    }
    
    if (targetNode && islandRootId && targetNode.depth > 0) {
      // Calculate the middle angle of the selected node
      const midAngle = (targetNode.x0 + targetNode.x1) / 2;
      
      // Convert to degrees. D3 partition starts at 0 (top/12 o'clock) and goes clockwise.
      // We want to rotate the chart counter-clockwise by midAngle to bring the node to 0.
      let targetRotation = - (midAngle * 180 / Math.PI);
      
      targetRotation = ((targetRotation % 360) + 360) % 360;
      
      setIslandRotations(prev => ({
        ...prev,
        [islandRootId as string]: targetRotation
      }));
    } else if (islandRootId && targetNode && targetNode.depth === 0) {
      // Reset rotation when root is clicked
      setIslandRotations(prev => ({
        ...prev,
        [islandRootId as string]: 0
      }));
    }
  }, [selectedNodeId, islandsData]);
  
  const selectedScopeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = detailScope === 'subtree'
      ? [selectedNodeId, ...getDescendants(selectedNodeId)]
      : [selectedNodeId];
    return new Set(ids);
  }, [selectedNodeId, detailScope, getDescendants]);

  const canIncludeSelectedSubtree = useMemo(
    () => Boolean(selectedNodeId && getDescendants(selectedNodeId).length > 0),
    [selectedNodeId, getDescendants],
  );

  const selectedReviewTasks = useMemo(() => {
    if (!selectedNodeId) return [];
    return reviewTasks
      .filter(task => !task.isArchived && task.graphNodeId && selectedScopeIds.has(task.graphNodeId))
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return Number(a.isCompleted) - Number(b.isCompleted);
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      });
  }, [reviewTasks, selectedNodeId, selectedScopeIds]);

  const selectedRetrospectiveEntries = useMemo(() => {
    if (!selectedNodeId) return [];
    return Object.values(retrospectives)
      .filter((retrospective) => retrospective.status === 'completed')
      .flatMap((retrospective) => retrospective.entries)
      .filter((entry) => (entry.nodeIds ?? []).some((nodeId) => selectedScopeIds.has(nodeId)))
      .map((entry) => ({
        ...entry,
        completionStatusChanged: !isRetrospectiveEntryCurrentlyCompleted(
          entry,
          tasks,
          groups,
          reviewTasks,
          schedules,
        ),
      }));
  }, [groups, retrospectives, reviewTasks, schedules, selectedNodeId, selectedScopeIds, tasks]);

  const selectedNodeReviewPreview = useMemo(
    () => selectedReviewTasks.slice(0, 5),
    [selectedReviewTasks],
  );

  const relatedTaskBlocks = useMemo(() => {
    if (!selectedNodeId) return [];
    const results: Array<{ task: Task; block: SmartTaskBlock }> = [];
    allProjectTasks.forEach(task => {
      const blocks = Array.isArray(task.blocks) ? task.blocks : [];
      blocks.forEach(block => {
        if (block.type === 'smart-task' && !block.header.isArchived) {
          const ids = getValidGraphNodeIds(block.header);
          if (ids.some(id => selectedScopeIds.has(id))) results.push({ task, block });
        }
      });
    });
    
    results.sort((a, b) => {
      const dateA = a.block.header.date || '';
      const dateB = b.block.header.date || '';
      return dateB.localeCompare(dateA);
    });
    
    return results;
  }, [selectedNodeId, selectedScopeIds, allProjectTasks]);

  const selectedLearningSummary = useMemo<NodeLearningSummaryData>(() => {
    const taskTotal = relatedTaskBlocks.length;
    const taskCompleted = relatedTaskBlocks.filter(({ block }) => block.header.isCompleted).length;
    const taskProgress = relatedTaskBlocks.reduce((sum, { block }) => {
      if (block.header.isCompleted) return sum + 1;
      if (!isQuantityTask(block.header)) return sum;
      return sum + getQuantityProgressPercent(block.header) / 100;
    }, 0);
    const taskProgressPercent = taskTotal > 0
      ? Math.min(100, Math.round((taskProgress / taskTotal) * 100))
      : 0;
    const reviewTotal = selectedReviewTasks.length;
    const reviewCompleted = selectedReviewTasks.filter(task => task.isCompleted).length;
    const pendingReviews = selectedReviewTasks.filter(task => !task.isCompleted);
    const reviewOverdue = pendingReviews.filter(task => diffDays(todayStr(), task.dueDate) > 0).length;
    const dueNow = pendingReviews.filter(task => diffDays(todayStr(), task.dueDate) >= 0).length;
    const nextReviewDate = pendingReviews[0]?.dueDate;
    const completedTaskBlocks = relatedTaskBlocks.filter(({ block }) => block.header.isCompleted);
    const completedAutoReviewCount = completedTaskBlocks.filter(
      ({ block }) => shouldAutoSyncEbb(block.header),
    ).length;
    const completedNoReviewCount = completedTaskBlocks.length - completedAutoReviewCount;
    let masteryState: NodeMasteryState;
    let masteryLabel: string;
    let masteryReason: string;

    if (pendingReviews.length > 0) {
      if (dueNow > 0) {
        masteryState = 'needs-review';
        masteryLabel = '待巩固';
        masteryReason = reviewOverdue > 0
          ? `有 ${reviewOverdue} 个复习轮次已经逾期，需要优先处理。`
          : '存在今天到期的复习轮次，完成后会继续推进掌握状态。';
      } else {
        masteryState = 'learning';
        masteryLabel = '复习中';
        masteryReason = `复习计划正在进行，下次复习时间为 ${nextReviewDate ?? '待安排'}。`;
      }
    } else if (taskProgressPercent === 0) {
      if (selectedActivationState?.isActivated && taskTotal === 0 && reviewTotal === 0) {
        masteryState = 'completed-no-review';
        masteryLabel = '已激活 · 无需复习';
        masteryReason = '节点已手动激活，当前没有关联任务或复习计划。';
      } else {
        masteryState = 'not-started';
        masteryLabel = '未开始';
        masteryReason = taskTotal > 0 ? '尚未完成任何关联项目任务。' : '当前统计范围还没有关联项目任务。';
      }
    } else if (taskTotal > 0 && taskProgressPercent === 100 && reviewTotal > 0 && reviewCompleted === reviewTotal) {
      if (completedNoReviewCount > 0) {
        masteryState = 'completed-no-review';
        masteryLabel = '已完成（含无需复习）';
        masteryReason = '关联任务均已完成；已有复习轮次全部完成，部分任务未开启自动复习。';
      } else {
        masteryState = 'mastered';
        masteryLabel = '已掌握';
        masteryReason = '关联任务和当前计划中的复习轮次均已完成。';
      }
    } else if (
      taskTotal > 0
      && taskProgressPercent === 100
      && reviewTotal === 0
      && completedAutoReviewCount === 0
    ) {
      masteryState = 'completed-no-review';
      masteryLabel = '已完成 · 无需复习';
      masteryReason = '关联任务已经完成，且未开启自动生成复习任务；节点已激活。';
    } else {
      masteryState = 'learning';
      masteryLabel = '学习中';
      masteryReason = reviewTotal === 0 && completedAutoReviewCount > 0
        ? '关联任务已开启自动复习，复习计划正在准备中。'
        : '已有学习进展，仍有任务需要完成。';
    }

    return {
      masteryState,
      masteryLabel,
      masteryReason,
      nodeCount: selectedScopeIds.size,
      taskTotal,
      taskCompleted,
      taskProgressPercent,
      reviewTotal,
      reviewCompleted,
      reviewPending: pendingReviews.length,
      reviewOverdue,
      nextReviewDate,
    };
  }, [relatedTaskBlocks, selectedReviewTasks, selectedScopeIds, selectedActivationState]);

  useEffect(() => {
    if (!selectedNode) {
      lastSelectedNodeIdRef.current = null;
      return;
    }
    const selectionChanged = lastSelectedNodeIdRef.current !== selectedNode.id;
    lastSelectedNodeIdRef.current = selectedNode.id;
    if (selectionChanged || !isEditingNameRef.current) setEditName(selectedNode.name);
    if (selectionChanged) {
      setIsPanelOpen(true);
      setDetailScope(getDescendants(selectedNode.id).length > 0 ? 'subtree' : 'direct');
    }
  }, [selectedNode, getDescendants]);

  const handleImport = useCallback((text: string, baseParentId: string | null = null) => {
    if (!text.trim()) return;
    const lines = text.split('\n').map(n => n.trim()).filter(Boolean);
    
    const stack: { level: number, id: string }[] = [];
    if (baseParentId) stack.push({ level: 0, id: baseParentId });

    lines.forEach(line => {
      const match = line.match(/^(#+)\s+(.*)/);
      let level = 1;
      let name = line;

      if (match) {
        level = match[1].length;
        name = match[2].trim();
      }

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      const newNode = addNode(name, parentId);
      stack.push({ level, id: newNode.id });
    });
  }, [addNode]);

  if (!isHydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-slate-400 text-sm">正在加载图谱数据...</div>
      </div>
    );
  }

  return (
    <div className="knowledge-graph-view w-full h-full bg-white relative overflow-hidden" ref={containerRef}>
      {/* Background grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #e5e7eb 1px, transparent 0)',
        backgroundSize: '24px 24px',
        opacity: 0.6
      }} />

      {bindingSession.active && (
        <div
          className="absolute left-1/2 top-4 z-30 rounded-2xl border border-indigo-100 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-md"
          style={{ width: 'min(680px, calc(100% - 32px))', transform: 'translateX(-50%)' }}
          data-testid="graph-binding-banner"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-800">为“{bindingSession.taskTitle || '当前任务'}”选择知识节点</div>
              <div className="mt-0.5 text-xs text-slate-500">点击父节点继续浏览，点击最外层叶子节点勾选；已选择 {bindingSession.selectedNodeIds.length} 个</div>
              {bindingError && <div className="mt-1 text-xs font-medium text-rose-600">{bindingError}</div>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button onClick={bindingSession.cancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">取消</button>
              <button
                onClick={async () => {
                  setBindingError('');
                  const result = await bindingSession.confirm();
                  if (result === 'missing') {
                    setBindingError('原任务已不存在或任务块已被删除，无法保存；你可以取消返回。');
                  }
                }}
                disabled={bindingSession.isConfirming}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                aria-label="完成知识节点选择"
              >
                <Check size={14} /> {bindingSession.isConfirming ? '等待选择…' : '完成选择'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Hints */}
      <AnimatePresence>
        {!bindingSession.active && isMoveMode ? (
          <motion.div 
            key="move-hint"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={MOTION_TRANSITION_STANDARD}
            className="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-500/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full shadow-lg text-[13px] font-medium z-20 flex items-center gap-2 border border-blue-400"
          >
            <MoveRight size={14} className="text-white" />
            {moveError || '请点击选择要转移到的目标父节点，或点击空白处使其成为根节点。'}
            <button onClick={() => { setIsMoveMode(false); setMoveError(''); }} className="ml-2 px-2 py-0.5 bg-white/20 rounded text-xs hover:bg-white/30 transition-colors">取消</button>
          </motion.div>
        ) : !bindingSession.active && showHint ? (
          <motion.div 
            key="normal-hint"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={MOTION_TRANSITION_STANDARD}
            className="absolute top-20 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md text-slate-600 px-5 py-2.5 rounded-full shadow-lg text-[13px] font-medium z-20 flex items-center gap-2 border border-slate-200/60"
          >
            <Info size={14} className="text-blue-500" />
            双击节点可向下钻取，双击中心圆盘可返回全局
            <button onClick={() => { setShowHint(false); localStorage.setItem('knowledge-graph-hint-dismissed', 'true'); }} className="ml-1 p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <X size={12} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* 页面级操作固定在知识大盘顶部，底部 Dock 只负责应用切换。 */}
      {!bindingSession.active && <WorkspaceHeader className="kg-workspace-bar" aria-label="知识大盘工作区">
        <div className="kg-workspace-heading ui-workspace-header__identity">
          <span className="kg-workspace-heading-icon ui-workspace-header__identity-icon"><Network size={18} /></span>
          <div className="ui-workspace-header__identity-copy">
            <h1>知识大盘</h1>
            <p>{nodes.length} 个知识节点</p>
          </div>
        </div>
        <motion.div
          ref={dockControlsRef}
          layout
          key="knowledge-graph-actions"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 6 }}
          transition={MOTION_SPRING_GENTLE}
          className="kg-workspace-actions ui-workspace-header__actions"
          data-testid="knowledge-graph-page-actions"
        >
          <div className="tl-dock-popover-wrap">
            <button
              type="button"
              className={`tl-dock-btn ${activeDockPanel === 'view' || selectedRootFilter !== 'all' || radiusMode !== 'overview' ? 'tl-dock-btn--view-active' : ''}`}
              onClick={() => setActiveDockPanel((panel) => panel === 'view' ? null : 'view')}
              title="视图设置"
              aria-label="知识大盘视图"
              aria-haspopup="dialog"
              aria-expanded={activeDockPanel === 'view'}
            >
              <Settings2 size={17} />
            </button>
            {activeDockPanel === 'view' && createPortal(
              <div
                ref={dockPanelRef}
                className="tl-dock-popover kg-control-popover p-3"
                style={{ position: 'fixed', right: 16, top: 72, zIndex: 12000, width: 'min(300px, calc(100vw - 24px))' }}
                role="dialog"
                aria-label="知识大盘视图设置"
              >
                <div className="flex items-center justify-between gap-3 pb-3">
                  <div>
                    <div className="text-xs font-bold text-slate-800">视图设置</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">选择知识范围与标题显示空间</div>
                  </div>
                  <button type="button" className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setActiveDockPanel(null)} aria-label="关闭视图设置">
                    <X size={14} />
                  </button>
                </div>

                <label className="block text-[10px] font-semibold text-slate-500">
                  查看范围
                  <span className="relative mt-1.5 flex items-center">
                    <Command size={14} className="pointer-events-none absolute left-3 text-slate-400" />
                    <select
                      aria-label="知识大盘视角"
                      className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-semibold text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white"
                      value={selectedRootFilter}
                      onChange={(event) => focusRoot(event.target.value)}
                    >
                      <option value="all">全部知识盘</option>
                      {hasFocusedRoot && !rootNodes.some((node) => node.id === selectedRootFilter) && (
                        <option value={selectedRootFilter}>{nodeById.get(selectedRootFilter)?.name ?? '当前分支'}</option>
                      )}
                      {rootNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 text-slate-400" />
                  </span>
                </label>

                <div className="mt-3 text-[10px] font-semibold text-slate-500">大盘尺寸</div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="知识大盘大小">
                  {(['overview', 'reading', 'expanded'] as GraphRadiusMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`h-8 rounded-md text-[11px] font-semibold transition ${radiusMode === mode ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'}`}
                      onClick={() => changeRadiusMode(mode)}
                      aria-pressed={radiusMode === mode}
                    >
                      {{ overview: '总览', reading: '阅读', expanded: '展开' }[mode]}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[10px] leading-4 text-slate-400">
                  {canExpandRadius ? '阅读和展开会扩大真实半径，让节点标题显示更多文字。' : '选择阅读或展开时，将自动进入当前或第一个知识盘。'}
                </div>
              </div>,
              document.body
            )}
          </div>

          <div className="tl-dock-popover-wrap">
            <button
              type="button"
              className={`tl-dock-btn ${activeDockPanel === 'filter' || statusFilter !== 'all' ? 'tl-dock-btn--view-active' : ''}`}
              onClick={() => setActiveDockPanel((panel) => panel === 'filter' ? null : 'filter')}
              title="知识状态筛选"
              aria-label="知识状态筛选"
              aria-haspopup="dialog"
              aria-expanded={activeDockPanel === 'filter'}
            >
              <ListFilter size={17} />
              {statusFilter !== 'all' && <span className="tl-dock-status-badge">1</span>}
            </button>
            {activeDockPanel === 'filter' && createPortal(
              <div
                ref={dockPanelRef}
                className="tl-dock-popover kg-control-popover p-2"
                style={{ position: 'fixed', right: 16, top: 72, zIndex: 12000, width: 'min(250px, calc(100vw - 24px))' }}
                role="dialog"
                aria-label="知识状态筛选菜单"
              >
                <div className="px-2 pb-2 pt-1 text-xs font-bold text-slate-800">知识状态</div>
                <button
                  type="button"
                  className={`kg-filter-option flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition ${statusFilter === 'all' ? 'bg-indigo-50 font-semibold text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                  aria-pressed={statusFilter === 'all'}
                  onClick={() => { setStatusFilter('all'); setActiveDockPanel(null); }}
                >
                  <span className="flex-1">全部状态</span>
                  <span className="text-[10px] text-slate-400">{islandsData.allFlatNodes.length}</span>
                  <span className="flex h-4 w-4 items-center justify-center">{statusFilter === 'all' && <Check size={13} />}</span>
                </button>
                {GRAPH_STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`kg-filter-option flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition ${statusFilter === option.value ? 'bg-indigo-50 font-semibold text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                    aria-pressed={statusFilter === option.value}
                    onClick={() => { setStatusFilter(option.value); setActiveDockPanel(null); }}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${option.dotClass}`} />
                    <span className="flex-1">{option.label}</span>
                    <span className="text-[10px] text-slate-400">{statusCounts[option.value]}</span>
                    <span className="flex h-4 w-4 items-center justify-center">{statusFilter === option.value && <Check size={13} />}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>

          <div className="tl-dock-popover-wrap">
            <button
              type="button"
              className={`tl-dock-btn ${activeDockPanel === 'search' || searchQuery ? 'tl-dock-btn--view-active' : ''}`}
              onClick={() => setActiveDockPanel((panel) => panel === 'search' ? null : 'search')}
              title="搜索知识"
              aria-label="搜索知识"
              aria-haspopup="dialog"
              aria-expanded={activeDockPanel === 'search'}
            >
              <Search size={17} />
              {searchQuery && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-500 ring-2 ring-white" />}
            </button>
            {activeDockPanel === 'search' && createPortal(
              <div
                ref={dockPanelRef}
                className="tl-dock-popover kg-control-popover p-3"
                style={{ position: 'fixed', right: 16, top: 72, zIndex: 12000, width: 'min(280px, calc(100vw - 24px))' }}
                role="search"
                aria-label="搜索知识节点"
              >
                <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-indigo-300 focus-within:bg-white">
                  <Search size={15} className="shrink-0 text-slate-400" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    placeholder="输入节点标题"
                    className="min-w-0 flex-1 border-none bg-transparent text-xs font-medium text-slate-700 outline-none"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery('')} className="p-1 text-slate-400 hover:text-slate-700" aria-label="清除知识搜索">
                      <X size={14} />
                    </button>
                  )}
                </label>
                <div className="mt-2 text-[10px] text-slate-400">匹配的节点及其路径会保持高亮。</div>
              </div>,
              document.body
            )}
          </div>

          <button
            ref={setRecenterButtonRef}
            type="button"
            onClick={() => zoomToFit()}
            className="tl-dock-btn overflow-hidden text-slate-500 hover:text-blue-600"
            title="视角归中"
            aria-label="视角归中"
          >
            <Focus size={17} className="shrink-0" />
          </button>
          <SyncStatusIndicator />
          <button
            type="button"
            onClick={() => setIsArchiveLibraryOpen(true)}
            className="tl-dock-btn text-slate-500 hover:text-indigo-600"
            title="归档库"
            aria-label="打开归档库"
          >
            <Archive size={17} />
          </button>
        </motion.div>
      </WorkspaceHeader>}

      {capsuleNodeId && <TimeCapsuleModal nodeId={capsuleNodeId} onClose={() => setCapsuleNodeId(null)} />}
      <ArchiveLibraryModal isOpen={isArchiveLibraryOpen} onClose={() => setIsArchiveLibraryOpen(false)} />

      {/* SVG Sunburst Canvas */}
      <svg
        ref={svgRef}
        className="kg-canvas-stage ui-workspace-content-stage w-full h-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        data-radius-mode={radiusMode}
        data-island-radius={islandsData.islands[0]?.radius ?? 0}
      >
        <rect width="100%" height="100%" fill="transparent" style={{ pointerEvents: 'all' }} onClick={() => {
          if (bindingSession.active) return;
          if (isMoveMode && selectedNodeId) {
            // Move to root
            updateNode(selectedNodeId, { parentId: null });
            setIsMoveMode(false);
          } else {
            setSelectedNodeId(null);
            setIsMoveMode(false);
          }
        }} />
        <g ref={gRef}>
          <g transform={`translate(${dimensions.width / 2}, ${dimensions.height / 2})`}>
            {islandsData.islands.map(island => {
              const islandRotation = islandRotations[island.rootId] || 0;
              return (
              <g key={island.rootId} transform={`translate(${island.centerX}, ${island.centerY})`}>
                {/* 岛屿名称标签（在上帝视角下显示在底部） */}
                <text
                  y={island.radius + 30}
                  textAnchor="middle"
                  fontSize={16}
                  fontWeight={700}
                  fill="#64748b"
                  className="pointer-events-none select-none opacity-50"
                >
                  {island.root?.data.name}
                </text>
                
                <g 
                  style={{ 
                    transform: `rotate(${islandRotation}deg)`, 
                    transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' 
                  }}
                >
                {island.nodes.map((node) => {
                  const nodeId = node.data.id;
                  const isSelected = selectedNodeId === nodeId;
                  const isBindingSelected = bindingSession.active && bindingSession.selectedNodeIds.includes(nodeId);

                  const isXRayActive = matchingNodeIds !== null;
                  const isXRayMatched = isXRayActive && matchingNodeIds.has(nodeId);
                  const isDimmed = isXRayActive && !isXRayMatched;

                  const fillColor = node.data.color;
                  const hasOverdueRounds = node.data.overdueCount > 0;
                  const strokeColor = isBindingSelected ? '#4f46e5' : (isSelected ? '#0f172a' : (hasOverdueRounds ? '#ef4444' : '#ffffff'));
                  const strokeWidth = isBindingSelected ? 4 : (isSelected ? 2.5 : (hasOverdueRounds ? 3 : 1.5));

              const angleDiff = node.x1 - node.x0;
               const radiusDiff = node.y1 - node.y0;
               
               // 将 x 的计算移到前面，因为我们需要它来计算文字的真实物理高度限制
               const x = (node.x0 + node.x1) / 2 * 180 / Math.PI;
               const y = (node.y0 + node.y1) / 2;
               const absoluteAngle = ((x - 90 + islandRotation) % 360 + 360) % 360;
               const flipText = absoluteAngle > 90 && absoluteAngle < 270;

               // 动态可见性过滤：对于切向排布的文字，其实际需要占用的横向空间受弧长限制
               const innerArcLength = angleDiff * node.y0;
               
               // 精确计算可用物理宽度和最大字符数 (每个中文字符约 12px)
               const availableWidth = radiusDiff - 10;
               const maxChars = Math.max(0, Math.floor(availableWidth / 12));
               
               let displayName = '';
               if (node.depth === 0) {
                 // 根节点（中心圆）是水平排布的，它的可用空间是整个圆的直径（2 * radiusDiff）减去两边 padding
                 const rootAvailableWidth = (radiusDiff * 2) - 20;
                 const rootMaxChars = Math.max(1, Math.floor(rootAvailableWidth / 14)); // 根节点字体是 14px
                 if (node.data.name.length <= rootMaxChars) {
                   displayName = node.data.name;
                 } else {
                   displayName = rootMaxChars === 1 
                     ? node.data.name.substring(0, 1) 
                     : node.data.name.substring(0, rootMaxChars - 1) + '…';
                 }
               } else if (maxChars > 0) {
                 if (node.data.name.length <= maxChars) {
                   displayName = node.data.name;
                 } else {
                   // 空间不够，截断并加单字符省略号 '…' 而不是 '...'
                   displayName = maxChars === 1 
                     ? node.data.name.substring(0, 1) 
                     : node.data.name.substring(0, maxChars - 1) + '…';
                 }
               }
               
               // 根节点必须显示，其他子节点：必须有可显示的文字，且内侧弧长足够容纳字体高度
               const showText = node.depth === 0 || (displayName.length > 0 && innerArcLength > 12 && radiusDiff > 15);
                  
                  const transform = node.depth === 0 
                 ? `rotate(${-islandRotation})` // Counter-rotate root text
                 : `rotate(${x - 90}) translate(${y},0) rotate(${flipText ? 180 : 0})`;

                const textFill = getAccessibleTextColor(fillColor);

                  return (
                    <g 
                       key={nodeId}
                       data-node-id={nodeId}
                      role="button"
                      tabIndex={0}
                      aria-label={`知识节点：${node.data.name}`}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (bindingSession.active) {
                          if (node.data.isLeaf) bindingSession.toggleNode(nodeId);
                          else focusRoot(nodeId);
                          return;
                        }
                        if (isMoveMode && selectedNodeId && selectedNodeId !== nodeId) {
                          // Prevent moving a node to its own descendant
                          const descendants = getDescendants(selectedNodeId);
                          if (!descendants.includes(nodeId)) {
                            updateNode(selectedNodeId, { parentId: nodeId });
                            setIsMoveMode(false);
                            setMoveError('');
                          } else {
                            setMoveError('不能将节点移动到它的子节点下。');
                          }
                        } else {
                          setSelectedNodeId(nodeId);
                          setIsMoveMode(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        e.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (bindingSession.active) {
                          if (!node.data.isLeaf) focusRoot(nodeId);
                          return;
                        }
                        if (node.depth > 0 && !node.data.isLeaf) {
                          focusRoot(nodeId);
                        } else if (node.depth === 0 && selectedRootFilter !== 'all') {
                          focusRoot('all');
                        } else if (node.depth === 0 && selectedRootFilter === 'all') {
                          focusRoot(nodeId);
                        }
                      }}
                      className={`cursor-pointer transition-opacity duration-300 ${isDimmed ? 'opacity-20' : 'opacity-100'}`}
                    >
                      <title>{bindingSession.active ? `${node.data.name}${node.data.isLeaf ? (isBindingSelected ? '（已选择）' : '（点击选择）') : '（点击浏览）'}` : `${node.data.name} · ${getNodeStateLabel(node.data.visualState)} · 轮次 ${node.data.completedCount}/${node.data.totalReviewCount}${hasOverdueRounds ? ` · ${node.data.overdueCount} 个逾期` : ''}`}</title>
                      <path
                        d={arcGenerator(node) || ''}
                        fill={fillColor}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        className="transition-all duration-300 hover:opacity-90"
                      />
                      {showText && (
                        <text
                          transform={transform}
                          textAnchor="middle"
                          dy="0.35em"
                          fontSize={node.depth === 0 ? 14 : 11}
                          fontWeight={node.depth === 0 || isSelected ? 700 : 500}
                          fill={textFill}
                          pointerEvents="none"
                          className="select-none"
                          style={{ transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        >
                          {displayName}
                        </text>
                      )}
                    </g>
                  );
                })}
                </g>
              </g>
            )})}
          </g>
        </g>
      </svg>

      {/* Floating Control Panel */}
      {!bindingSession.active && (isPanelOpen ? (
        <div className={styles.panel} style={{ background: 'rgba(255,255,255,0.9)', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
          {selectedNode ? (
            <div className={styles.panelContainer}>
              <div className={styles.header}>
                <div className="flex-1 pr-3 relative group w-0">
                  <input
                    type="text"
                    className="w-full bg-transparent text-lg font-bold text-slate-800 placeholder-slate-400 focus:outline-none rounded px-1 -ml-1 border border-transparent focus:border-slate-200/60 transition-all truncate"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onFocus={() => { isEditingNameRef.current = true; }}
                    onBlur={() => {
                      isEditingNameRef.current = false;
                      const name = editName.trim();
                      if (!name) {
                        setEditName(selectedNode.name);
                        return;
                      }
                      if (name !== selectedNode.name) updateNode(selectedNode.id, { name });
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    title={editName}
                  />
                </div>
                <div className="flex items-center shrink-0">
                  <div className={styles.actionGroup}>
                    <button onClick={() => { setIsMoveMode((value) => !value); setMoveError(''); }} className={`${styles.actionBtn} ${isMoveMode ? styles.active : ''}`} title="转移节点层级">
                      <MoveRight size={13} />
                    </button>
                    <div className={styles.actionDivider}></div>
                    <button
                      onClick={() => {
                        if (!selectedActivationState?.isLeaf) return;
                        updateNode(selectedNode.id, {
                          status: selectedActivationState.isActivated ? 'unactivated' : 'activated',
                        });
                      }}
                      disabled={!selectedActivationState?.isLeaf}
                      title={selectedActivationState?.isLeaf ? '切换节点激活状态' : '父节点状态由所有子节点自动计算'}
                      className={`${styles.actionBtn} ${selectedActivationState?.isActivated ? styles.active : ''}`}
                      style={!selectedActivationState?.isLeaf ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    >
                      <Zap size={13} className={selectedActivationState?.isActivated ? 'fill-blue-500' : ''} />
                    </button>
                    <div className={styles.actionDivider}></div>
                    <button
                      aria-label="归档节点"
                      onClick={async () => { if(await requestConfirmation('确定归档吗？')) { archiveNodeCascade(selectedNode.id, true); setSelectedNodeId(null); } }}
                      className={styles.actionBtn}
                    >
                      <Archive size={13} />
                    </button>
                    <div className={styles.actionDivider}></div>
                    <button onClick={async () => { if(await requestConfirmation({ title: '删除知识节点？', message: `节点「${selectedNode.name}」将被永久删除。`, confirmLabel: '删除节点', tone: 'danger' })) { deleteNode(selectedNode.id); setSelectedNodeId(null); } }} className={`${styles.actionBtn} ${styles.danger}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <button onClick={() => setIsPanelOpen(false)} className={styles.closeBtn}><X size={13} /></button>
                </div>
              </div>

              <div className={`${styles.panelBody} px-5 pb-5 flex flex-col gap-5`}>
                <NodeLearningSummary
                  data={selectedLearningSummary}
                  scope={detailScope}
                  canIncludeSubtree={canIncludeSelectedSubtree}
                  onScopeChange={setDetailScope}
                />
                <NodeRetrospectiveRecords entries={selectedRetrospectiveEntries} />
                {selectedActivationState && (
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium text-slate-600">
                      {selectedActivationState.isLeaf ? '图谱激活状态' : '子节点激活进度'}
                    </span>
                    <span className={
                      !selectedActivationState.isActivated
                        ? 'font-semibold text-slate-500'
                        : selectedVisualState === 'mastered'
                          ? 'font-semibold text-amber-600'
                          : selectedVisualState === 'reviewing'
                            ? 'font-semibold text-emerald-600'
                            : 'font-semibold text-blue-600'
                    }>
                      {selectedActivationState.isLeaf
                        ? NODE_STATE_LABEL[selectedVisualState]
                        : `${selectedActivationState.activatedLeafCount}/${selectedActivationState.totalLeafCount}`}
                    </span>
                  </div>
                )}
                
                {selectedNodeReviewPreview.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-400/80 uppercase flex items-center gap-1.5"><Zap size={11} className="text-amber-400" />复习记录 <span className="font-medium text-slate-400">{selectedReviewTasks.length}</span></div>
                    <div className="space-y-0.5">
                      {selectedNodeReviewPreview.map(task => (
                        <div key={task.id} onClick={() => window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'ebb' } }))} className="group flex justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer">
                          <div className="flex items-center gap-2 flex-1 overflow-hidden">
                            <div className={`w-1.5 h-1.5 rounded-full ${task.isCompleted ? 'bg-emerald-400' : 'bg-amber-400'}`}></div>
                            <span className="truncate text-xs font-medium text-slate-700">{task.topicName}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">{task.isCompleted ? '✓' : task.dueDate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {relatedTaskBlocks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-400/80 uppercase flex items-center gap-1.5"><Network size={11} className="text-blue-400" />关联项目任务 <span className="font-medium text-slate-400">{relatedTaskBlocks.length}</span></div>
                    <div className="space-y-1">
                      {relatedTaskBlocks.map(({ task, block }) => {
                        const quantity = isQuantityTask(block.header);
                        const quantityProgress = quantity ? getQuantityProgressPercent(block.header) : 0;
                        return (
                        <div key={`${task.id}-${block.id}`} onClick={() => window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'timeline', taskId: task.id, blockId: block.id } }))} className="group flex flex-col gap-1 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <div className="flex justify-between gap-3">
                            <div className="text-xs font-semibold text-slate-800 truncate">{block.header.title}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${block.header.isCompleted ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`}>
                              {block.header.isCompleted ? '已完成' : quantity ? `${quantityProgress}%` : '进行中'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{block.header.date}</span>·<span className="truncate">{task.name}</span>
                          </div>
                          {quantity && (
                            <div className="text-[10px] text-slate-500">
                              {getQuantityCompleted(block.header)}/{getQuantityTotal(block.header)} {getQuantityUnit(block.header)}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100/80">
                  <div className={styles.composer}>
                    <input type="text" placeholder="+ 添加子节点 (Enter 确认)..." className={styles.textarea} value={newChildName} onChange={e => setNewChildName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newChildName.trim()) { handleImport(newChildName, selectedNode.id); setNewChildName(''); } }} style={{ paddingBottom: '12px' }} />
                  </div>
                </div>

              </div>
            </div>
          ) : (
            <div className={styles.panelContainer}>
              <div className={styles.header}>
                <div className={styles.headerTitleWrapper}><Command size={14} /><h3 className={styles.headerTitle}>图谱控制台</h3></div>
                <button onClick={() => setIsPanelOpen(false)} className={styles.closeBtn}><X size={14} /></button>
              </div>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>快速构建</div>
                <div className={styles.composer}>
                  <textarea placeholder="新建根节点 (支持 Markdown)" className={styles.textarea} value={newRootName} onChange={e => setNewRootName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && newRootName.trim()) { e.preventDefault(); handleImport(newRootName); setNewRootName(''); } }} />
                  <button onClick={() => { if (newRootName.trim()) { handleImport(newRootName); setNewRootName(''); } }} disabled={!newRootName.trim()} className={styles.submitBtn}><Plus size={14} strokeWidth={2.5} /></button>
                </div>
              </div>
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}><Network size={20} /></div>
                <h4 className={styles.emptyStateTitle}>探索知识网络</h4>
                <p className={styles.emptyStateDesc}>点击节点查看详情，双击可向下钻取，右侧控制台录入</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setIsPanelOpen(true)} className={styles.triggerBtn} title="打开节点控制台">
          <Settings2 size={20} />
        </button>
      ))}
    </div>
  );
};
