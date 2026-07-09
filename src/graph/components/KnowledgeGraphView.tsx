/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Check, Settings2, X, Info, Search, ChevronDown, Filter, Command, Zap } from 'lucide-react';
import { forceCollide, forceX, forceY, forceCenter } from 'd3-force';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

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
  const { nodes, addNode, deleteNode, updateNode } = useGraphStore();
  const { reviewTasks } = useEbbStore();

  const [newRootName, setNewRootName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newChildName, setNewChildName] = useState('');
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
            noteCount: leafTasks.reduce((sum, task) => sum + (task.accumulatedNotes?.length ?? 0), 0),
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
          className="flex items-center gap-1"
        >
          {/* 2. Root Filter */}
          <div className="relative group flex items-center px-1 cursor-pointer">
            <Command size={16} className="text-slate-500 group-hover:text-slate-700 transition-colors" />
            <select 
              className="appearance-none bg-transparent text-[13px] font-semibold text-slate-700 outline-none cursor-pointer pl-1 pr-3 min-w-[20px] max-w-[80px] truncate"
              value={selectedRootFilter}
              onChange={e => setSelectedRootFilter(e.target.value)}
              title="全景视角"
            >
              <option value="all">全景</option>
              {rootNodes.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
            <ChevronDown size={12} strokeWidth={2.5} className="text-slate-400 group-hover:text-slate-600 transition-colors absolute right-0" pointerEvents="none" />
          </div>

          <div className="tl-dock-divider" />

          {/* 3. Status Toggles (Compact Traffic Lights) */}
          <div className="flex items-center gap-1.5 px-1">
            <button 
              onClick={() => setStatusFilter(prev => prev === 'overdue' ? 'all' : 'overdue')}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${statusFilter === 'overdue' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] scale-110' : statusFilter !== 'all' ? 'bg-slate-200' : 'bg-rose-400 hover:bg-rose-500 hover:scale-110'}`}
              title="查看严重逾期"
            />
            <button 
              onClick={() => setStatusFilter(prev => prev === 'active' ? 'all' : 'active')}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${statusFilter === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] scale-110' : statusFilter !== 'all' ? 'bg-slate-200' : 'bg-emerald-400 hover:bg-emerald-500 hover:scale-110'}`}
              title="查看进行中"
            />
            <button 
              onClick={() => setStatusFilter(prev => prev === 'completed' ? 'all' : 'completed')}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${statusFilter === 'completed' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] scale-110' : statusFilter !== 'all' ? 'bg-slate-200' : 'bg-amber-400 hover:bg-amber-500 hover:scale-110'}`}
              title="查看已圆满"
            />
          </div>

          <div className="tl-dock-divider" />

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
                      className="absolute right-1 text-slate-400 hover:text-slate-700 p-0.5"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>,
        dockPortalTarget
      )}

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
            onNodeRightClick={(node: any, event: any) => {
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
          <div className="absolute top-6 left-6 bg-white/85 backdrop-blur-xl rounded-2xl shadow-[0_12px_40px_-8px_rgba(0,0,0,0.12)] border border-slate-200/50 w-[280px] max-h-[90vh] overflow-y-auto overflow-x-hidden z-10 transition-all duration-300 custom-scrollbar flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/50 sticky top-0 bg-white/40 backdrop-blur-md z-10">
              <div className="flex items-center gap-2">
                <Command size={14} className="text-slate-600" />
                <h3 className="font-semibold text-slate-800 text-[13px] tracking-wide">节点控制台</h3>
              </div>
              <button onClick={() => setIsPanelOpen(false)} className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 p-1.5 rounded-lg transition-all" title="收起">
                <X size={14} />
              </button>
            </div>
            
            {/* 智能录入区 (Global) */}
            <div className="p-4 border-b border-slate-200/50 bg-slate-50/30">
              <div className="relative">
                <textarea
                  rows={1}
                  placeholder="新建根节点 (支持 Markdown)"
                  className="w-full bg-white border border-slate-200/60 rounded-xl pl-3 pr-8 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100 transition-all resize-none"
                  value={newRootName}
                  onChange={e => setNewRootName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && newRootName.trim()) {
                      e.preventDefault();
                      handleImport(newRootName);
                      setNewRootName('');
                    }
                  }}
                  style={{ minHeight: '36px' }}
                />
                <button
                  onClick={() => {
                    if (newRootName.trim()) {
                      handleImport(newRootName);
                      setNewRootName('');
                    }
                  }}
                  className="absolute right-1.5 top-1.5 p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  title="生成节点 (Enter)"
                >
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {selectedNode ? (
              <div className="p-4 animate-in fade-in duration-200 flex flex-col gap-4">
                {/* 大标题 - 节点名称编辑 */}
                <div className="relative group -mx-2">
                  <textarea
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:bg-slate-50/80 rounded-lg px-2 py-1.5 border border-transparent focus:border-slate-200/60 transition-all"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => { if(editName.trim()) updateNode(selectedNode.id, { name: editName.trim() }) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    rows={1}
                    style={{ minHeight: '32px' }}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 pointer-events-none transition-opacity">
                    点击编辑
                  </div>
                </div>
                
                {/* 状态数据看板 */}
                {selectedGraphNode && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="flex flex-col items-center p-2 rounded-xl bg-slate-50 border border-slate-100/80">
                      <span className="text-[10px] font-medium text-slate-500 mb-0.5">待复习</span>
                      <span className="text-xs font-semibold text-slate-700">{selectedGraphNode.pendingCount}</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-xl bg-rose-50/50 border border-rose-100/50">
                      <span className="text-[10px] font-medium text-rose-400 mb-0.5">逾期</span>
                      <span className="text-xs font-semibold text-rose-600">{selectedGraphNode.overdueCount}</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-xl bg-emerald-50/50 border border-emerald-100/50">
                      <span className="text-[10px] font-medium text-emerald-500 mb-0.5">已完成</span>
                      <span className="text-xs font-semibold text-emerald-600">{selectedGraphNode.completedCount}</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-xl bg-blue-50/50 border border-blue-100/50">
                      <span className="text-[10px] font-medium text-blue-500 mb-0.5">总计</span>
                      <span className="text-xs font-semibold text-blue-600">{selectedGraphNode.totalReviewCount}</span>
                    </div>
                  </div>
                )}
                
                {/* 近期复习预览 */}
                {selectedNodeReviewPreview.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">近期复习</div>
                    <div className="space-y-1">
                      {selectedNodeReviewPreview.map(task => (
                        <div key={task.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 border border-slate-100/80 flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-medium text-slate-600">{task.topicName}</span>
                          <span className={`shrink-0 text-[9px] font-medium ${task.isCompleted ? 'text-emerald-500' : 'text-slate-400'}`}>
                            {task.isCompleted ? '✓ 完成' : task.dueDate}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 操作栏 (激活 / 删除) */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const newStatus = selectedNode.status === 'activated' ? 'unactivated' : 'activated';
                      updateNode(selectedNode.id, { status: newStatus });
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      selectedNode.status === 'activated' 
                        ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Zap size={14} className={selectedNode.status === 'activated' ? 'fill-blue-500' : ''} />
                    {selectedNode.status === 'activated' ? '已激活' : '激活节点'}
                  </button>

                  <button
                    onClick={() => {
                      if(confirm('确定删除该节点吗？')) {
                        deleteNode(selectedNode.id);
                        setSelectedNodeId(null);
                      }
                    }}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all"
                    title="删除节点"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {/* 分割线 */}
                <div className="h-px w-full bg-slate-200/60"></div>

                {/* 添加子节点 */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">添加子节点</div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="输入子节点名称..."
                      className="w-full bg-white border border-slate-200/60 rounded-lg pl-3 pr-8 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100 transition-all"
                      value={newChildName}
                      onChange={e => setNewChildName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newChildName.trim()) {
                          handleImport(newChildName, selectedNode.id);
                          setNewChildName('');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newChildName.trim()) {
                          handleImport(newChildName, selectedNode.id);
                          setNewChildName('');
                        }
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-all"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {/* 吸纳节点 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">吸纳已有节点</span>
                    <div className="group relative">
                      <Info size={12} className="text-slate-400" />
                      <div className="absolute bottom-full right-0 mb-1 w-32 bg-slate-800 text-white text-[9px] p-1.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity text-center shadow-lg">
                        按住 Alt 点击图谱中的节点快速吸纳
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto custom-scrollbar">
                    {availableNodesToAbsorb.length > 0 ? availableNodesToAbsorb.map(n => (
                      <button
                        key={n.id}
                        onClick={() => updateNode(n.id, { parentId: selectedNode.id })}
                        className="group flex items-center gap-1 bg-white border border-slate-200/60 hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 px-2 py-1 rounded-md text-[10px] transition-all shadow-sm"
                        title={`吸纳 "${n.name}"`}
                      >
                        <span className="truncate max-w-[120px]">{n.name}</span>
                        <Plus size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )) : (
                      <span className="text-[10px] text-slate-400">无可吸纳节点</span>
                    )}
                  </div>
                </div>

              </div>
            ) : (
              <div className="p-6 mx-4 my-4 bg-slate-50/50 rounded-xl flex flex-col items-center justify-center text-center border border-slate-200/50 border-dashed">
                <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center mb-3 text-slate-400 border border-slate-100">
                  <Command size={18} />
                </div>
                <h4 className="text-slate-600 font-semibold mb-1 text-xs">未选中节点</h4>
                <p className="text-slate-400 text-[10px] leading-relaxed">
                  点击图谱中的节点开始编辑
                </p>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={() => setIsPanelOpen(true)}
            className="absolute top-6 left-6 bg-white/90 backdrop-blur-md p-2.5 rounded-xl shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)] border border-slate-200/60 text-slate-600 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-all z-10"
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
