import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Archive, X, CalendarClock, BrainCircuit, FileText } from 'lucide-react';
import { useGraphStore } from '@/graph/store';
import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// 时光胶囊模态框：展示归档节点的内容
export const TimeCapsuleModal = ({ nodeId, onClose }: { nodeId: string; onClose: () => void }) => {
  const { nodes, archiveNodeCascade } = useGraphStore();
  const { reviewTasks: allEbbTasks } = useEbbStore();
  const { tasks: tlTasks } = useTimelineStore();
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  // 获取该节点下所有的复习笔记和错题
  const relatedTasks = allEbbTasks.filter(t => t.graphNodeId === nodeId);
  
  // 提取智能块中的笔记
  const relatedBlocks = tlTasks.flatMap(t => 
    (t.blocks || []).filter(b => b.type === 'smart-task' && b.header.graphNodeId === nodeId)
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
                onClick={() => {
                  if (confirm('确定解冻该节点及其附属的所有节点吗？它们将重新回到图谱主视区。')) {
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
          <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
            {relatedTasks.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <CalendarClock size={16} />
                  复习轨迹
                </h3>
                <div className="grid gap-3">
                  {relatedTasks.map(task => (
                    <div key={task.id} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-slate-700">{task.topicName}</div>
                        <div className="text-xs text-slate-400">{task.completedDate || task.dueDate}</div>
                      </div>
                      {task.accumulatedNotes && task.accumulatedNotes.length > 0 && (
                        <div className="mt-3 space-y-2 pl-3 border-l-2 border-slate-100">
                          {task.accumulatedNotes.map((noteStr, idx) => {
                            try {
                              const note = JSON.parse(noteStr);
                              return (
                                <div key={idx} className="text-sm text-slate-600">
                                  <span className="text-xs font-medium text-slate-400 mr-2">{note.date}</span>
                                  {note.notes || note.title}
                                </div>
                              );
                            } catch {
                              return <div key={idx} className="text-sm text-slate-600">{noteStr}</div>;
                            }
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relatedBlocks.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={16} />
                  关联笔记
                </h3>
                <div className="grid gap-3">
                  {relatedBlocks.map((b: import('@/types').SmartTaskBlock) => (
                    <div key={b.id} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                      <div className="font-semibold text-slate-700 mb-2">{b.header.title}</div>
                      {b.header.taskNotes && (
                        <div className="text-sm text-slate-600 whitespace-pre-wrap">
                          {b.header.taskNotes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relatedTasks.length === 0 && relatedBlocks.length === 0 && (
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

  const archivedRoots = useMemo(() => {
    const archived = nodes.filter(n => n.isArchived);
    const archivedIds = new Set(archived.map(n => n.id));
    // 如果父节点也被归档了，就不作为根显示在库里（被折叠在里面）
    return archived.filter(n => !n.parentId || !archivedIds.has(n.parentId));
  }, [nodes]);

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
              <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              {archivedRoots.length > 0 ? (
                <div className="flex flex-col gap-1 max-w-4xl mx-auto w-full">
                  <div className="flex items-center px-4 py-2 text-xs font-semibold text-slate-400 border-b border-slate-200/60 mb-2">
                    <div className="flex-1">节点名称</div>
                    <div className="w-32 text-right">创建日期</div>
                    <div className="w-24"></div>
                  </div>
                  
                  {archivedRoots.map(node => (
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
                  <p className="text-sm font-medium">归档库空空如也</p>
                  <p className="text-xs mt-1 opacity-70">在知识大盘中归档的节点会出现在这里</p>
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