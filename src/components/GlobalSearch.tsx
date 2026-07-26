import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Archive, X, CalendarClock, BrainCircuit } from 'lucide-react';
import { useGraphStore } from '@/graph/store';
import { useTimelineStore } from '@/store';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getValidGraphNodeIds } from '@/utils/blocks';
import { requestConfirmation } from '@/services/confirmation';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useEbbStore } from '@/ebb/store';
import NodeRetrospectiveRecords from '@/graph/components/NodeRetrospectiveRecords';
import { isRetrospectiveEntryCurrentlyCompleted } from '@/domain/dailyRetrospective';

// 时光胶囊模态框：展示归档节点的内容
export const TimeCapsuleModal = ({ nodeId, onClose }: { nodeId: string; onClose: () => void }) => {
  const { nodes, archiveNodeCascade } = useGraphStore();
  const { tasks: tlTasks, groups } = useTimelineStore();
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const { retrospectives, schedules } = useDailyScheduleStore();
  const retrospectiveEntries = useMemo(
    () => Object.values(retrospectives)
      .filter((retrospective) => retrospective.status === 'completed')
      .flatMap((retrospective) => retrospective.entries)
      .filter((entry) => (entry.nodeIds ?? []).includes(nodeId))
      .map((entry) => ({
        ...entry,
        completionStatusChanged: !isRetrospectiveEntryCurrentlyCompleted(
          entry,
          tlTasks,
          groups,
          reviewTasks,
          schedules,
        ),
      })),
    [groups, nodeId, retrospectives, reviewTasks, schedules, tlTasks],
  );
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;
  
  // 提取智能块中的备注
  const relatedBlocks = tlTasks.flatMap(t =>
    (t.blocks || []).filter((b): b is import('@/types').SmartTaskBlock => {
      if (b.type !== 'smart-task') return false;
      const ids = getValidGraphNodeIds(b.header);
      return ids.includes(nodeId);
    })
  );

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl bg-white/90 backdrop-blur-xl border border-white/50 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="shrink-0 px-6 py-5 border-b border-slate-200/50 flex items-center justify-between bg-white/50">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-500 rounded-xl shadow-sm border border-blue-100/50">
                <Archive size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  {node.name}
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] uppercase font-bold tracking-widest">
                    Time Capsule
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  已归档于 {new Date(node.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (await requestConfirmation('确定解冻该节点及其附属的所有节点吗？它们将重新回到图谱主视区。')) {
                    archiveNodeCascade(node.id, false);
                    onClose();
                  }
                }}
                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5"
              >
                <BrainCircuit size={16} />
                解冻恢复
              </button>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
            {relatedBlocks.length > 0 || retrospectiveEntries.length > 0 ? (
              <div className="space-y-6">
                {/* 历史任务块 */}
                {relatedBlocks.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
                      <CalendarClock size={14} />
                      历史任务
                    </h3>
                    <div className="grid gap-2">
                      {relatedBlocks.map((block, idx) => (
                        <div key={block.id || idx} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex items-start gap-3 group hover:border-blue-100 transition-colors">
                          <div className="mt-0.5">
                            {block.type === 'smart-task' && block.header.isCompleted ? (
                              <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold">
                                ✓
                              </div>
                            ) : (
                              <div className="w-4 h-4 rounded-full border-2 border-slate-200" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-4 mb-1">
                              <span className="font-medium text-slate-700 text-sm truncate">
                                {block.type === 'smart-task' ? block.header.title : '文本块'}
                              </span>
                              {block.type === 'smart-task' && block.header.completedDate && (
                                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                  {block.header.completedDate}
                                </span>
                              )}
                            </div>
                            {block.type === 'smart-task' && block.body && (
                              <div className="text-xs text-slate-500 line-clamp-2 leading-relaxed bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-100/50">
                                {block.body.replace(/<[^>]*>?/gm, '')}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {retrospectiveEntries.length > 0 && (
                  <NodeRetrospectiveRecords entries={retrospectiveEntries} />
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <Archive size={48} className="mx-auto mb-4 opacity-20" />
                <p>该节点下没有留下笔记或错题记录</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
};

export const GlobalSearchModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { nodes } = useGraphStore();
  const [query, setQuery] = useState('');
  const [capsuleNodeId, setCapsuleNodeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    return nodes.filter(n => n.name.toLowerCase().includes(lowerQuery));
  }, [query, nodes]);

  if (!isOpen && !capsuleNodeId) return null;

  return (
    <>
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex items-start justify-center pt-[15vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative w-full max-w-xl bg-white shadow-2xl rounded-2xl overflow-hidden border border-slate-200"
          >
            <div className="flex items-center px-4 py-3 border-b border-slate-100">
              <Search className="text-slate-400 shrink-0" size={20} />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent border-none outline-none px-3 py-1 text-base text-slate-800 placeholder:text-slate-400"
                placeholder="搜索全库知识点、归档节点..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') onClose();
                }}
              />
              <div className="shrink-0 flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                <kbd className="font-sans font-medium">ESC</kbd> 退出
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {results.length > 0 ? (
                <div className="p-2 space-y-1">
                  {results.map(node => (
                    <button
                      key={node.id}
                      onClick={() => {
                        if (node.isArchived) {
                          setCapsuleNodeId(node.id);
                          onClose();
                        } else {
                          // 跳转到大盘（简单处理：这里仅做搜索，如非归档节点，可提示或扩展路由）
                          onClose();
                        }
                      }}
                      className="w-full text-left flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 rounded-xl transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-lg ${node.isArchived ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-500'}`}>
                          {node.isArchived ? <Archive size={16} /> : <BrainCircuit size={16} />}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-700">{node.name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {node.isArchived ? '已归档 · 点击打开时光胶囊' : '知识大盘节点'}
                          </div>
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 text-slate-400 transition-opacity">
                        {node.isArchived ? '打开' : '查看'}
                      </div>
                    </button>
                  ))}
                </div>
              ) : query.trim() ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  没有找到匹配的知识点
                </div>
              ) : null}
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {capsuleNodeId && (
        <TimeCapsuleModal nodeId={capsuleNodeId} onClose={() => setCapsuleNodeId(null)} />
      )}
    </>
  );
};

export const ArchiveLibraryModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { nodes } = useGraphStore();
  const [capsuleNodeId, setCapsuleNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const { archivedRoots, archivedNodes } = useMemo(() => {
    const archived = nodes.filter(n => n.isArchived);
    const archivedIds = new Set(archived.map(n => n.id));
    return {
      archivedNodes: archived,
      // 如果父节点也被归档了，就不作为根显示在库里（被折叠在里面）
      archivedRoots: archived.filter(n => !n.parentId || !archivedIds.has(n.parentId)),
    };
  }, [nodes]);

  const displayedNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return archivedRoots;
    return archivedNodes.filter((node) => node.name.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [archivedNodes, archivedRoots, query]);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  if (!isOpen && !capsuleNodeId) return null;

  return (
    <>
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl bg-white/90 backdrop-blur-xl border border-white/50 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="shrink-0 px-6 py-5 border-b border-slate-200/50 flex items-center justify-between bg-white/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-100 text-slate-500 rounded-xl shadow-sm border border-slate-200/50">
                  <Archive size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">归档库 (Archive Library)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">这里存放着你曾经征服过的知识与岁月</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-colors" aria-label="关闭归档库">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              <label className="max-w-4xl mx-auto mb-4 h-10 px-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
                <Search size={16} className="text-slate-400 shrink-0" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索已归档的知识节点……"
                  aria-label="搜索归档知识节点"
                  className="min-w-0 flex-1 border-0 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
                  autoFocus
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="p-1 text-slate-400 hover:text-slate-600" aria-label="清除归档搜索">
                    <X size={14} />
                  </button>
                )}
              </label>

              {displayedNodes.length > 0 ? (
                <div className="flex flex-col gap-1 max-w-4xl mx-auto w-full">
                  <div className="flex items-center px-4 py-2 text-xs font-semibold text-slate-400 border-b border-slate-200/60 mb-2">
                    <div className="flex-1">节点名称</div>
                    <div className="w-32 text-right">创建日期</div>
                    <div className="w-24"></div>
                  </div>
                  
                  {displayedNodes.map(node => (
                    <button
                      key={node.id}
                      onClick={() => setCapsuleNodeId(node.id)}
                      className="w-full flex items-center px-4 py-3 bg-transparent hover:bg-white rounded-xl border border-transparent hover:border-slate-200/60 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-center gap-3 flex-1 overflow-hidden">
                        <div className="p-1.5 bg-slate-200/50 text-slate-500 rounded-md group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors shrink-0">
                          <Archive size={14} />
                        </div>
                        <span className="font-medium text-slate-700 group-hover:text-blue-700 truncate text-sm">
                          {node.name}
                        </span>
                      </div>
                      
                      <div className="w-32 text-right text-xs text-slate-400 font-medium font-mono shrink-0">
                        {new Date(node.createdAt).toLocaleDateString()}
                      </div>
                      
                      <div className="w-24 flex justify-end shrink-0 pl-4">
                        <span className="opacity-0 group-hover:opacity-100 text-xs font-bold text-blue-500 transition-opacity">
                          开启胶囊 &rarr;
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-400">
                  <Archive size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium">{query.trim() ? '没有找到匹配的归档节点' : '归档库空空如也'}</p>
                  <p className="text-xs mt-1 opacity-70">{query.trim() ? '可以尝试其他关键词' : '在知识大盘中归档的节点会出现在这里'}</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {capsuleNodeId && (
        <TimeCapsuleModal nodeId={capsuleNodeId} onClose={() => setCapsuleNodeId(null)} />
      )}
    </>
  );
};
