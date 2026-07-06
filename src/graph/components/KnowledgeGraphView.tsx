/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Check, Settings2, X, Info } from 'lucide-react';
import { forceCollide, forceRadial, forceX, forceY } from 'd3-force';
import ForceGraph2D from 'react-force-graph-2d';

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
  relationCount: number;
  importanceScore: number;
  labelPriority: 'high' | 'medium' | 'low';
  radius: number;
};

type ViewLink = {
  id: string;
  source: string;
  target: string;
  kind: 'hierarchy' | 'relation';
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

    if (isLeaf) {
      // 针对底层（第三级/叶子节点）的计算逻辑：完全取决于该节点关联的任务
      const familyTasks = reviewTasks.filter(t => t.graphNodeId === nodeId);
      
      if (familyTasks.length === 0) return '#9ca3af'; // gray-400 (未开始)

      const isAllDone = familyTasks.every(t => t.isCompleted);
      if (isAllDone) return '#eab308'; // yellow-500 (全部完成，金色)

      const uncompletedTasks = familyTasks.filter(t => !t.isCompleted).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      const nextTask = uncompletedTasks[0];
      
      if (!nextTask) return '#9ca3af';

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

      // 如果一个上层节点下连一个叶子都没有，保持灰色
      if (leafIds.length === 0) return '#9ca3af';

      // 获取每个叶子节点的颜色（递归或重用逻辑，这里直接用叶子的任务判断）
      const leafColors = leafIds.map(leafId => {
        const leafTasks = reviewTasks.filter(t => t.graphNodeId === leafId);
        if (leafTasks.length === 0) return '#9ca3af'; // 灰色
        if (leafTasks.every(t => t.isCompleted)) return '#eab308'; // 金色
        const nextTask = leafTasks.filter(t => !t.isCompleted).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
        if (!nextTask) return '#9ca3af';
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

      // 法则一：星星之火（只要有一个绿/金，说明涉足了，但还没全员通关）
      const hasActive = leafColors.some(c => c === '#10b981' || c === '#eab308');
      if (hasActive) {
        // 如果全是绿色，就是纯绿色；如果只有部分激活，就是浅绿色
        const allActiveAreGreen = leafColors.filter(c => c !== '#9ca3af').every(c => c === '#10b981');
        if (allActiveAreGreen && !leafColors.includes('#9ca3af')) return '#10b981'; // 全员健康（无灰色）-> 翠绿色
        return '#86efac'; // 浅绿色（星星之火，带有一定透明度的绿）
      }

      return '#9ca3af'; // 全灰兜底
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

    const isHierarchyAdjacent = (sourceId: string, targetId: string) => {
      const source = nodeMap.get(sourceId);
      const target = nodeMap.get(targetId);
      return source?.parentId === targetId || target?.parentId === sourceId;
    };

    const relationScores = new Map<string, ViewLink>();
    const activityBuckets = new Map<string, Set<string>>();

    const addActivity = (rootId: string, date: string | undefined, nodeId: string) => {
      if (!date) return;
      const bucketKey = `${rootId}:${date}`;
      const bucket = activityBuckets.get(bucketKey) ?? new Set<string>();
      bucket.add(nodeId);
      activityBuckets.set(bucketKey, bucket);
    };

    reviewTasks.forEach(task => {
      if (!task.graphNodeId || !nodeMap.has(task.graphNodeId)) return;
      const rootId = nodeRootMap.get(task.graphNodeId) ?? task.graphNodeId;
      addActivity(rootId, task.dueDate, task.graphNodeId);
      addActivity(rootId, task.completedDate, task.graphNodeId);
    });

    activityBuckets.forEach(activeNodeIds => {
      const ids = Array.from(activeNodeIds);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const sourceId = ids[i];
          const targetId = ids[j];
          if (sourceId === targetId) continue;
          if (isHierarchyAdjacent(sourceId, targetId)) continue;
          const pair = [sourceId, targetId].sort();
          const key = pair.join('::');
          const existing = relationScores.get(key);
          if (existing) {
            existing.score += 1;
          } else {
            relationScores.set(key, {
              id: `rel-${pair[0]}-${pair[1]}`,
              source: pair[0],
              target: pair[1],
              kind: 'relation',
              score: 1,
            });
          }
        }
      }
    });

    const relationUsageCount = new Map<string, number>();
    const relationLinks = Array.from(relationScores.values())
      .sort((a, b) => b.score - a.score)
      .filter(link => link.score >= 1)
      .filter(link => {
        const sourceCount = relationUsageCount.get(link.source) ?? 0;
        const targetCount = relationUsageCount.get(link.target) ?? 0;
        if (sourceCount >= 3 || targetCount >= 3) return false;
        relationUsageCount.set(link.source, sourceCount + 1);
        relationUsageCount.set(link.target, targetCount + 1);
        return true;
      })
      .slice(0, 24);

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
        relationCount: 0,
        importanceScore,
        labelPriority: 'low',
        radius: 0,
      };
    });

    // Calculate degrees and neighbors
    const allLinks: ViewLink[] = [...hierarchyLinks, ...relationLinks];
    allLinks.forEach(link => {
      const a = gNodes.find(n => n.id === link.source);
      const b = gNodes.find(n => n.id === link.target);
      if (a && b) {
        a.neighbors.push(b.id);
        b.neighbors.push(a.id);
        a.links.push(link.id);
        b.links.push(link.id);
        a.val += link.kind === 'relation' ? 0.45 * link.score : 1;
        b.val += link.kind === 'relation' ? 0.45 * link.score : 1;
        if (link.kind === 'relation') {
          a.relationCount += 1;
          b.relationCount += 1;
        }
      }
    });

    gNodes.forEach(node => {
      node.labelPriority =
        node.depth === 0 || node.overdueCount > 0 || node.totalReviewCount >= 4
          ? 'high'
          : node.relationCount > 0 || node.pendingCount > 0 || node.depth === 1
            ? 'medium'
            : 'low';
      node.radius = Math.max(
        2.4,
        Math.min(
          node.depth === 0 ? 9.5 : 7.5,
          3 + node.importanceScore * 0.18 + node.relationCount * 0.4 - node.depth * 0.35,
        ),
      );
    });

    return { nodes: gNodes, links: allLinks };
  }, [nodes, getNodeColorHex, getDescendants, reviewTasks]);

  useEffect(() => {
    if (fgRef.current) {
      // “多学科小型同心圆”力场：每个根学科一套局部星系，层级按轨道展开
      
      // 预先计算有多少个不同的根节点，并给它们分配不同的中心 x 坐标
      const rootNodes = graphData.nodes.filter((n: any) => n.depth === 0);
      rootNodes.sort((a: any, b: any) => a.id.localeCompare(b.id)); // 保持顺序稳定
      const numRoots = rootNodes.length || 1;
      const rootIndexMap = new Map<string, number>();
      rootNodes.forEach((n: any, i: number) => rootIndexMap.set(n.id, i));

      // 计算每个根学科星系需要的半径大小
      const rootRadii = new Map<string, number>();
      graphData.nodes.forEach((node: any) => {
        const rId = node.rootId || node.id;
        const currentMax = rootRadii.get(rId) || 0;
        rootRadii.set(rId, Math.max(currentMax, (node.depth || 0) * 112 + 60)); // 给外圈留出 60px 边距
      });

      // 动态计算同心圆之间的间隔，避免固定 320 导致太空旷或太拥挤
      let totalWidth = 0;
      const rootCenters = new Map<string, number>();
      
      // 遍历所有根节点，计算它们连续排列时的总宽度
      rootNodes.forEach((root: any, i: number) => {
        const radius = rootRadii.get(root.id) || 100;
        // 如果是第一个节点，中心点就是它自己的半径
        // 如果是后续节点，中心点 = 上一个节点的中心点 + 上一个节点的半径 + 当前节点的半径 + 最小间距
        if (i === 0) {
          rootCenters.set(root.id, radius);
          totalWidth = radius * 2;
        } else {
          const prevRoot = rootNodes[i - 1];
          const prevCenter = rootCenters.get(prevRoot.id)!;
          const prevRadius = rootRadii.get(prevRoot.id) || 100;
          const minGap = 40; // 两个同心圆边缘之间的最小间距
          
          const currentCenter = prevCenter + prevRadius + minGap + radius;
          rootCenters.set(root.id, currentCenter);
          totalWidth = currentCenter + radius;
        }
      });

      const centerY = dimensions.height / 2;
      // 整体居中偏移量
      const offsetX = (dimensions.width - totalWidth) / 2;

      // 构建局部的父子关系映射，用于按子树分配角度，彻底避免同心圆连线交叉
      const localChildrenMap = new Map<string, any[]>();
      const nodeById = new Map<string, any>();
      graphData.nodes.forEach((node: any) => nodeById.set(node.id, node));

      graphData.links.forEach((link: any) => {
        if (link.kind === 'hierarchy') {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          const childNode = nodeById.get(targetId);
          if (childNode) {
            const bucket = localChildrenMap.get(sourceId) ?? [];
            bucket.push(childNode);
            localChildrenMap.set(sourceId, bucket);
          }
        }
      });

      // 扇形角度分配（Sunburst/树状展开），确保不同分支的节点占据不同角度，物理上隔离连线
      // 但这里只用来分配初始位置，不作为物理约束锚点！
      rootNodes.forEach((root: any) => {
        const localCenterX = offsetX + (rootCenters.get(root.id) || 0);
        
        root.x = localCenterX;
        root.y = centerY;

        // BFS 分配扇区，初始给根节点整个圆 [-PI/2, 1.5*PI]
        const queue = [{ node: root, startAngle: -Math.PI / 2, endAngle: 1.5 * Math.PI }];
        
        while (queue.length > 0) {
          const { node, startAngle, endAngle } = queue.shift()!;
          const children = localChildrenMap.get(node.id) ?? [];
          
          if (children.length > 0) {
            // 排序：重要节点优先
            children.sort((a, b) => {
              if (b.importanceScore !== a.importanceScore) return b.importanceScore - a.importanceScore;
              return String(a.name).localeCompare(String(b.name), 'zh-CN');
            });
            
            // 按子树的叶子节点数量作为权重分配扇区，确保叶子多的分支获得更大角度
            const totalWeight = children.reduce((sum, child) => sum + Math.max(1, child.totalLeafCount), 0);
            
            let currentAngle = startAngle;
            children.forEach(child => {
              const weight = Math.max(1, child.totalLeafCount);
              const slice = (weight / totalWeight) * (endAngle - startAngle);
              const childStart = currentAngle;
              const childEnd = currentAngle + slice;
              const midAngle = currentAngle + slice / 2;
              
              const radius = child.depth * 120;
              child.x = localCenterX + Math.cos(midAngle) * radius;
              child.y = centerY + Math.sin(midAngle) * radius;
              
              queue.push({ node: child, startAngle: childStart, endAngle: childEnd });
              currentAngle += slice;
            });
          }
        }
      });
      
      // 1. 控制排斥：适当增加排斥力，让节点在同心圆轨道上能自然散开
      fgRef.current.d3Force('charge').strength(-180).distanceMax(300);
      
      // 2. 结构边强约束，关系边极弱牵引
      fgRef.current.d3Force('link')
        .distance((link: any) => {
          if (link.kind === 'relation') return 150;
          const depth = link.target.depth || 1;
          return Math.max(50, 110 - depth * 12); 
        })
        .strength((link: any) => link.kind === 'relation' ? 0.05 : 1.2); 

      // 3. 径向力负责层级轨道，强度适中，不要压得太死
      fgRef.current.d3Force('radial', forceRadial(
        (node: any) => {
          const depth = node.depth || 0;
          return depth * 120; 
        },
        (node: any) => {
          const rId = node.rootId || node.id;
          return offsetX + (rootCenters.get(rId) || 0);
        }, 
        centerY
      ).strength(0.6));

      // 4. X/Y 轨道锚点：不再写死绝对坐标！只给一个极弱的倾向，让它们能被拉开
      fgRef.current.d3Force('orbit-x', null);
      fgRef.current.d3Force('orbit-y', null);

      // 5. 取消全局中心力，避免所有学科被吸成一坨
      fgRef.current.d3Force('center', null);
      
      // 6. 碰撞保护：标签与节点之间保留呼吸感
      fgRef.current.d3Force('collide', forceCollide().radius((node: any) => {
        const baseR = node.radius ?? Math.max(3, Math.min(10, Math.sqrt(node.val || 1) * 2.5));
        let padding = node.depth === 0 ? 34 : (node.depth === 1 ? 24 : 14);
        if (node.labelPriority === 'high') padding += 8;
        if (node.relationCount > 0) padding += Math.min(8, node.relationCount * 2);
        if (node.name && node.name.length > 6) {
          padding += (node.name.length - 6) * 2.5;
        }

        return baseR + padding; 
      }).iterations(3));
    }
  }, [dimensions, graphData]);

  // 5. 自动缩放自适应 (Zoom to Fit)
  // 当数据变化导致物理引擎重新计算后，稍微延迟一下让引擎稳定，然后缩放视口
  useEffect(() => {
    if (fgRef.current && nodes.length > 0) {
      const timer = setTimeout(() => {
        fgRef.current.zoomToFit(400, 50); // 400ms动画，50px内边距
      }, 800); // 等待物理引擎初步稳定
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

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
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-blue-600/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all duration-300 pointer-events-none z-20 flex items-center gap-2 animate-in slide-in-from-top-4 fade-in">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          快捷连线：点击任意高亮节点，将其设为 "{selectedNode?.name}" 的子节点
        </div>
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
              const isDimmed = hoverNode !== null && !highlightLinks.has(link.id);
              if (isDimmed) return '#f8fafc';
              if (link.kind === 'relation') {
                return highlightLinks.has(link.id) ? 'rgba(59, 130, 246, 0.55)' : 'rgba(148, 163, 184, 0.32)';
              }
              return highlightLinks.has(link.id) ? '#64748b' : '#dbe4ee';
            }}
            linkWidth={(link: any) => {
              if (link.kind === 'relation') return highlightLinks.has(link.id) ? 1.8 : 0.9;
              return highlightLinks.has(link.id) ? 2.4 : 1.15;
            }}
            linkDirectionalParticles={(link: any) => link.kind === 'hierarchy' && highlightLinks.has(link.id) ? 2 : 0}
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
            onBackgroundClick={() => setSelectedNodeId(null)}
            onNodeHover={handleNodeHover}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const isSelected = node.id === selectedNodeId;
              const isHovered = node.id === hoverNode;
              const isHighlighted = highlightNodes.has(node.id);
              const isDimmed = hoverNode !== null && !isHighlighted;
              const canBeAbsorbed = isAltPressed && selectedNodeId && isHovered && !isSelected && !wouldCreateCycle(selectedNodeId, node.id);

              const label = node.name;
              
              // === Obsidian 风格的文字缩放逻辑 ===
              const priorityBoost = node.labelPriority === 'high' ? 1.2 : node.labelPriority === 'medium' ? 0.5 : 0;
              const rawFontSize = (11.5 + priorityBoost) / globalScale;
              const fontSize = Math.min(15, Math.max(3, rawFontSize));

              ctx.font = `${isSelected || isHovered ? '600' : '400'} ${fontSize}px Inter, system-ui, sans-serif`;

              const r = node.radius ?? Math.max(2.4, Math.min(6, node.val));
              const haloRadius = r + 3.5 / globalScale;

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
              ctx.fillStyle = isDimmed ? '#f8fafc' : node.color;
              ctx.fill();

              if (canBeAbsorbed) {
                ctx.lineWidth = 3 / globalScale;
                ctx.strokeStyle = '#10b981'; // emerald-500
                ctx.setLineDash([4 / globalScale, 4 / globalScale]);
                ctx.stroke();
                ctx.setLineDash([]);
              } else if (isSelected) {
                ctx.lineWidth = 1.5 / globalScale;
                ctx.strokeStyle = '#3b82f6';
                ctx.stroke();
                
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 2.5/globalScale, 0, 2 * Math.PI, false);
                ctx.lineWidth = 0.5 / globalScale;
                ctx.strokeStyle = '#93c5fd';
                ctx.stroke();
              } else if (isHovered || isHighlighted) {
                ctx.lineWidth = 1 / globalScale;
                ctx.strokeStyle = '#64748b';
                ctx.stroke();
              }

              // Show text if scale is sufficient, or if highlighted/selected
              const scaleThreshold = node.labelPriority === 'high' ? 0.42 : node.labelPriority === 'medium' ? 0.68 : 0.92;
              const showText = globalScale > scaleThreshold || isHighlighted || isSelected || isHovered;
              
              if (showText && !isDimmed) {
                const padding = globalScale < 1 ? fontSize * 1.2 : fontSize * 0.8;
                const textY = node.y + r + padding;
                
                // === 绘制进度比例标签 ===
                let displayLabel = label;
                let progressText = '';
                
                // 如果不是叶子节点，并且有叶子节点，则显示进度 (激活数/总数)
                if (!node.isLeaf && node.totalLeafCount > 0) {
                  progressText = ` (${node.activeCount}/${node.totalLeafCount})`;
                  displayLabel += progressText;
                }
                
                const textWidth = ctx.measureText(displayLabel).width;
                const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4);
                
                const shouldDrawBg = isSelected || isHovered || isHighlighted || node.labelPriority === 'high';
                
                if (shouldDrawBg) {
                  ctx.fillStyle = isSelected
                    ? 'rgba(255, 255, 255, 0.95)'
                    : node.labelPriority === 'high'
                      ? 'rgba(255, 255, 255, 0.82)'
                      : 'rgba(255, 255, 255, 0.68)';
                  ctx.fillRect(node.x - bckgDimensions[0] / 2, textY - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                }

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                ctx.fillStyle = isSelected
                  ? '#0f172a'
                  : isHovered || isHighlighted || node.labelPriority === 'high'
                    ? '#334155'
                    : '#64748b';
                
                if (progressText) {
                  // 如果有进度文本，分两段绘制以实现不同的颜色/样式
                  const labelWidth = ctx.measureText(label).width;
                  const progressWidth = ctx.measureText(progressText).width;
                  const startX = node.x - (labelWidth + progressWidth) / 2;
                  
                  ctx.textAlign = 'left';
                  ctx.fillText(label, startX, textY);
                  
                  // 绘制进度文本，使用较浅的颜色和稍小的字体
                  ctx.fillStyle = isSelected ? '#64748b' : '#94a3b8';
                  ctx.font = `${isSelected || isHovered ? '500' : '400'} ${fontSize * 0.9}px Inter, system-ui, sans-serif`;
                  ctx.fillText(progressText, startX + labelWidth, textY);
                } else {
                  ctx.fillText(label, node.x, textY);
                }
              }
            }}
            nodeCanvasObjectMode={() => 'replace'}
          />
        )}

        {/* Floating Control Panel */}
        {isPanelOpen ? (
          <div className="absolute top-6 left-6 bg-white/90 backdrop-blur-xl p-4 rounded-xl shadow-2xl border border-white/50 w-[280px] max-h-[90vh] overflow-y-auto z-10 transition-all duration-300 custom-scrollbar">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100/80 sticky top-0 bg-white/90 backdrop-blur-xl z-10 -mx-4 px-4 -mt-4 pt-4">
              <h3 className="font-bold text-gray-800 tracking-wide text-sm">控制台</h3>
              <button onClick={() => setIsPanelOpen(false)} className="text-gray-400 hover:text-gray-700 bg-gray-50/50 hover:bg-gray-100 p-1.5 rounded-full transition-all" title="收起"><X size={14} /></button>
            </div>
            
            <div className="mb-4 pb-4 border-b border-gray-100/80">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">智能录入</h3>
                <span className="text-[9px] font-medium text-gray-400 bg-gray-100/80 px-1.5 py-0.5 rounded-md">支持 MARKDOWN</span>
              </div>
              <div className="flex flex-col">
                <textarea
                  rows={2}
                  placeholder="输入节点名称 (换行批量添加)&#10;# 支持 Markdown 层级"
                  className="w-full box-border bg-gray-50 focus:bg-white border border-gray-200 rounded-md p-2.5 text-xs text-gray-700 leading-normal placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-none"
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
                  className="w-full mt-2 py-1.5 rounded-md text-xs border-none outline-none bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-all flex justify-center items-center gap-1.5"
                >
                  <Plus size={14} />
                  <span>生成图谱节点</span>
                </button>
              </div>
            </div>

            {selectedNode ? (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  当前选中
                </h3>
                {selectedGraphNode && (
                  <div className="mb-4 rounded-xl border border-slate-200/80 bg-slate-50/90 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">学习快照</span>
                      <span className="text-[10px] text-slate-400">
                        {selectedGraphNode.labelPriority === 'high' ? '核心节点' : selectedGraphNode.labelPriority === 'medium' ? '活跃节点' : '普通节点'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-white px-2.5 py-2 border border-slate-200/70">
                        <div className="text-slate-400">待复习</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800">{selectedGraphNode.pendingCount}</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 border border-slate-200/70">
                        <div className="text-slate-400">逾期压力</div>
                        <div className="mt-1 text-sm font-semibold text-rose-600">{selectedGraphNode.overdueCount}</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 border border-slate-200/70">
                        <div className="text-slate-400">已完成</div>
                        <div className="mt-1 text-sm font-semibold text-emerald-600">{selectedGraphNode.completedCount}</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 border border-slate-200/70">
                        <div className="text-slate-400">弱连接</div>
                        <div className="mt-1 text-sm font-semibold text-sky-600">{selectedGraphNode.relationCount}</div>
                      </div>
                    </div>
                    {selectedNodeReviewPreview.length > 0 && (
                      <div className="mt-3 border-t border-slate-200/80 pt-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">近期复习</div>
                        <div className="space-y-1.5">
                          {selectedNodeReviewPreview.map(task => (
                            <div key={task.id} className="rounded-lg bg-white px-2.5 py-2 border border-slate-200/70">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[11px] font-medium text-slate-700">{task.topicName}</span>
                                <span className={`shrink-0 text-[10px] ${task.isCompleted ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {task.isCompleted ? '已完成' : task.dueDate}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 mb-6">
                  <input
                    className="flex-1 bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 font-medium focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all shadow-inner"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && editName.trim()) {
                        updateNode(selectedNode.id, { name: editName.trim() });
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (editName.trim()) updateNode(selectedNode.id, { name: editName.trim() });
                    }}
                    className="text-white bg-emerald-500 hover:bg-emerald-600 p-3 rounded-xl shadow-sm hover:shadow-md transition-all flex-shrink-0"
                    title="保存名称"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => {
                      if(confirm('确定删除该节点吗？子节点将会挂载到父节点下。')) {
                        deleteNode(selectedNode.id);
                        setSelectedNodeId(null);
                      }
                    }}
                    className="text-white bg-red-500 hover:bg-red-600 p-3 rounded-xl shadow-sm hover:shadow-md transition-all flex-shrink-0"
                    title="删除节点"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">批量添加子节点</h3>
                  <span className="text-[9px] font-medium text-gray-400 bg-gray-100/80 px-1.5 py-0.5 rounded-md">支持 MARKDOWN</span>
                </div>
                <div className="flex flex-col mb-4">
                  <textarea
                    rows={2}
                    placeholder="输入子节点 (换行批量添加)&#10;# 支持 Markdown 层级"
                    className="w-full box-border bg-gray-50 focus:bg-white border border-gray-200 rounded-md p-2.5 text-xs text-gray-700 leading-normal placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all resize-none"
                    value={newChildName}
                    onChange={e => setNewChildName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey && newChildName.trim()) {
                        e.preventDefault();
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
                    className="w-full mt-2 py-1.5 rounded-md text-xs border-none outline-none bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow-sm transition-all flex justify-center items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>添加至当前节点</span>
                  </button>
                </div>

                {/* Scheme B: Batch Absorb Existing Nodes */}
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 mt-6">批量吸纳已有节点</h3>
                <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto p-1 -mx-1 custom-scrollbar">
                  {availableNodesToAbsorb.length > 0 ? availableNodesToAbsorb.map(n => (
                    <button
                      key={n.id}
                      onClick={() => updateNode(n.id, { parentId: selectedNode.id })}
                      className="bg-white border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shadow-sm hover:shadow"
                      title={`将 "${n.name}" 设为子节点`}
                    >
                      <Plus size={14} />
                      {n.name}
                    </button>
                  )) : (
                    <span className="text-xs text-gray-400 px-1">暂无可吸纳的节点</span>
                  )}
                </div>

                <div className="mt-6 bg-blue-50 rounded-xl p-4 flex items-start gap-3">
                  <div className="text-blue-500 mt-0.5"><Info size={16} /></div>
                  <p className="text-xs text-blue-800 leading-relaxed">
                    <strong>画布连线</strong>：按住 <kbd className="bg-white border border-blue-200 text-blue-600 rounded px-1.5 py-0.5 text-[10px] font-mono shadow-sm mx-0.5">Alt</kbd> 键并在右侧图谱中点击其他节点，可直接将其吸纳为当前节点的子节点。
                  </p>
                </div>

              </div>
            ) : (
              <div className="bg-blue-50 rounded-xl p-5 flex flex-col items-center justify-center text-center border border-blue-100/50">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 text-blue-500">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                </div>
                <h4 className="text-blue-900 font-medium mb-1.5 text-sm">选择节点以编辑</h4>
                <p className="text-blue-700/80 text-xs leading-relaxed">
                  在右侧图谱中点击任意节点<br/>
                  即可编辑属性或添加子节点
                </p>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={() => setIsPanelOpen(true)}
            className="absolute top-6 left-6 bg-white p-3 rounded-full shadow-lg border border-gray-100 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-all z-10"
            title="打开节点控制台"
          >
            <Settings2 size={22} />
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
