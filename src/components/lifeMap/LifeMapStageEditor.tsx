import React from 'react';
import { Palette, X } from 'lucide-react';
import { LEARNING_CHILD_PALETTE } from '@/lifeMap/data';
import type { LifeArea, LifeMapStage } from '@/lifeMap/types';
import LifeMapEntityEditor from './LifeMapEntityEditor';

export type LifeMapStageDraft = Pick<LifeMapStage, 'name' | 'start' | 'end' | 'description' | 'color' | 'importance' | 'areaIds'>;

interface LifeMapStageEditorProps {
  stage: LifeMapStageDraft;
  existing?: boolean;
  onSave: (stage: LifeMapStageDraft) => void;
  onDelete?: () => void;
  onDismiss: () => void;
  areas?: LifeArea[];
}

const LifeMapStageEditor: React.FC<LifeMapStageEditorProps> = ({ stage, existing = false, onSave, onDelete, onDismiss, areas = [] }) => {
  const [draft, setDraft] = React.useState(stage);
  const update = <K extends keyof LifeMapStageDraft>(key: K, value: LifeMapStageDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const selectedAreaIds = draft.areaIds ?? [];
  const stageColor = draft.color ?? '#7C6FE6';
  return <LifeMapEntityEditor kind="stage" onDismiss={onDismiss} onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, name: draft.name.trim(), description: draft.description?.trim() ?? '' }); }}>
    <header><div><small>人生地图</small><h2>{existing ? '编辑阶段' : '新建阶段'}</h2></div><button type="button" onClick={onDismiss} aria-label="关闭"><X /></button></header>
    <label className="life-map-editor__name-field">阶段名称<input autoFocus required value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：研究生备考强化期" /></label>
    <div className="life-map-editor__dates"><label>开始日期<input required type="date" value={draft.start} onChange={(event) => update('start', event.target.value)} /></label><label>结束日期<input required type="date" min={draft.start} value={draft.end} onChange={(event) => update('end', event.target.value)} /></label></div>
    <label className="life-map-editor__summary-field">说明<textarea rows={3} value={draft.description ?? ''} onChange={(event) => update('description', event.target.value)} placeholder="这个阶段想达成什么，或要如何度过？" /></label>
    <label>重要性<select value={draft.importance ?? 'normal'} onChange={(event) => update('importance', event.target.value as LifeMapStage['importance'])}><option value="normal">普通阶段</option><option value="important">重要阶段</option></select></label>
    {areas.length > 0 && <fieldset className="life-map-editor__stage-areas"><legend>关联分类</legend><div className="life-map-editor__stage-areas-head"><small>不选择分类时，阶段会跨越学习、工作和生活三列。</small><button type="button" className={selectedAreaIds.length === 0 ? 'is-global-active' : ''} aria-pressed={selectedAreaIds.length === 0} onClick={() => update('areaIds', [])}>全局阶段</button></div><div className="life-map-editor__stage-area-grid">{areas.map((area) => {
      const checked = selectedAreaIds.includes(area.id);
      return <label key={area.id} className={checked ? 'is-selected' : undefined}><input type="checkbox" checked={checked} onChange={(event) => update('areaIds', event.target.checked ? [...selectedAreaIds, area.id] : selectedAreaIds.filter((id) => id !== area.id))} /><i style={{ background: area.color }} /><span>{area.name}</span></label>;
    })}</div></fieldset>}
    <div className="life-map-editor__color-field life-map-editor__stage-color">
      <span className="life-map-editor__color-label"><b>识别色</b><small>用于阶段背景和边框的轻量提示。</small></span>
      <div className="life-map-editor__color-control">
        <span className="life-map-editor__color-swatch" style={{ background: stageColor }}><Palette size={16} /></span>
        <div className="life-map-editor__color-presets" role="radiogroup" aria-label="阶段推荐色">
          {LEARNING_CHILD_PALETTE.map((entry) => <button key={entry.hex} type="button" role="radio" aria-checked={stageColor.toLowerCase() === entry.hex.toLowerCase()} aria-label={`${entry.label} ${entry.hex}`} title={entry.label} className={`life-map-editor__color-chip${stageColor.toLowerCase() === entry.hex.toLowerCase() ? ' is-active' : ''}`} style={{ background: entry.hex }} onClick={() => update('color', entry.hex)} />)}
          <span className="life-map-editor__color-custom"><input aria-label="选择自定义阶段识别色" type="color" value={stageColor} onChange={(event) => update('color', event.target.value)} /></span>
        </div>
        <b className="life-map-editor__color-hex">{stageColor.toUpperCase()}</b>
      </div>
    </div>
    <footer>{existing && onDelete ? <button type="button" className="is-danger" onClick={onDelete}>删除阶段</button> : <span />}<span /><button type="button" onClick={onDismiss}>取消</button><button className="is-primary" type="submit" disabled={!draft.name.trim() || !draft.start || !draft.end || draft.end < draft.start}>保存</button></footer>
  </LifeMapEntityEditor>;
};

export default LifeMapStageEditor;
