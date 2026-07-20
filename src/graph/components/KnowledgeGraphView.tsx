/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Settings2, X, Info, Search, ChevronDown, Command, Zap, Archive, Network, Focus, MoveRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { TimeCapsuleModal } from '@/components/GlobalSearch';
import { getValidGraphNodeIds } from '@/utils/blocks';
import { computeNodeActivationStates } from '../activation';
import styles from './GraphConsole.module.css';
import { useGraphBindingStore } from '../bindingStore';
import NodeLearningSummary, { type NodeDetailScope, type NodeLearningSummaryData, type NodeMasteryState } from './NodeLearningSummary';
import type { SmartTaskBlock, Task } from '@/types';

import { stratify, partition, HierarchyRectangularNode } from 'd3-hierarchy';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import { arc } from 'd3-shape';
import 'd3-transition';

type NodeRollupStats = {
  totalReviewCount: number;
  pendingCount: number;
  completedCount: number;
  overdueCount: number;
  noteCount: number;
};

type ViewNode = {
  id: string;
  name: string;
  color: string;
  status: string;
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
  noteCount: number;
  importanceScore: number;
  labelPriority: 'high' | 'medium' | 'low';
  isVirtual?: boolean;
};

const getContrastYIQ = (hexcolor: string) => {
  hexcolor = hexcolor.replace("#", "");
  if (hexcolor.length === 3) hexcolor = hexcolor.split('').map(c => c + c).join('');
  if (hexcolor.length !== 6) return '#ffffff';
  const r = parseInt(hexcolor.substr(0, 2), 16);
  const g = parseInt(hexcolor.substr(2, 2), 16);
  const b = parseInt(hexcolor.substr(4, 2), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 150) ? '#0f172a' : '#ffffff';
};

export const KnowledgeGraphView: React.FC = () => {
  const { isHydrated, hydrateStore, nodes: allNodes, addNode, deleteNode, updateNode, archiveNodeCascade } = useGraphStore();
  const nodes = useMemo(() => allNodes.filter(n => !n.isArchived), [allNodes]);
  const { reviewTasks } = useEbbStore();
  const { tasks, groups } = useTimelineStore();
  const bindingSession = useGraphBindingStore();
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Portal into Dock
  const dockPortalTarget = document.getElementById('tl-dock-portal-target');

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Hover states
  const [capsuleNodeId, setCapsuleNodeId] = useState<string | null>(null);

  const [showHint, setShowHint] = useState(() => {
    return localStorage.getItem('knowledge-graph-hint-dismissed') !== 'true';
  });

  // Rotation angles for islands
  const [islandRotations, setIslandRotations] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isHydrated) hydrateStore();
  }, [isHydrated, hydrateStore]);

  useEffect(() => {
    if (!bindingSession.active) return;
    setSelectedNodeId(null);
    setIsPanelOpen(false);
    setIsMoveMode(false);
    setBindingError('');
  }, [bindingSession.active]);

  useEffect(() => {
    if (!bindingSession.active || !isHydrated) return;
    const validLeafIds = new Set(nodes.filter((node) => !nodes.some((candidate) => candidate.parentId === node.id)).map((node) => node.id));
    const validSelection = bindingSession.selectedNodeIds.filter((id) => validLeafIds.has(id));
    if (validSelection.length !== bindingSession.selectedNodeIds.length) {
      bindingSession.setSelectedNodeIds(validSelection);
    }
  }, [bindingSession, isHydrated, nodes]);

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
    
    const updateSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      } else {
        // Fallback to approximate window size if container is hidden/0
        setDimensions(prev => prev.width === 0 ? { width: window.innerWidth - 64, height: window.innerHeight - 100 } : prev);
      }
    };
    
    updateSize();

    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    observer.observe(containerRef.current);
    
    const timer = setTimeout(updateSize, 500); // Check again after animations
    
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [isHydrated]);

  const getDescendants = useCallback((id: string, visited = new Set<string>()): string[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    const children = nodes.filter(n => n.parentId === id).map(n => n.id);
    let allDescendants = [...children];
    children.forEach(childId => {
      allDescendants = allDescendants.concat(getDescendants(childId, visited));
    });
    return allDescendants;
  }, [nodes]);

  const getNodeColorHex = useCallback((nodeId: string): string => {
    const gray = '#64748b';
    const green = '#10b981';
    const gold = '#eab308';
    const getColor = (id: string, path = new Set<string>()): string => {
      if (path.has(id)) return gray;
      // 激活状态决定灰/非灰；EBB 轮次只决定已激活节点是绿色还是金色。
      // 父节点的激活状态由 activationStates 按“所有子节点激活”计算，
      // 因此不会因为刚生成了 0/7 的 EBB 轮次而错误回到灰色。
      if (!(activationStates.get(id)?.isActivated ?? false)) return gray;

      const descendantIds = getDescendants(id);
      const scopedIds = [id, ...descendantIds];
      const activatedLeafIds = scopedIds.filter((scopedId) => {
        const hasChildren = nodes.some((node) => node.parentId === scopedId);
        return !hasChildren && (activationStates.get(scopedId)?.isActivated ?? false);
      });
      const allActivatedLeavesAreGold = activatedLeafIds.length > 0 && activatedLeafIds.every((leafId) => {
        const rounds = reviewTasks.filter(
          (task) => !task.isArchived && task.graphNodeId === leafId,
        );
        return rounds.length > 0 && rounds.every((task) => task.isCompleted);
      });
      if (allActivatedLeavesAreGold) return gold;
      return green;
    };

    return getColor(nodeId);
  }, [activationStates, getDescendants, nodes, reviewTasks]);

  const islandsData = useMemo(() => {
    const today = todayStr();
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const childrenMap = new Map<string | null, string[]>();
    nodes.forEach(node => {
      const siblings = childrenMap.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenMap.set(node.parentId, siblings);
    });

    const mergeStats = (statsList: NodeRollupStats[]): NodeRollupStats => ({
      totalReviewCount: statsList.reduce((sum, stats) => sum + stats.totalReviewCount, 0),
      pendingCount: statsList.reduce((sum, stats) => sum + stats.pendingCount, 0),
      completedCount: statsList.reduce((sum, stats) => sum + stats.completedCount, 0),
      overdueCount: statsList.reduce((sum, stats) => sum + stats.overdueCount, 0),
      noteCount: statsList.reduce((sum, stats) => sum + stats.noteCount, 0),
    });

    const descendantLeafMap = new Map<string, string[]>();
    const getLeafDescendants = (nodeId: string, currentPath = new Set<string>()): string[] => {
      if (currentPath.has(nodeId)) return [];
      if (descendantLeafMap.has(nodeId)) return descendantLeafMap.get(nodeId)!;

      currentPath.add(nodeId);
      const children = childrenMap.get(nodeId) ?? [];
      let leafIds: string[] = [];

      if (children.length === 0) {
        leafIds = [nodeId];
      } else {
        children.forEach(childId => {
          leafIds = leafIds.concat(getLeafDescendants(childId, currentPath));
        });
      }

      currentPath.delete(nodeId);
      descendantLeafMap.set(nodeId, leafIds);
      return leafIds;
    };

    nodes.forEach(n => {
      if (!descendantLeafMap.has(n.id)) descendantLeafMap.set(n.id, getLeafDescendants(n.id));
    });

    const descendantNodeMap = new Map<string, string[]>();
    const getAllDescendants = (nodeId: string, currentPath = new Set<string>()): string[] => {
      if (currentPath.has(nodeId)) return [];
      if (descendantNodeMap.has(nodeId)) return descendantNodeMap.get(nodeId)!;
      currentPath.add(nodeId);
      const descendants = (childrenMap.get(nodeId) ?? []).flatMap((childId) => [
        childId,
        ...getAllDescendants(childId, currentPath),
      ]);
      currentPath.delete(nodeId);
      descendantNodeMap.set(nodeId, descendants);
      return descendants;
    };

    const reviewTasksByNodeId = new Map<string, typeof reviewTasks>();
    reviewTasks.forEach(task => {
      if (!task.graphNodeId || task.isArchived) return;
      const bucket = reviewTasksByNodeId.get(task.graphNodeId) ?? [];
      bucket.push(task);
      reviewTasksByNodeId.set(task.graphNodeId, bucket);
    });

    const nodeStatsMap = new Map<string, NodeRollupStats>();
    nodes.forEach(node => {
      // A task may be bound directly to any level of the knowledge tree.
      // Aggregate the complete subtree rather than only the leaf descendants.
      const statisticNodeIds = [node.id, ...getAllDescendants(node.id)];
      const directStats = mergeStats(
        statisticNodeIds.map(statisticNodeId => {
          const leafTasks = reviewTasksByNodeId.get(statisticNodeId) ?? [];
          return {
            totalReviewCount: leafTasks.length,
            pendingCount: leafTasks.filter(task => !task.isCompleted).length,
            completedCount: leafTasks.filter(task => task.isCompleted).length,
            overdueCount: leafTasks.filter(task => !task.isCompleted && diffDays(today, task.dueDate) > 0).length,
            noteCount: 0,
          };
        }),
      );
      nodeStatsMap.set(node.id, directStats);
    });

    let rootsToProcess: string[] = [];
    if (selectedRootFilter !== 'all' && nodeMap.has(selectedRootFilter)) {
      rootsToProcess = [selectedRootFilter];
    } else {
      rootsToProcess = nodes.filter(n => !n.parentId).map(n => n.id);
    }

    if (dimensions.width === 0 || dimensions.height === 0 || rootsToProcess.length === 0) {
      return { islands: [], allFlatNodes: [] };
    }

    const islands: any[] = [];
    let allFlatNodes: ViewNode[] = [];

    // Calculate grid layout for islands
    const cols = Math.ceil(Math.sqrt(rootsToProcess.length));
    const baseRadius = rootsToProcess.length === 1 
      ? Math.max(100, Math.min(dimensions.width, dimensions.height) / 2 - 60)
      : 400; // 折中方案：从 500 回调到 400，既保证文字展示量，又不会导致环太宽显得笨重
    
    const cellWidth = baseRadius * 2 + 160;
    const cellHeight = baseRadius * 2 + 160;
    
    const totalWidth = cols * cellWidth;
    const rows = Math.ceil(rootsToProcess.length / cols);
    const totalHeight = rows * cellHeight;
    
    const startX = -totalWidth / 2 + cellWidth / 2;
    const startY = -totalHeight / 2 + cellHeight / 2;

    rootsToProcess.forEach((rootId, index) => {
      const validIdsForTree = new Set<string>();
      const addDescendants = (id: string) => {
        validIdsForTree.add(id);
        (childrenMap.get(id) || []).forEach(addDescendants);
      };
      addDescendants(rootId);

      const flatData = nodes
        .filter(d => validIdsForTree.has(d.id))
        .map(n => {
          const leafIds = descendantLeafMap.get(n.id) ?? [n.id];
          const isLeaf = leafIds.length === 1 && leafIds[0] === n.id;
          const stats = nodeStatsMap.get(n.id) ?? {
            totalReviewCount: 0, pendingCount: 0, completedCount: 0, overdueCount: 0, noteCount: 0,
          };

          return {
            id: n.id,
            name: n.name,
            parentId: n.id === rootId ? null : n.parentId,
            color: getNodeColorHex(n.id),
            status: activationStates.get(n.id)?.isActivated ? 'activated' : 'unactivated',
            isActivated: activationStates.get(n.id)?.isActivated ?? false,
            isLeaf,
            activeCount: isLeaf ? 0 : activationStates.get(n.id)?.activatedLeafCount ?? 0,
            totalLeafCount: isLeaf ? 0 : activationStates.get(n.id)?.totalLeafCount ?? leafIds.length,
            ...stats,
            importanceScore: stats.pendingCount + stats.overdueCount * 2,
            labelPriority: stats.overdueCount > 0 ? 'high' : 'low',
            isVirtual: false,
            depth: 0,
            rootId: rootId
          } as ViewNode;
        });

      allFlatNodes = allFlatNodes.concat(flatData);

      try {
        const root = stratify<ViewNode>()
          .id(d => d.id)
          .parentId(d => (d as any).parentId)(flatData);

        root.sum(d => {
          const hasChildren = allNodes.some(n => n.parentId === d.id);
          return hasChildren ? 0 : 1;
        });
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
  }, [nodes, reviewTasks, selectedRootFilter, getNodeColorHex, dimensions.width, dimensions.height, allNodes, activationStates]);

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

  const matchingNodeIds = useMemo(() => {
    if (statusFilter === 'all' && !searchQuery.trim()) return null;
    const query = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();

    islandsData.allFlatNodes.forEach((node: ViewNode) => {
      if (node.isVirtual) return;
      let isMatch = false;
      const matchStatus = statusFilter === 'all' 
        || (statusFilter === 'overdue' && node.isActivated && (node.overdueCount > 0 || node.color === '#ef4444'))
        || (statusFilter === 'active' && node.isActivated && ((node.pendingCount > 0 && node.color !== '#ef4444') || node.color === '#10b981'))
        || (statusFilter === 'completed' && node.isActivated && node.color === '#eab308');

      const matchQuery = !query || node.name.toLowerCase().includes(query);

      if (matchStatus && matchQuery) isMatch = true;

      if (isMatch) {
        matched.add(node.id);
        let currId = node.id;
        while (currId) {
          matched.add(currId);
          const parent = nodes.find(n => n.id === currId);
          currId = parent?.parentId || '';
        }
      }
    });

    return matched;
  }, [islandsData.allFlatNodes, statusFilter, searchQuery, nodes]);

  // Setup D3 Zoom
  useEffect(() => {
    if (!isHydrated || !svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    zoomBehaviorRef.current = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        select(gRef.current).attr('transform', event.transform);
      });
    svg.call(zoomBehaviorRef.current);
  }, [isHydrated]);

  const zoomToFit = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = select(svgRef.current);
    
    if (islandsData.islands.length > 1) {
      const cols = Math.ceil(Math.sqrt(islandsData.islands.length));
      const rows = Math.ceil(islandsData.islands.length / cols);
      // 这里的网格尺寸需要和上面的 baseRadius 保持同步
      const cellWidth = 400 * 2 + 160;
      const cellHeight = 400 * 2 + 160;
      const totalWidth = cols * cellWidth;
      const totalHeight = rows * cellHeight;
      
      const scaleX = dimensions.width / (totalWidth || dimensions.width);
      const scaleY = dimensions.height / (totalHeight || dimensions.height);
      const scale = Math.min(scaleX, scaleY, 1) * 0.9;
      
      svg.transition().duration(750).call(zoomBehaviorRef.current.transform, zoomIdentity.scale(scale));
    } else {
      svg.transition().duration(750).call(zoomBehaviorRef.current.transform, zoomIdentity);
    }
  }, [islandsData.islands.length, dimensions.width, dimensions.height]);

  useEffect(() => {
    const timer = setTimeout(zoomToFit, 100);
    return () => clearTimeout(timer);
  }, [zoomToFit, selectedRootFilter]);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedActivationState = selectedNodeId
    ? activationStates.get(selectedNodeId) ?? null
    : null;
  
  // Auto-focus rotation logic
  useEffect(() => {
    if (!selectedNodeId || !islandsData) return;
    
    // Find the node in the d3 hierarchy to get its angles
    let targetNode: HierarchyRectangularNode<ViewNode> | null = null;
    let islandRootId: string | null = null;
    
    for (const island of islandsData.islands) {
      const found = island.nodes.find((n: any) => n.id === selectedNodeId);
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
      
      // Normalize to 0-360 range
      targetRotation = targetRotation % 360;
      
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
  
  const allProjectTasks = useMemo(() => {
    const taskMap = new Map<string, Task>();
    tasks.forEach(task => taskMap.set(task.id, task));
    groups.forEach(group => group.children.forEach(task => taskMap.set(task.id, task)));
    return [...taskMap.values()];
  }, [tasks, groups]);

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

  const selectedReviewTasks = useMemo(() => reviewTasks
    .filter(task => !task.isArchived && task.graphNodeId && selectedScopeIds.has(task.graphNodeId))
    .sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return Number(a.isCompleted) - Number(b.isCompleted);
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    }), [reviewTasks, selectedScopeIds]);

  const selectedNodeReviewPreview = useMemo(
    () => selectedReviewTasks.slice(0, 5),
    [selectedReviewTasks],
  );

  const relatedTaskBlocks = useMemo(() => {
    if (!selectedNodeId) return [];
    const results: Array<{ task: Task; block: SmartTaskBlock }> = [];
    allProjectTasks.forEach(task => {
      if (!task.blocks) return;
      task.blocks.forEach(block => {
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
    const reviewTotal = selectedReviewTasks.length;
    const reviewCompleted = selectedReviewTasks.filter(task => task.isCompleted).length;
    const pendingReviews = selectedReviewTasks.filter(task => !task.isCompleted);
    const reviewOverdue = pendingReviews.filter(task => diffDays(todayStr(), task.dueDate) > 0).length;
    const dueNow = pendingReviews.filter(task => diffDays(todayStr(), task.dueDate) >= 0).length;
    const nextReviewDate = pendingReviews[0]?.dueDate;
    let masteryState: NodeMasteryState;
    let masteryLabel: string;
    let masteryReason: string;

    if (dueNow > 0) {
      masteryState = 'needs-review';
      masteryLabel = '待巩固';
      masteryReason = reviewOverdue > 0
        ? `有 ${reviewOverdue} 个复习轮次已经逾期，需要优先处理。`
        : '存在今天到期的复习轮次，完成后会继续推进掌握状态。';
    } else if (taskCompleted === 0) {
      masteryState = 'not-started';
      masteryLabel = '未开始';
      masteryReason = taskTotal > 0 ? '尚未完成任何关联项目任务。' : '当前统计范围还没有关联项目任务。';
    } else if (taskTotal > 0 && taskCompleted === taskTotal && reviewTotal > 0 && reviewCompleted === reviewTotal) {
      masteryState = 'mastered';
      masteryLabel = '已掌握';
      masteryReason = '关联任务和当前计划中的复习轮次均已完成。';
    } else {
      masteryState = 'learning';
      masteryLabel = '学习中';
      masteryReason = reviewTotal === 0
        ? '已经完成部分学习任务，但还没有形成复习轮次。'
        : '已有学习进展，仍有任务或后续复习轮次需要完成。';
    }

    return {
      masteryState,
      masteryLabel,
      masteryReason,
      nodeCount: selectedScopeIds.size,
      taskTotal,
      taskCompleted,
      reviewTotal,
      reviewCompleted,
      reviewPending: pendingReviews.length,
      reviewOverdue,
      nextReviewDate,
    };
  }, [relatedTaskBlocks, selectedReviewTasks, selectedScopeIds]);

  useEffect(() => {
    if (selectedNode) {
      setEditName(selectedNode.name);
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
                onClick={() => {
                  setBindingError('');
                  if (!bindingSession.confirm()) setBindingError('原任务已不存在或任务块已被删除，无法保存；你可以取消返回。');
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                aria-label="完成知识节点选择"
              >
                <Check size={14} /> 完成选择
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
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-500/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full shadow-lg text-[13px] font-medium z-20 flex items-center gap-2 border border-blue-400"
          >
            <MoveRight size={14} className="text-white" />
            请点击选择要转移到的目标父节点，或点击空白处使其成为根节点。
            <button onClick={() => setIsMoveMode(false)} className="ml-2 px-2 py-0.5 bg-white/20 rounded text-xs hover:bg-white/30 transition-colors">取消</button>
          </motion.div>
        ) : !bindingSession.active && showHint ? (
          <motion.div 
            key="normal-hint"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
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

      {/* Portal Dock Controls */}
      {dockPortalTarget && createPortal(
          <motion.div
            layout
            key="knowledge-graph-actions"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="flex items-center gap-2 px-1"
          >
            <div className="relative group flex items-center bg-slate-100/50 hover:bg-slate-200/60 rounded-lg px-2 py-1.5 transition-all cursor-pointer border border-transparent shadow-sm">
              <Command size={14} className="text-slate-500 group-hover:text-blue-500 transition-colors shrink-0" />
              <select 
                className="appearance-none bg-transparent border-none outline-none focus:ring-0 text-[13px] font-semibold text-slate-700 cursor-pointer pl-1.5 pr-5 min-w-[60px] max-w-[120px] truncate"
                value={selectedRootFilter}
                onChange={e => setSelectedRootFilter(e.target.value)}
              >
                <option value="all">全景视角</option>
                {rootNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <ChevronDown size={14} className="text-slate-400 absolute right-1.5 pointer-events-none" />
            </div>
            
            <div className="tl-dock-divider mx-0.5" />
            
            <button 
              onClick={zoomToFit}
              className="tl-dock-btn text-slate-500 hover:text-blue-600"
              title="视角归中"
            >
              <Focus size={16} />
            </button>

            <div className="tl-dock-divider mx-0.5" />

            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-100/50 rounded-full shadow-sm">
              <button 
                onClick={() => setStatusFilter(prev => prev === 'overdue' ? 'all' : 'overdue')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${statusFilter === 'overdue' ? 'bg-rose-500 scale-110 shadow-[0_0_8px_rgba(244,63,94,0.4)]' : statusFilter !== 'all' ? 'bg-slate-300/50 opacity-50' : 'bg-rose-400 hover:scale-110'}`}
                title="查看严重逾期"
              />
              <button 
                onClick={() => setStatusFilter(prev => prev === 'active' ? 'all' : 'active')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${statusFilter === 'active' ? 'bg-emerald-500 scale-110 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : statusFilter !== 'all' ? 'bg-slate-300/50 opacity-50' : 'bg-emerald-400 hover:scale-110'}`}
                title="查看进行中"
              />
              <button 
                onClick={() => setStatusFilter(prev => prev === 'completed' ? 'all' : 'completed')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${statusFilter === 'completed' ? 'bg-amber-500 scale-110 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : statusFilter !== 'all' ? 'bg-slate-300/50 opacity-50' : 'bg-amber-400 hover:scale-110'}`}
                title="查看已圆满"
              />
            </div>
            <div className="tl-dock-divider mx-0.5" />
            <div className="flex items-center group relative h-[36px]">
              <button className="tl-dock-btn" onClick={() => { setIsSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 50); }} title="搜索知识">
                <Search size={16} className={`transition-colors ${searchQuery ? 'text-blue-600' : 'text-slate-500'}`} />
              </button>
              <AnimatePresence>
                {(isSearchExpanded || searchQuery) && (
                  <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 120, opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="flex items-center overflow-hidden">
                    <input ref={searchInputRef} type="text" placeholder="搜索..." className="bg-transparent border-none outline-none text-[13px] font-medium w-full text-slate-700 pl-1 pr-6" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onBlur={() => { if (!searchQuery) setIsSearchExpanded(false); }} />
                    {searchQuery && <button onClick={() => { setSearchQuery(''); setIsSearchExpanded(false); }} className="absolute right-1 text-slate-400 p-0.5 z-10"><X size={14} /></button>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>,
        dockPortalTarget
      )}

      {capsuleNodeId && <TimeCapsuleModal nodeId={capsuleNodeId} onClose={() => setCapsuleNodeId(null)} />}

      {/* SVG Sunburst Canvas */}
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }}>
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
                {island.nodes.map((node: any) => {
                  const isVirtual = node.data.isVirtual;
                  const isSelected = selectedNodeId === node.id;
                  const isBindingSelected = bindingSession.active && bindingSession.selectedNodeIds.includes(node.id);

                  const isXRayActive = matchingNodeIds !== null;
                  const isXRayMatched = isXRayActive && matchingNodeIds.has(node.id);
                  const isDimmed = isXRayActive && !isXRayMatched;

                  const fillColor = isVirtual ? '#ffffff' : node.data.color;
                  const hasOverdueRounds = node.data.overdueCount > 0;
                  const strokeColor = isBindingSelected ? '#4f46e5' : (isSelected ? '#0f172a' : (hasOverdueRounds ? '#ef4444' : (isVirtual ? '#cbd5e1' : '#ffffff')));
                  const strokeWidth = isBindingSelected ? 4 : (isSelected ? 2.5 : (hasOverdueRounds ? 3 : (isVirtual ? 2 : 1.5)));

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

               // 移除根节点硬编码的黑色，所有节点统一使用动态对比度颜色
               const textFill = getContrastYIQ(fillColor);

                  return (
                    <g 
                      key={node.id}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (bindingSession.active) {
                          if (node.data.isLeaf) bindingSession.toggleNode(node.id);
                          else setSelectedRootFilter(node.id);
                          return;
                        }
                        if (isMoveMode && selectedNodeId && selectedNodeId !== node.id) {
                          // Prevent moving a node to its own descendant
                          const descendants = getDescendants(selectedNodeId);
                          if (!descendants.includes(node.id)) {
                            updateNode(selectedNodeId, { parentId: node.id });
                            setIsMoveMode(false);
                          } else {
                            alert('不能将节点移动到它的子节点下');
                          }
                        } else {
                          setSelectedNodeId(node.id);
                          setIsMoveMode(false);
                        }
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (bindingSession.active) {
                          if (!node.data.isLeaf) setSelectedRootFilter(node.id);
                          return;
                        }
                        if (node.depth > 0 && !node.data.isLeaf) {
                          setSelectedRootFilter(node.id);
                        } else if (node.depth === 0 && selectedRootFilter !== 'all') {
                          setSelectedRootFilter('all');
                        } else if (node.depth === 0 && selectedRootFilter === 'all') {
                          setSelectedRootFilter(node.id);
                        }
                      }}
                      className={`cursor-pointer transition-opacity duration-300 ${isDimmed ? 'opacity-20' : 'opacity-100'}`}
                    >
                      <title>{bindingSession.active ? `${node.data.name}${node.data.isLeaf ? (isBindingSelected ? '（已选择）' : '（点击选择）') : '（点击浏览）'}` : `${node.data.name} · 轮次 ${node.data.completedCount}/${node.data.totalReviewCount}${hasOverdueRounds ? ` · ${node.data.overdueCount} 个逾期` : ''}`}</title>
                      <path
                        d={arcGenerator(node) || ''}
                        fill={fillColor}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        className="transition-all duration-300 hover:opacity-85"
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
                    onBlur={() => { if(editName.trim()) updateNode(selectedNode.id, { name: editName.trim() }) }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    title={editName}
                  />
                </div>
                <div className="flex items-center shrink-0">
                  <div className={styles.actionGroup}>
                    <button onClick={() => setIsMoveMode(!isMoveMode)} className={`${styles.actionBtn} ${isMoveMode ? styles.active : ''}`} title="转移节点层级">
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
                    <button onClick={() => { if(confirm('确定归档吗？')) { archiveNodeCascade(selectedNode.id, true); setSelectedNodeId(null); } }} className={styles.actionBtn}>
                      <Archive size={13} />
                    </button>
                    <div className={styles.actionDivider}></div>
                    <button onClick={() => { if(confirm('确定删除吗？')) { deleteNode(selectedNode.id); setSelectedNodeId(null); } }} className={`${styles.actionBtn} ${styles.danger}`}>
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
                {selectedActivationState && (
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium text-slate-600">
                      {selectedActivationState.isLeaf ? '图谱激活状态' : '子节点激活进度'}
                    </span>
                    <span className={selectedActivationState.isActivated ? 'font-semibold text-blue-600' : 'font-semibold text-slate-500'}>
                      {selectedActivationState.isLeaf
                        ? selectedActivationState.isActivated ? '已激活' : '未激活'
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
                      {relatedTaskBlocks.map(({ task, block }) => (
                        <div key={`${task.id}-${block.id}`} onClick={() => window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'timeline', taskId: task.id, blockId: block.id } }))} className="group flex flex-col gap-1 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <div className="flex justify-between gap-3">
                            <div className="text-xs font-semibold text-slate-800 truncate">{block.header.title}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${block.header.isCompleted ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`}>{block.header.isCompleted ? '已完成' : '进行中'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{block.header.date}</span>·<span className="truncate">{task.name}</span>
                          </div>
                        </div>
                      ))}
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
