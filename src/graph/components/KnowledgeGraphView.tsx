/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Settings2, X, Info, Search, ChevronDown, Command, Zap, Archive, Network } from 'lucide-react';
import { forceCollide, forceX, forceY, forceCenter } from 'd3-force';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { TimeCapsuleModal } from '@/components/GlobalSearch';
import styles from './GraphConsole.module.css';

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
  val: number;
  depth: number;
  rootId: string;
  isLeaf: boolean;
  activeCount: number;
  totalLeafCount: number;
  neighbors: string[];
  links: string[];
  pendingCount: number;
  completedCount: number;
  overdueCount: number;
  totalReviewCount: number;
  noteCount: number;
  importanceScore: number;
  labelPriority: 'high' | 'medium' | 'low';
  radius: number;
};

type ViewLink = {
  id: string;
  source: string;
  target: string;
  kind: 'hierarchy';
  score: number;
};

export const KnowledgeGraphView: React.FC = () => {
  const { isHydrated, hydrateStore, nodes: allNodes, addNode, deleteNode, updateNode, archiveNodeCascade } = useGraphStore();
  const nodes = useMemo(() => allNodes.filter(n => !n.isArchived), [allNodes]);
  const { reviewTasks } = useEbbStore();
  const { tasks } = useTimelineStore();

  const [newRootName, setNewRootName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newChildName, setNewChildName] = useState('');
  const [isChildInputFocused, setIsChildInputFocused] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);

  // Filter States
  const [selectedRootFilter, setSelectedRootFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Portal into Dock
  const dockPortalTarget = document.getElementById('tl-dock-portal-target');

  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Hover states for Obsidian-like highlighting
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());
  const [capsuleNodeId, setCapsuleNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isHydrated) {
      hydrateStore();
    }
  }, [isHydrated, hydrateStore]);

  // Track Alt key for Link Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltPressed(false);
    };
    const handleBlur = () => setIsAltPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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
    const descendants = getDescendants(nodeId);
    // 判断该节点是否为叶子节点（即没有子节点的节点）
    const isLeaf = descendants.length === 0;

    const graphNode = nodes.find(n => n.id === nodeId);
    const isActivated = graphNode?.status === 'activated';

    if (isLeaf) {
      // 针对底层（第三级/叶子节点）的计算逻辑：完全取决于该节点关联的任务
      const familyTasks = reviewTasks.filter(t => t.graphNodeId === nodeId);
      
      if (familyTasks.length === 0) return isActivated ? '#3b82f6' : '#9ca3af'; // blue-500 (单次激活) or gray-400 (未开始)

      const isAllDone = familyTasks.every(t => t.isCompleted);
      if (isAllDone) return '#eab308'; // yellow-500 (全部完成，金色)

      const uncompletedTasks = familyTasks.filter(t => !t.isCompleted).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      const nextTask = uncompletedTasks[0];
      
      if (!nextTask) return isActivated ? '#3b82f6' : '#9ca3af';

      const overdueDays = diffDays(todayStr(), nextTask.dueDate);
      
      if (overdueDays > 2) return '#ef4444'; // red-500 (严重逾期)
      if (overdueDays === 1 || overdueDays === 2) return '#84cc16'; // lime-500 (即将到期，黄色/黄绿色)
      
      // 进行中，正常进度
      return '#10b981'; // emerald-500 (绿色)
    } else {
      // 针对上层（第二级/第一级节点）的计算逻辑：由其所有叶子子孙节点决定
      // 1. 找出所有叶子节点
      const leafIds = descendants.filter(id => {
        return !nodes.some(n => n.parentId === id); // 没有人以它为父节点，说明是叶子
      });

      // 如果一个上层节点下连一个叶子都没有，保持灰色/蓝色
      if (leafIds.length === 0) return isActivated ? '#3b82f6' : '#9ca3af';

      // 获取每个叶子节点的颜色（递归或重用逻辑，这里直接用叶子的任务判断）
      const leafColors = leafIds.map(leafId => {
        const leafTasks = reviewTasks.filter(t => t.graphNodeId === leafId);
        const childNode = nodes.find(n => n.id === leafId);
        const childIsActivated = childNode?.status === 'activated';

        if (leafTasks.length === 0) return childIsActivated ? '#3b82f6' : '#9ca3af'; // 蓝色/灰色
        if (leafTasks.every(t => t.isCompleted)) return '#eab308'; // 金色
        const nextTask = leafTasks.filter(t => !t.isCompleted).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
        if (!nextTask) return childIsActivated ? '#3b82f6' : '#9ca3af';
        const overdueDays = diffDays(todayStr(), nextTask.dueDate);
        if (overdueDays > 2) return '#ef4444'; // 红色
        if (overdueDays === 1 || overdueDays === 2) return '#84cc16'; // 黄色
        return '#10b981'; // 绿色
      });

      // 法则三：圆满（全员通关）
      if (leafColors.every(c => c === '#eab308')) return '#eab308'; // 全部金色 -> 金色

      // 法则二：报警（连坐机制）
      if (leafColors.includes('#ef4444')) return '#ef4444'; // 只要有一个红色 -> 红色报警
      if (leafColors.includes('#84cc16')) return '#84cc16'; // 只要有一个黄色 -> 黄色报警

      // 法则一：星星之火（只要有一个绿/金/蓝，说明涉足了，但还没全员通关）
      const hasActive = leafColors.some((c: string) => c === '#10b981' || c === '#eab308' || c === '#3b82f6' || c === '#86efac');
      if (hasActive) {
        // 如果全是绿色，就是纯绿色；如果只有部分激活，就是浅绿色
        const allActiveAreGreen = leafColors.filter(c => c !== '#9ca3af').every(c => c === '#10b981');
        if (allActiveAreGreen && !leafColors.includes('#9ca3af')) return '#10b981'; // 全员健康（无灰色）-> 翠绿色
        
        // 如果包含蓝色，或者有灰色，呈现浅蓝色/浅绿色
        if (leafColors.includes('#3b82f6')) {
            const allActiveAreBlue = leafColors.filter(c => c !== '#9ca3af').every(c => c === '#3b82f6');
            if (allActiveAreBlue && !leafColors.includes('#9ca3af')) return '#3b82f6';
            return '#93c5fd'; // blue-300 浅蓝色
        }
        return '#86efac'; // 浅绿色（星星之火，带有一定透明度的绿）
      }

      return isActivated ? '#3b82f6' : '#9ca3af'; // 全灰/全蓝兜底
    }
  }, [reviewTasks, nodes, getDescendants]);

  const graphData = useMemo(() => {
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

    const nodeDepthMap = new Map<string, number>();
    const nodeRootMap = new Map<string, string>();
    const descendantLeafMap = new Map<string, string[]>();
    
    const getDepth = (nodeId: string, currentPath = new Set<string>()): number => {
      if (currentPath.has(nodeId)) return 0; // Prevent cycle infinite loop
      const node = nodeMap.get(nodeId);
      if (!node || !node.parentId) return 0; // Root node is depth 0
      
      if (nodeDepthMap.has(nodeId)) return nodeDepthMap.get(nodeId)!;
      
      currentPath.add(nodeId);
      const depth = getDepth(node.parentId, currentPath) + 1;
      currentPath.delete(nodeId);
      
      nodeDepthMap.set(nodeId, depth);
      return depth;
    };

    const getRootId = (nodeId: string, currentPath = new Set<string>()): string => {
      if (currentPath.has(nodeId)) return nodeId;
      const node = nodeMap.get(nodeId);
      if (!node || !node.parentId) return nodeId; // Itself is root
      
      if (nodeRootMap.has(nodeId)) return nodeRootMap.get(nodeId)!;
      
      currentPath.add(nodeId);
      const rootId = getRootId(node.parentId, currentPath);
      currentPath.delete(nodeId);
      
      nodeRootMap.set(nodeId, rootId);
      return rootId;
    };

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
      if (!nodeDepthMap.has(n.id)) {
        nodeDepthMap.set(n.id, getDepth(n.id));
      }
      if (!nodeRootMap.has(n.id)) {
        nodeRootMap.set(n.id, getRootId(n.id));
      }
      if (!descendantLeafMap.has(n.id)) {
        descendantLeafMap.set(n.id, getLeafDescendants(n.id));
      }
    });

    const reviewTasksByNodeId = new Map<string, typeof reviewTasks>();
    reviewTasks.forEach(task => {
      if (!task.graphNodeId) return;
      const bucket = reviewTasksByNodeId.get(task.graphNodeId) ?? [];
      bucket.push(task);
      reviewTasksByNodeId.set(task.graphNodeId, bucket);
    });

    const nodeStatsMap = new Map<string, NodeRollupStats>();
    nodes.forEach(node => {
      const leafIds = descendantLeafMap.get(node.id) ?? [node.id];
      const directStats = mergeStats(
        leafIds.map(leafId => {
          const leafTasks = reviewTasksByNodeId.get(leafId) ?? [];
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

    const hierarchyLinks: ViewLink[] = nodes
      .filter(n => n.parentId)
      .map(n => ({
        id: `${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        kind: 'hierarchy',
        score: 1,
      }));

const gNodes: ViewNode[] = nodes.map(n => {
      const leafIds = descendantLeafMap.get(n.id) ?? [n.id];
      const isLeaf = leafIds.length === 1 && leafIds[0] === n.id;
      const totalLeafCount = isLeaf ? 0 : leafIds.length;
      const activeCount = isLeaf
        ? 0
        : leafIds.filter(leafId => (reviewTasksByNodeId.get(leafId)?.length ?? 0) > 0).length;
      const stats = nodeStatsMap.get(n.id) ?? {
        totalReviewCount: 0,
        pendingCount: 0,
        completedCount: 0,
        overdueCount: 0,
        noteCount: 0,
      };
      const importanceScore =
        (nodeDepthMap.get(n.id) === 0 ? 2.8 : nodeDepthMap.get(n.id) === 1 ? 1.2 : 0) +
        stats.totalReviewCount * 0.8 +
        stats.pendingCount * 1.3 +
        stats.overdueCount * 2.1 +
        stats.noteCount * 0.2 +
        (activeCount > 0 ? 0.8 : 0);

      return {
        id: n.id,
        name: n.name,
        color: getNodeColorHex(n.id),
        val: 1,
        depth: nodeDepthMap.get(n.id) || 0,
        rootId: nodeRootMap.get(n.id) || n.id,
        isLeaf,
        activeCount,
        totalLeafCount,
        neighbors: [],
        links: [],
        pendingCount: stats.pendingCount,
        completedCount: stats.completedCount,
        overdueCount: stats.overdueCount,
        totalReviewCount: stats.totalReviewCount,
        noteCount: stats.noteCount,
        importanceScore,
        labelPriority: 'low',
        radius: 0,
      };
    });

    // Calculate degrees and neighbors
    const allLinks: ViewLink[] = [...hierarchyLinks];
    allLinks.forEach(link => {
      const a = gNodes.find(n => n.id === link.source);
      const b = gNodes.find(n => n.id === link.target);
      if (a && b) {
        a.neighbors.push(b.id);
        b.neighbors.push(a.id);
        a.links.push(link.id);
        b.links.push(link.id);
        a.val += 1;
        b.val += 1;
      }
    });

    gNodes.forEach(node => {
      node.labelPriority =
        node.depth === 0 || node.overdueCount > 0 || node.totalReviewCount >= 4
          ? 'high'
          : node.pendingCount > 0 || node.depth === 1
            ? 'medium'
            : 'low';
      node.radius = Math.max(
        2.4,
        Math.min(
          node.depth === 0 ? 8.5 : 6.0,
          3 + node.importanceScore * 0.12 - node.depth * 0.35,
        ),
      );
    });

    let finalNodes = gNodes;
    let finalLinks = allLinks;

    if (selectedRootFilter !== 'all') {
      finalNodes = gNodes.filter(n => n.rootId === selectedRootFilter);
      const validNodeIds = new Set(finalNodes.map(n => n.id));
      finalLinks = allLinks.filter(l => validNodeIds.has(l.source) && validNodeIds.has(l.target));
    }

    return { nodes: finalNodes, links: finalLinks };
  }, [nodes, getNodeColorHex, reviewTasks, selectedRootFilter]);

  const rootNodes = useMemo(() => {
    return nodes.filter(n => !n.parentId);
  }, [nodes]);

  const matchingNodeIds = useMemo(() => {
    if (statusFilter === 'all' && !searchQuery.trim()) return null;

    const query = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();

    graphData.nodes.forEach((node: ViewNode) => {
      let isMatch = false;

      const matchStatus = statusFilter === 'all' 
        || (statusFilter === 'overdue' && (node.overdueCount > 0 || node.color === '#ef4444'))
        || (statusFilter === 'active' && ((node.pendingCount > 0 && node.color !== '#ef4444') || node.color === '#10b981' || node.color === '#86efac'))
        || (statusFilter === 'completed' && node.color === '#eab308');

      const matchQuery = !query || node.name.toLowerCase().includes(query);

      if (matchStatus && matchQuery) {
        isMatch = true;
      }

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
  }, [graphData.nodes, statusFilter, searchQuery, nodes]);

  const globalArchivedResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.trim().toLowerCase();
    return allNodes.filter(n => n.isArchived && n.name.toLowerCase().includes(query));
  }, [searchQuery, allNodes]);

  useEffect(() => {
    if (fgRef.current) {
      // 1. 预先计算学科团簇的环形坐标，用于实现星系态多中心引力布局
      const rootNodes = graphData.nodes.filter((n: any) => n.depth === 0);
      rootNodes.sort((a: any, b: any) => a.id.localeCompare(b.id));

      const rootRadii = new Map<string, number>();
      let maxRadius = 0;
      graphData.nodes.forEach((node: any) => {
        const rId = node.rootId || node.id;
        const currentMax = rootRadii.get(rId) || 0;
        const r = Math.max(currentMax, (node.depth || 0) * 45 + 60);
        rootRadii.set(rId, r);
        if (r > maxRadius) maxRadius = r;
      });

      const numClusters = rootNodes.length;
      const rootCenters = new Map<string, {x: number, y: number}>();
      const cx = dimensions.width ? dimensions.width / 2 : 500;
      const cy = dimensions.height ? dimensions.height / 2 : 500;

      if (numClusters <= 1) {
        if (numClusters === 1) rootCenters.set(rootNodes[0].id, { x: cx, y: cy });
      } else {
        // 进一步降低团簇间的强制安全距离
        // 将系数从 1.1 降至 0.6，允许更大的边缘交融，依靠排斥力(-250)自然隔开
        const requiredDistance = maxRadius * 0.6 + 20; 
        const orbitRadius = requiredDistance / (2 * Math.sin(Math.PI / numClusters));
        
        rootNodes.forEach((root: any, i: number) => {
          // 2个学科水平分布；3个及以上呈环形多边形分布
          const angleOffset = numClusters === 2 ? 0 : -Math.PI / 2;
          const angle = angleOffset + (i * 2 * Math.PI) / numClusters;
          rootCenters.set(root.id, {
            x: cx + Math.cos(angle) * orbitRadius,
            y: cy + Math.sin(angle) * orbitRadius
          });
        });
      }

      // 2. 移除绝对的强制同心圆，改用多中心 X/Y 轴引力（Multi-foci）
      fgRef.current.d3Force('radial', null); // 彻底移除生硬的径向力
      
      // 赋予相等的 X/Y 轴引力（0.06），消除受力不均导致的对角线侧滑
      fgRef.current.d3Force('cluster-x', forceX((node: any) => {
        const rId = node.rootId || node.id;
        return rootCenters.get(rId)?.x ?? cx;
      }).strength(0.06));

      fgRef.current.d3Force('cluster-y', forceY((node: any) => {
        const rId = node.rootId || node.id;
        return rootCenters.get(rId)?.y ?? cy;
      }).strength(0.06));

      // 3. 控制排斥：增强排斥力，让节点自然散开，形成星云感
      fgRef.current.d3Force('charge').strength(() => {
        return -250; // 稍微加大斥力，因为有聚拢力了
      }).distanceMax(800);
      
      // 4. 结构边强约束
      fgRef.current.d3Force('link')
        .distance(70)
        .strength(0.8); 

      // 5. 全局弱居中力（防止极端情况下图谱整体偏移）
      fgRef.current.d3Force('center', forceCenter(dimensions.width / 2, dimensions.height / 2).strength(0.02));
      
      // 6. 碰撞保护：标签与节点之间保留呼吸感，防止重叠
      fgRef.current.d3Force('collide', forceCollide().radius((node: any) => {
        const baseR = node.radius ?? Math.max(3, Math.min(10, Math.sqrt(node.val || 1) * 2.5));
        let padding = node.depth === 0 ? 25 : (node.depth === 1 ? 15 : 8);
        if (node.labelPriority === 'high') padding += 5;
        if (node.name && node.name.length > 6) {
          padding += (node.name.length - 6) * 1.5;
        }
        return baseR + padding; 
      }).iterations(2)); // 降低碰撞迭代次数，防止物理爆炸
    }
  }, [dimensions, graphData]);

  // 5. 自动缩放自适应 (Zoom to Fit)
  // 当数据变化导致物理引擎重新计算后，稍微延迟一下让引擎稳定，然后缩放视口
  useEffect(() => {
    if (fgRef.current && nodes.length > 0) {
      const timer = setTimeout(() => {
        if (fgRef.current) {
          fgRef.current.zoomToFit(400, 80); // 恢复 zoomToFit
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, selectedRootFilter]);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedGraphNode = useMemo(
    () => graphData.nodes.find((node: ViewNode) => node.id === selectedNodeId) ?? null,
    [graphData, selectedNodeId],
  );
  const selectedNodeReviewPreview = useMemo(() => {
    if (!selectedNodeId) return [];
    const scopedIds = new Set([selectedNodeId, ...getDescendants(selectedNodeId)]);
    return reviewTasks
      .filter(task => task.graphNodeId && scopedIds.has(task.graphNodeId))
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return Number(a.isCompleted) - Number(b.isCompleted);
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      })
      .slice(0, 3);
  }, [selectedNodeId, getDescendants, reviewTasks]);

  const relatedTaskBlocks = useMemo(() => {
    if (!selectedNodeId) return [];
    const scopedIds = new Set([selectedNodeId, ...getDescendants(selectedNodeId)]);
    
    const results: { task: any, block: any }[] = [];
    tasks.forEach(task => {
      if (!task.blocks) return;
      task.blocks.forEach(block => {
        if (block.type === 'smart-task' && block.header.graphNodeId && scopedIds.has(block.header.graphNodeId)) {
          results.push({ task, block });
        }
      });
    });
    
    results.sort((a, b) => {
      const dateA = a.block.header.date || '';
      const dateB = b.block.header.date || '';
      return dateB.localeCompare(dateA);
    });
    
    return results;
  }, [selectedNodeId, getDescendants, tasks]);

  useEffect(() => {
    if (selectedNode) {
      setEditName(selectedNode.name);
      setIsPanelOpen(true);
    }
  }, [selectedNode]);

  // Check if making `childId` a child of `newParentId` creates a cycle
  const wouldCreateCycle = useCallback((newParentId: string, childId: string) => {
    let currentId: string | null = newParentId;
    while (currentId) {
      if (currentId === childId) return true;
      const current = nodes.find(n => n.id === currentId);
      currentId = current?.parentId || null;
    }
    return false;
  }, [nodes]);

  // Smart Markdown Import Logic
  const handleImport = useCallback((text: string, baseParentId: string | null = null) => {
    if (!text.trim()) return;
    const lines = text.split('\n').map(n => n.trim()).filter(Boolean);
    
    const stack: { level: number, id: string }[] = [];
    if (baseParentId) {
      stack.push({ level: 0, id: baseParentId });
    }

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

  const availableNodesToAbsorb = useMemo(() => {
    if (!selectedNode) return [];
    return nodes.filter(n => 
      n.id !== selectedNode.id && 
      n.parentId !== selectedNode.id && 
      !wouldCreateCycle(selectedNode.id, n.id)
    );
  }, [nodes, selectedNode, wouldCreateCycle]);

  const handleNodeHover = useCallback((node: any) => {
    setHoverNode(node ? node.id : null);
    const newHighlightNodes = new Set<string>();
    const newHighlightLinks = new Set<string>();

    if (node) {
      newHighlightNodes.add(node.id);
      if (node.neighbors) {
        node.neighbors.forEach((neighborId: string) => newHighlightNodes.add(neighborId));
      }
      if (node.links) {
        node.links.forEach((linkId: string) => newHighlightLinks.add(linkId));
      }
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
  }, []);

  if (!isHydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-slate-400 text-sm">正在加载图谱数据...</div>
      </div>
    );
  }

  return (
    <div className="knowledge-graph-view w-full h-full bg-white relative">
      {/* Global Hint for Alt + Click */}
      {isAltPressed && selectedNodeId && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-600/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all duration-300 pointer-events-none z-20 flex items-center gap-2 animate-in slide-in-from-top-4 fade-in">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          快捷连线：点击任意高亮节点，将其设为 "{selectedNode?.name}" 的子节点
        </div>
      )}

      {/* 知识大盘的专属控制台已经通过 Portal 注入到底部全局 Dock，故这里不再保留顶部独立的悬浮面板 */}
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
            {/* 2. Root Filter (Modern Pill Container) */}
            <div className="relative group flex items-center bg-slate-100/50 hover:bg-slate-200/60 rounded-lg px-2 py-1.5 transition-all cursor-pointer border border-transparent hover:border-slate-200/80 shadow-sm">
              <Command size={14} className="text-slate-500 group-hover:text-blue-500 transition-colors shrink-0" />
              <select 
                className="appearance-none bg-transparent border-none outline-none focus:ring-0 text-[13px] font-semibold text-slate-700 cursor-pointer pl-1.5 pr-5 min-w-[60px] max-w-[120px] truncate"
                value={selectedRootFilter}
                onChange={e => setSelectedRootFilter(e.target.value)}
                title="全景视角"
              >
                <option value="all">全景视角</option>
                {rootNodes.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors absolute right-1.5" pointerEvents="none" />
            </div>

            <div className="tl-dock-divider mx-0.5" />

            {/* 3. Status Toggles (Modern Traffic Lights in a Pod) */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-100/50 rounded-full border border-slate-200/50 shadow-sm">
              <button 
                onClick={() => setStatusFilter(prev => prev === 'overdue' ? 'all' : 'overdue')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 shadow-inner transition-all duration-300 outline-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-200 ${
                  statusFilter === 'overdue' 
                    ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)] scale-110' 
                    : statusFilter !== 'all' 
                      ? 'bg-slate-300/50 opacity-50' 
                      : 'bg-rose-400 hover:bg-rose-500 hover:scale-110'
                }`}
                title="查看严重逾期"
              />
              <button 
                onClick={() => setStatusFilter(prev => prev === 'active' ? 'all' : 'active')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 shadow-inner transition-all duration-300 outline-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-200 ${
                  statusFilter === 'active' 
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] scale-110' 
                    : statusFilter !== 'all' 
                      ? 'bg-slate-300/50 opacity-50' 
                      : 'bg-emerald-400 hover:bg-emerald-500 hover:scale-110'
                }`}
                title="查看进行中"
              />
              <button 
                onClick={() => setStatusFilter(prev => prev === 'completed' ? 'all' : 'completed')}
                className={`w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 shadow-inner transition-all duration-300 outline-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-amber-200 ${
                  statusFilter === 'completed' 
                    ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)] scale-110' 
                    : statusFilter !== 'all' 
                      ? 'bg-slate-300/50 opacity-50' 
                      : 'bg-amber-400 hover:bg-amber-500 hover:scale-110'
                }`}
                title="查看已圆满"
              />
            </div>

            <div className="tl-dock-divider mx-0.5" />

            {/* 4. Search (Collapsible) */}
          <div className="flex items-center group relative h-[36px]">
            <button
              className="tl-dock-btn"
              onClick={() => {
                setIsSearchExpanded(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              title="搜索知识"
            >
              <Search size={16} className={`transition-colors ${searchQuery ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
            </button>
            
            <AnimatePresence>
              {(isSearchExpanded || searchQuery) && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 120, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="flex items-center overflow-hidden"
                >
                  <input 
                    ref={searchInputRef}
                    type="text" 
                    placeholder="搜索..." 
                    className="bg-transparent border-none outline-none text-[13px] font-medium w-full text-slate-700 placeholder:text-slate-400 pl-1 pr-6"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onBlur={() => {
                      if (!searchQuery) setIsSearchExpanded(false);
                    }}
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => {
                        setSearchQuery('');
                        setIsSearchExpanded(false);
                      }} 
                      className="absolute right-1 text-slate-400 hover:text-slate-700 p-0.5 z-10"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  )}
                  {/* 归档搜索结果下拉框 */}
                  {searchQuery && globalArchivedResults.length > 0 && (
                    <div className="absolute top-[calc(100%+8px)] right-0 w-64 bg-white/90 backdrop-blur-xl border border-slate-200/50 shadow-xl rounded-xl overflow-hidden flex flex-col z-50">
                      <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50 border-b border-slate-100/80 flex items-center gap-1.5">
                        <Archive size={12} />
                        冷数据 (时光胶囊)
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {globalArchivedResults.map(node => (
                          <button
                            key={node.id}
                            onClick={() => {
                              setCapsuleNodeId(node.id);
                              setSearchQuery('');
                              setIsSearchExpanded(false);
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-2 py-2 hover:bg-blue-50/50 rounded-lg transition-colors group"
                          >
                            <div className="p-1.5 bg-slate-100 text-slate-500 rounded-md group-hover:bg-blue-100 group-hover:text-blue-500 transition-colors">
                              <Archive size={14} />
                            </div>
                            <div className="flex-1 truncate">
                              <div className="text-xs font-semibold text-slate-700 group-hover:text-blue-700">{node.name}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">点击开启时光胶囊</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>,
        dockPortalTarget
      )}

      {capsuleNodeId && <TimeCapsuleModal nodeId={capsuleNodeId} onClose={() => setCapsuleNodeId(null)} />}

      {/* Dot Grid Background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #e5e7eb 1px, transparent 0)',
        backgroundSize: '24px 24px',
        opacity: 0.6
      }} />

      <div className="absolute inset-0 w-full h-full overflow-hidden" ref={containerRef}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeRelSize={6}
            linkColor={(link: any) => {
              const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
              const targetId = typeof link.target === 'object' ? link.target.id : link.target;
              
              const isXRayActive = matchingNodeIds !== null;
              const isXRayMatched = isXRayActive && matchingNodeIds.has(sourceId) && matchingNodeIds.has(targetId);
              
              const isHoverDimmed = hoverNode !== null && !highlightLinks.has(link.id);
              const isDimmed = isHoverDimmed || (isXRayActive && !isXRayMatched);
              
              if (isDimmed) return isXRayActive ? 'rgba(226, 232, 240, 0.2)' : '#f8fafc';
              if (isXRayActive && isXRayMatched) return 'rgba(148, 163, 184, 0.7)'; // slate-400 semi-transparent for paths
              
              return highlightLinks.has(link.id) ? '#64748b' : '#dbe4ee';
            }}
            linkWidth={(link: any) => {
              return highlightLinks.has(link.id) ? 2.4 : 1.15;
            }}
            linkDirectionalParticles={(link: any) => highlightLinks.has(link.id) ? 2 : 0}
            linkDirectionalParticleWidth={2.5}
            linkDirectionalParticleSpeed={0.006}
            onNodeClick={(node: any, event: any) => {
              // Scheme A: Canvas Alt+Click to link
              if (event.altKey && selectedNodeId && node.id !== selectedNodeId) {
                if (!wouldCreateCycle(selectedNodeId, node.id)) {
                  updateNode(node.id, { parentId: selectedNodeId });
                } else {
                  alert('无法连线：该节点是当前节点的父级或祖先节点，会造成循环引用。');
                }
                return; // Do not change selection
              }
              setSelectedNodeId(node.id as string);
            }}
            onNodeRightClick={(node: any) => {
              // 右击：聚焦/居中该节点，而不是改变其状态
              if (fgRef.current) {
                fgRef.current.centerAt(node.x, node.y, 800);
                fgRef.current.zoom(4, 800);
              }
            }}
            onBackgroundClick={() => setSelectedNodeId(null)}
            onNodeHover={handleNodeHover}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (node.x === undefined || node.y === undefined || isNaN(node.x) || isNaN(node.y)) {
                // Return early instead of logging to prevent console spam
                return;
              }
              const isSelected = node.id === selectedNodeId;
              const isHovered = node.id === hoverNode;
              const isHighlighted = highlightNodes.has(node.id);
              
              const isXRayActive = matchingNodeIds !== null;
              const isXRayMatched = isXRayActive && matchingNodeIds.has(node.id);
              
              const isDimmed = (hoverNode !== null && !isHighlighted) || (isXRayActive && !isXRayMatched);
              
              const canBeAbsorbed = isAltPressed && selectedNodeId && isHovered && !isSelected && !wouldCreateCycle(selectedNodeId, node.id);

              const label = node.name;
              
              // === Obsidian 风格的文字缩放逻辑 ===
              // 取消基于优先级的字号放大 (priorityBoost)，仅保留全局统一的基础字号
              const rawFontSize = 11.5 / globalScale;
              const fontSize = Math.min(15, Math.max(3, rawFontSize));

              // 恢复原有的加粗逻辑：仅在悬停或选中时加粗 (600)，常规状态保持 400
              const isBold = isSelected || isHovered;
              ctx.font = `${isBold ? '600' : '400'} ${fontSize}px Inter, system-ui, sans-serif`;

              const r = node.radius ?? Math.max(2.4, Math.min(6, node.val));
              // 动态光晕：大节点光晕小，小节点光晕适中，保持视觉平衡
              const haloBoost = r > 5 ? 0.5 : (r > 3 ? 0.8 : 1.0);
              const haloRadius = r + haloBoost / globalScale;

              if (!isDimmed && (node.overdueCount > 0 || node.labelPriority === 'high')) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, haloRadius, 0, 2 * Math.PI, false);
                ctx.fillStyle = node.overdueCount > 0
                  ? 'rgba(239, 68, 68, 0.14)'
                  : 'rgba(59, 130, 246, 0.08)';
                ctx.fill();
              }
              
              // 绘制节点圆形
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
              ctx.fillStyle = isDimmed ? (isXRayActive ? 'rgba(226, 232, 240, 0.3)' : '#f8fafc') : node.color;
              ctx.fill();

              if (canBeAbsorbed) {
                ctx.lineWidth = 3 / globalScale;
                ctx.strokeStyle = '#10b981'; // emerald-500
                ctx.setLineDash([4 / globalScale, 4 / globalScale]);
                ctx.stroke();
                ctx.setLineDash([]);
              } else if (isSelected) {
                // 彻底删掉第二层浅蓝大环，仅保留一层稍微加粗的实线边框
                ctx.lineWidth = 2.0 / globalScale;
                ctx.strokeStyle = '#3b82f6';
                ctx.stroke();
              } else if (isHovered || isHighlighted) {
                ctx.lineWidth = 1 / globalScale;
                ctx.strokeStyle = '#64748b';
                ctx.stroke();
              }

              // Show text if scale is sufficient, or if highlighted/hovered
              // 方案A：众生平等。所有节点统一使用 0.85 的阈值，无视优先级。
              const scaleThreshold = 0.85;
              // 取消了 isSelected 的强制豁免，保留 isHovered 和 isHighlighted 的豁免
              const showText = globalScale > scaleThreshold || isHighlighted || isHovered;
              
              if (showText && !isDimmed) {
                const padding = globalScale < 1 ? fontSize * 1.2 : fontSize * 0.8;
                const textY = node.y + r + padding;
                
                // === 绘制进度比例标签 ===
              // Dynamic Text Truncation: 限制文字宽度，最多不超过 6 个字符
              // 增加缩放感知：当全局放大比例大于 1.3 时，认为空间充足，不再截断
              const isZoomedIn = globalScale > 1.3;
              const MAX_CHARS = 6;
              let displayLabel = label;
              const isTruncated = label.length > MAX_CHARS && !isZoomedIn;
              
              if (!isHovered && !isHighlighted && isTruncated) {
                displayLabel = label.substring(0, MAX_CHARS) + '...';
              }
              
              let progressText = '';
              
              // 如果不是叶子节点，并且有叶子节点，则显示进度 (激活数/总数)
              if (!node.isLeaf && node.totalLeafCount > 0) {
                progressText = ` (${node.activeCount}/${node.totalLeafCount})`;
                // 在非 hover 且截断的状态下，我们仍然追加进度信息
                displayLabel += progressText;
              }
              
              const textWidth = ctx.measureText(displayLabel).width;
              const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4);
              
              const shouldDrawBg = isSelected || isHovered || isHighlighted || node.labelPriority === 'high';
              
              if (shouldDrawBg) {
                // 如果是 hover/highlight 状态，绘制气泡 Tooltip 样式
                if (isHovered || isHighlighted) {
                   ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                   // 增加圆角矩形的效果 (Canvas 原生模拟)
                   const bgX = node.x - bckgDimensions[0] / 2;
                   const bgY = textY - bckgDimensions[1] / 2;
                   const bgW = bckgDimensions[0];
                   const bgH = bckgDimensions[1];
                   const radiusCorner = 4 / globalScale;
                   
                   ctx.beginPath();
                   ctx.moveTo(bgX + radiusCorner, bgY);
                   ctx.lineTo(bgX + bgW - radiusCorner, bgY);
                   ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radiusCorner);
                   ctx.lineTo(bgX + bgW, bgY + bgH - radiusCorner);
                   ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radiusCorner, bgY + bgH);
                   ctx.lineTo(bgX + radiusCorner, bgY + bgH);
                   ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radiusCorner);
                   ctx.lineTo(bgX, bgY + radiusCorner);
                   ctx.quadraticCurveTo(bgX, bgY, bgX + radiusCorner, bgY);
                   ctx.closePath();
                   
                   ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
                   ctx.shadowBlur = 8 / globalScale;
                   ctx.shadowOffsetY = 2 / globalScale;
                   ctx.fill();
                   
                   ctx.shadowColor = 'transparent';
                   ctx.shadowBlur = 0;
                   ctx.shadowOffsetY = 0;
                   
                   ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
                   ctx.lineWidth = 1 / globalScale;
                   ctx.stroke();
                } else {
                  ctx.fillStyle = isSelected
                    ? 'rgba(255, 255, 255, 0.95)'
                    : 'rgba(255, 255, 255, 0.68)';
                  ctx.fillRect(node.x - bckgDimensions[0] / 2, textY - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                }
              }

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              ctx.fillStyle = isSelected
                ? '#0f172a'
                : isHovered || isHighlighted || node.labelPriority === 'high'
                  ? '#334155'
                  : '#64748b';
              
              if (progressText) {
                 const labelText = !isHovered && !isHighlighted && isTruncated ? label.substring(0, MAX_CHARS) + '...' : label;
                 const labelWidth = ctx.measureText(labelText).width;
                const progressWidth = ctx.measureText(progressText).width;
                const startX = node.x - (labelWidth + progressWidth) / 2;
                
                ctx.textAlign = 'left';
                ctx.fillText(labelText, startX, textY);
                
                ctx.fillStyle = isSelected ? '#64748b' : '#94a3b8';
                ctx.font = `${isSelected || isHovered ? '500' : '400'} ${fontSize * 0.9}px Inter, system-ui, sans-serif`;
                ctx.fillText(progressText, startX + labelWidth, textY);
              } else {
                ctx.fillText(displayLabel, node.x, textY);
              }
            }

            // Restore global alpha
            ctx.globalAlpha = 1;
          }}
          nodeCanvasObjectMode={() => 'replace'}
        />
        )}

        {/* Floating Control Panel - Mac / Linear Style */}
        {isPanelOpen ? (
          <div className={styles.panel}>
            {selectedNode ? (
              <div className={styles.panelContainer}>
                {/* 极简头部与操作区 */}
                <div className={styles.header}>
                  <div className="flex-1 pr-3 relative group w-0">
                    <input
                      type="text"
                      className="w-full bg-transparent text-lg font-bold text-slate-800 placeholder-slate-400 focus:outline-none rounded px-1 -ml-1 border border-transparent focus:border-slate-200/60 transition-all truncate"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => { if(editName.trim()) updateNode(selectedNode.id, { name: editName.trim() }) }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      title={editName}
                    />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 pointer-events-none transition-opacity bg-white/80 px-1">
                      编辑
                    </div>
                  </div>
                  
                  {/* 右上角操作区 - 分段式胶囊控制器 */}
                  <div className="flex items-center shrink-0">
                    <div className={styles.actionGroup}>
                      <button
                        onClick={() => {
                          const newStatus = selectedNode.status === 'activated' ? 'unactivated' : 'activated';
                          updateNode(selectedNode.id, { status: newStatus });
                        }}
                        className={`${styles.actionBtn} ${selectedNode.status === 'activated' ? styles.active : ''}`}
                        title={selectedNode.status === 'activated' ? '已激活' : '激活节点'}
                      >
                        <Zap size={13} className={selectedNode.status === 'activated' ? 'fill-blue-500' : ''} />
                      </button>
                      <div className={styles.actionDivider}></div>
                      <button
                        onClick={() => {
                          if(confirm('归档后，该节点及其所有子节点、复习任务将从主工作区隐藏，但仍可在全局搜索中查看。确定归档吗？')) {
                            archiveNodeCascade(selectedNode.id, true);
                            setSelectedNodeId(null);
                          }
                        }}
                        className={styles.actionBtn}
                        title="归档节点 (封存冷数据)"
                      >
                        <Archive size={13} />
                      </button>
                      <div className={styles.actionDivider}></div>
                      <button
                        onClick={() => {
                          if(confirm('确定删除该节点吗？')) {
                            deleteNode(selectedNode.id);
                            setSelectedNodeId(null);
                          }
                        }}
                        className={`${styles.actionBtn} ${styles.danger}`}
                        title="删除节点"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <button onClick={() => setIsPanelOpen(false)} className={styles.closeBtn} title="收起">
                      <X size={13} />
                    </button>
                  </div>
                </div>

                <div className="px-5 pb-5 flex flex-col gap-5">
                  {/* 无边框状态数据看板 - 单色调降噪 */}
                  {selectedGraphNode && (
                    <div className={styles.statsBoard}>
                      <div className={styles.statItem}>
                        <span className={styles.statValue}>{selectedGraphNode.pendingCount}</span>
                        <span className={styles.statLabel}>待复习</span>
                      </div>
                      <div className={styles.statDivider}></div>
                      <div className={styles.statItem}>
                        <span className={`${styles.statValue} ${selectedGraphNode.overdueCount > 0 ? styles.overdue : ''}`}>
                          {selectedGraphNode.overdueCount}
                        </span>
                        <span className={styles.statLabel}>逾期</span>
                      </div>
                      <div className={styles.statDivider}></div>
                      <div className={styles.statItem}>
                        <span className={styles.statValue}>{selectedGraphNode.completedCount}</span>
                        <span className={styles.statLabel}>已完成</span>
                      </div>
                      <div className={styles.statDivider}></div>
                      <div className={styles.statItem}>
                        <span className={styles.statValue}>{selectedGraphNode.totalReviewCount}</span>
                        <span className={styles.statLabel}>总计</span>
                      </div>
                    </div>
                  )}
                  
                  {/* 近期复习预览 (无边框设计 + 日期优化) */}
                  {selectedNodeReviewPreview.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-slate-400/80 uppercase tracking-widest flex items-center gap-1.5">
                        <Zap size={11} className="text-amber-400" />
                        近期复习
                      </div>
                      <div className="space-y-0.5">
                        {selectedNodeReviewPreview.map(task => (
                          <div 
                            key={task.id} 
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'ebb' } }));
                            }}
                            className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2 overflow-hidden flex-1">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${task.isCompleted ? 'bg-emerald-400' : 'bg-amber-400'}`}></div>
                              <span className="truncate text-xs font-medium text-slate-700 group-hover:text-blue-600 transition-colors">{task.topicName}</span>
                            </div>
                            <span className={`shrink-0 text-[10px] font-medium ${task.isCompleted ? 'text-emerald-600' : 'text-slate-500 group-hover:text-blue-600 transition-colors'}`}>
                              {task.isCompleted ? '✓' : task.dueDate}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 📝 相关任务块 (无边框幽灵列表 + 徽章化) */}
                  {relatedTaskBlocks.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-slate-400/80 uppercase tracking-widest flex items-center gap-1.5">
                        <Network size={11} className="text-blue-400" />
                        关联任务记录
                      </div>
                      <div className="space-y-1">
                        {relatedTaskBlocks.map(({ task, block }) => (
                          <div 
                            key={`${task.id}-${block.id}`} 
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'timeline', taskId: task.id } }));
                            }}
                            className="group flex flex-col gap-1 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-xs font-semibold text-slate-800 leading-snug group-hover:text-blue-600 transition-colors line-clamp-1 flex-1">
                                {block.header.title}
                              </div>
                              <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                block.header.isCompleted 
                                  ? 'text-emerald-600 bg-emerald-50' 
                                  : 'text-amber-600 bg-amber-50'
                              }`}>
                                {block.header.isCompleted ? '已完成' : '进行中'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                              <span>{block.header.date}</span>
                              {block.header.tag && (
                                <>
                                  <span>·</span>
                                  <span style={{ color: block.header.tagColor || '#64748b' }}>{block.header.tag}</span>
                                </>
                              )}
                              <span>·</span>
                              <span className="truncate max-w-[120px]" title={task.name}>{task.name}</span>
                            </div>
                            
                            {block.body && block.body.replace(/<[^>]*>?/gm, '').trim() && (
                              <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                                {block.body.replace(/<[^>]*>?/gm, '').trim()}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 显性化添加子节点输入框 */}
                  <div className="pt-2 border-t border-slate-100/80">
                    <div className={styles.composer}>
                      <input
                        type="text"
                        placeholder="+ 添加子节点 (Enter 确认)..."
                        className={styles.textarea}
                        value={newChildName}
                        onChange={e => setNewChildName(e.target.value)}
                        onFocus={() => setIsChildInputFocused(true)}
                        onBlur={() => {
                          // 稍微延迟隐藏，让点击吸纳按钮的事件能触发
                          setTimeout(() => setIsChildInputFocused(false), 200);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newChildName.trim()) {
                            handleImport(newChildName, selectedNode.id);
                            setNewChildName('');
                          }
                        }}
                        style={{ paddingBottom: '12px' }} // 子节点不需要加号按钮，所以取消底部留白
                      />
                    </div>
                  </div>

                  {/* 吸纳节点 - 只有输入框聚焦时才 Popover 显示 */}
                  {isChildInputFocused && availableNodesToAbsorb.length > 0 && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-2 fade-in duration-200">
                      <div className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                        <Info size={10} />
                        按住 Alt 点击图谱中的节点，或点击下方标签吸纳
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto custom-scrollbar p-1">
                        {availableNodesToAbsorb.map(n => (
                          <button
                            key={n.id}
                            onClick={() => {
                              updateNode(n.id, { parentId: selectedNode.id });
                              setIsChildInputFocused(false);
                            }}
                            className="group flex items-center gap-1 bg-white border border-slate-200/60 hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 px-2 py-1 rounded-md text-[10px] transition-all shadow-sm"
                            title={`吸纳 "${n.name}"`}
                          >
                            <span className="truncate max-w-[100px]">{n.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.panelContainer}>
                {/* 标题栏 */}
                <div className={styles.header}>
                  <div className={styles.headerTitleWrapper}>
                    <Command size={14} />
                    <h3 className={styles.headerTitle}>图谱控制台</h3>
                  </div>
                  <button onClick={() => setIsPanelOpen(false)} className={styles.closeBtn} title="收起">
                    <X size={14} />
                  </button>
                </div>
                
                {/* 智能录入区 (Global) */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>快速构建</div>
                  <div className={styles.composer}>
                    <textarea
                      placeholder="新建根节点 (支持多行 Markdown)"
                      className={styles.textarea}
                      value={newRootName}
                      onChange={e => setNewRootName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && newRootName.trim()) {
                          e.preventDefault();
                          handleImport(newRootName);
                          setNewRootName('');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newRootName.trim()) {
                          handleImport(newRootName);
                          setNewRootName('');
                        }
                      }}
                      disabled={!newRootName.trim()}
                      className={styles.submitBtn}
                      title="生成节点 (Enter)"
                    >
                      <Plus size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}>
                    <Network size={20} />
                  </div>
                  <h4 className={styles.emptyStateTitle}>探索知识网络</h4>
                  <p className={styles.emptyStateDesc}>
                    点击图谱中的节点查看详情与复习记录，或在上方快速创建新节点
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={() => setIsPanelOpen(true)}
            className={styles.triggerBtn}
            title="打开节点控制台"
          >
            <Settings2 size={20} />
          </button>
        )}
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}} />
    </div>
  );
};
