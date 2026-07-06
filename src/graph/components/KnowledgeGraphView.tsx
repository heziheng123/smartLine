/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store';
import { useEbbStore } from '@/ebb/store';
import { diffDays, todayStr } from '@/utils/dateSafe';
import { Plus, Trash2, Check, Settings2, X, Info } from 'lucide-react';
import { forceCollide, forceRadial } from 'd3-force';
import ForceGraph2D from 'react-force-graph-2d';

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
    // 1. First pass: build basic nodes map and calculate depth
    const nodeDepthMap = new Map<string, number>();
    const getDepth = (nodeId: string, currentPath = new Set<string>()): number => {
      if (currentPath.has(nodeId)) return 0; // Prevent cycle infinite loop
      const node = nodes.find(n => n.id === nodeId);
      if (!node || !node.parentId) return 0; // Root node is depth 0
      
      if (nodeDepthMap.has(nodeId)) return nodeDepthMap.get(nodeId)!;
      
      currentPath.add(nodeId);
      const depth = getDepth(node.parentId, currentPath) + 1;
      currentPath.delete(nodeId);
      
      nodeDepthMap.set(nodeId, depth);
      return depth;
    };

    nodes.forEach(n => {
      if (!nodeDepthMap.has(n.id)) {
        nodeDepthMap.set(n.id, getDepth(n.id));
      }
    });

    const gNodes = nodes.map(n => {
      const descendants = getDescendants(n.id);
      const isLeaf = descendants.length === 0;
      let activeCount = 0;
      let totalLeafCount = 0;

      if (!isLeaf) {
        const leafIds = descendants.filter(id => !nodes.some(child => child.parentId === id));
        totalLeafCount = leafIds.length;
        activeCount = leafIds.filter(leafId => {
          const leafTasks = reviewTasks.filter(t => t.graphNodeId === leafId);
          // 只要有关联任务，就算激活
          return leafTasks.length > 0;
        }).length;
      }

      return {
        id: n.id,
        name: n.name,
        color: getNodeColorHex(n.id),
        val: 1, // Degree weight
        depth: nodeDepthMap.get(n.id) || 0, // Inject depth into node data
        isLeaf,
        activeCount,
        totalLeafCount,
        neighbors: [] as string[],
        links: [] as string[]
      };
    });

    const gLinks = nodes
      .filter(n => n.parentId)
      .map(n => ({
        id: `${n.parentId}-${n.id}`,
        source: n.parentId,
        target: n.id
      }));

    // Calculate degrees and neighbors
    gLinks.forEach(link => {
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

    return { nodes: gNodes, links: gLinks };
  }, [nodes, getNodeColorHex, getDescendants, reviewTasks]);

  useEffect(() => {
    if (fgRef.current) {
      // "径向树（Radial Tree）秩序力场"模型
      
      // 1. 削弱全局无方向排斥，改为带有定向分离的温和排斥
      // 降低距离上限，不让节点之间排斥得太远
      fgRef.current.d3Force('charge').strength(-150).distanceMax(250);
      
      // 2. 增强连线刚度（Link Rigidity）：让子节点死死绑在父节点身边，不乱跑
      fgRef.current.d3Force('link')
        .distance((link: any) => {
          // 为了给文字留空间，把原先缩短的连线长度重新拉长
          const depth = link.target.depth || 1;
          return Math.max(40, 90 - depth * 10); 
        })
        .strength(1.2); 
      
      // 3. 引入径向力（Radial Force）：按辈分排座位
      fgRef.current.d3Force('radial', forceRadial(
        (node: any) => {
          const depth = node.depth || 0;
          // 轨道间距也同步拉长，避免内圈的文字盖住外圈的圆圈
          return depth * 120; 
        },
        dimensions.width / 2, 
        dimensions.height / 2
      ).strength(0.8));

      // 4. 彻底取消原来的全局黑洞中心力，因为它会把所有人拉回圆心，破坏径向轨道
      fgRef.current.d3Force('center', null);
      
      // 5. 增强碰撞检测：现在不仅考虑圆圈大小，还要为文字留出额外的防重叠空间
      // 这里的 padding 在原先的基础上加大，作为文字的“保护罩”
      fgRef.current.d3Force('collide', forceCollide().radius((node: any) => {
        const baseR = Math.max(3, Math.min(10, Math.sqrt(node.val || 1) * 2.5));
        
        // 根节点（层级0）保护罩极大，一级子节点中等，深层节点稍微紧凑
        // 我们给它额外的 10px-20px 的横向/纵向保护区，防止文字打架
        let padding = node.depth === 0 ? 35 : (node.depth === 1 ? 25 : 15);
        
        // 如果名字特别长，给它更大的保护区
        if (node.name && node.name.length > 6) {
           padding += (node.name.length - 6) * 3;
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
              return isDimmed ? '#f1f5f9' : (highlightLinks.has(link.id) ? '#94a3b8' : '#cbd5e1');
            }}
            linkWidth={(link: any) => highlightLinks.has(link.id) ? 2 : 1}
            linkDirectionalParticles={(link: any) => highlightLinks.has(link.id) ? 3 : 0}
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
              // 根据当前缩放比例，计算文字大小，最小不低于 3px，最大不高于 14px
              // 这样在极度缩小时，文字不会变成巨大的色块互相遮挡
              const rawFontSize = 12 / globalScale;
              const fontSize = Math.min(14, Math.max(3, rawFontSize));

              ctx.font = `${isSelected || isHovered ? '600' : '400'} ${fontSize}px Inter, system-ui, sans-serif`;
              
              const textWidth = ctx.measureText(label).width;
              const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4);
              
              // 1. 缩小基础半径 (Base Radius)：将原本过大的圆缩小
              // 以前可能是 Math.min(8, ...)，现在改为 Math.min(5, node.val)
              const baseR = Math.max(3, Math.min(5, node.val)); 
              // 2. 根据层级稍微调整大小，层级越深越小
              const r = Math.max(2, baseR - (node.depth || 0) * 0.5);
              
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
              // 引入 Obsidian 的 Text fade threshold 概念：缩放太小（< 0.8）时，不显示非关键节点的文字
              const isScaleSufficient = globalScale > 0.8;
              const showText = isScaleSufficient || isHighlighted || isSelected;
              
              if (showText && !isDimmed) {
                // 如果缩放很小，文字位置稍微拉远一点，避免压住圆点
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
                
                // 只有被选中或 hover 时，才显示纯白实底，平时用半透明毛玻璃底，甚至不画底（让视觉更轻）
                const shouldDrawBg = isSelected || isHovered || isHighlighted;
                
                if (shouldDrawBg) {
                  ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)';
                  // 使用圆角矩形会让标签看起来更精致，但为了性能这里先用 fillRect
                  ctx.fillRect(node.x - bckgDimensions[0] / 2, textY - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                }

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // 颜色分级：选中的最深，其他的变浅，未高亮的更浅
                ctx.fillStyle = isSelected ? '#0f172a' : (isHovered || isHighlighted ? '#334155' : '#64748b');
                
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
