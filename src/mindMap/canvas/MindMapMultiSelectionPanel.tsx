import { useState } from 'react';
import type { MindMapBoundaryShape, MindMapMarker, MindMapNode, MindMapNodeSemantic, MindMapPriority } from '../model';
import styles from './MindMapCanvas.module.css';

interface MindMapMultiSelectionPanelProps {
  count: number;
  canDistribute: boolean;
  canUngroup: boolean;
  canCreateSummary: boolean;
  onPatch: (label: string, updates: Partial<MindMapNode>) => void;
  onAddTags: (tags: string[]) => void;
  onAlign: (alignment: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onCreateBoundary: (shape: MindMapBoundaryShape) => void;
  onCreateSummary: () => void;
  onCreateGroup: () => void;
  onUngroup: () => void;
}

export function MindMapMultiSelectionPanel({
  count,
  canDistribute,
  canUngroup,
  canCreateSummary,
  onPatch,
  onAddTags,
  onAlign,
  onDistribute,
  onCreateBoundary,
  onCreateSummary,
  onCreateGroup,
  onUngroup,
}: MindMapMultiSelectionPanelProps) {
  const [tags, setTags] = useState('');
  const [shape, setShape] = useState<MindMapBoundaryShape>('box');
  return <div className={styles.multiSelectionPanel}>
    <section className={styles.inspectorGroup}>
      <h3>批量属性 · {count} 个节点</h3>
      <label><span>语义</span><select aria-label="批量设置语义" defaultValue="" onChange={(event) => event.target.value && onPatch('批量设置语义', { semantic: event.target.value as MindMapNodeSemantic })}><option value="" disabled>选择后应用</option><option value="auto">按层级自动</option><option value="topic">中心主题</option><option value="branch">一级主题</option><option value="subtopic">子主题</option><option value="summary">摘要</option><option value="note">便签</option></select></label>
      <label><span>标记</span><select aria-label="批量设置标记" defaultValue="" onChange={(event) => event.target.value && onPatch('批量设置标记', { marker: event.target.value as MindMapMarker })}><option value="" disabled>选择后应用</option><option value="none">无</option><option value="star">★ 星标</option><option value="flag">⚑ 旗标</option><option value="question">? 疑问</option><option value="idea">💡 灵感</option></select></label>
      <label><span>优先级</span><select aria-label="批量设置优先级" defaultValue="" onChange={(event) => event.target.value && onPatch('批量设置优先级', { priority: event.target.value as MindMapPriority })}><option value="" disabled>选择后应用</option><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
      <label><span>进度</span><input type="number" min="0" max="100" placeholder="输入后回车" aria-label="批量设置进度" onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        onPatch('批量设置进度', { progress: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)) });
      }} /></label>
      <label><span>分支颜色</span><select aria-label="批量设置颜色继承" defaultValue="" onChange={(event) => event.target.value && onPatch('批量设置颜色继承', { colorMode: event.target.value as MindMapNode['colorMode'] })}><option value="" disabled>选择后应用</option><option value="inherit">继承分支色</option><option value="custom">使用节点颜色</option><option value="auto">自动兼容</option></select></label>
      <label className={styles.batchTagField}><span>追加标签</span><span><input value={tags} placeholder="标签1, 标签2" onChange={(event) => setTags(event.target.value)} /><button type="button" onClick={() => {
        const values = tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        if (values.length) onAddTags(values);
        setTags('');
      }}>添加</button></span></label>
    </section>
    <section className={styles.inspectorGroup}>
      <h3>结构</h3>
      <div className={styles.boundaryActions}><select aria-label="边界形态" value={shape} onChange={(event) => setShape(event.target.value as MindMapBoundaryShape)}><option value="box">边框</option><option value="bracket">括号</option><option value="cloud">云朵</option><option value="fill">底色</option></select><button type="button" onClick={() => onCreateBoundary(shape)}>创建边界</button></div>
      <button type="button" disabled={!canCreateSummary} title={canCreateSummary ? '' : '摘要来源必须是同级节点'} onClick={onCreateSummary}>汇总为摘要</button>
      <div className={styles.layerActions}><button type="button" onClick={onCreateGroup}>创建分组</button><button type="button" disabled={!canUngroup} onClick={onUngroup}>解除分组</button></div>
    </section>
    <section className={styles.inspectorGroup}>
      <h3>排列</h3>
      <div className={styles.arrangeActions}>
        <button type="button" onClick={() => onAlign('left')}>左对齐</button><button type="button" onClick={() => onAlign('center-x')}>水平居中</button><button type="button" onClick={() => onAlign('right')}>右对齐</button>
        <button type="button" onClick={() => onAlign('top')}>顶对齐</button><button type="button" onClick={() => onAlign('center-y')}>垂直居中</button><button type="button" onClick={() => onAlign('bottom')}>底对齐</button>
        <button type="button" disabled={!canDistribute} onClick={() => onDistribute('horizontal')}>水平分布</button><button type="button" disabled={!canDistribute} onClick={() => onDistribute('vertical')}>垂直分布</button>
      </div>
    </section>
  </div>;
}
