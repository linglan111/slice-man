import { useState, type ReactNode } from 'react';
import { styleSchema, type Job, type SubtitleStyle } from '../../../shared/contracts';
import { TEMPLATE_LABELS, templateStyle } from '../lib/presentation';

type Props = { job: Job; isBusy: boolean; selectedIds: string[]; onStyle: (style: SubtitleStyle) => void; onBilingual: (value: boolean) => void; onDesign: (prompt: string) => void };
export function StylePanel({ job, isBusy, selectedIds, onStyle, onBilingual, onDesign }: Props): ReactNode {
  const [prompt, setPrompt] = useState('');
  const [keywords, setKeywords] = useState('');
  const style = job.style;
  return <section className="style-panel" aria-label="字幕样式"><div className="section-heading"><h2>字幕样式</h2><span className="eyebrow">MAKE IT YOURS</span></div>
    <div className="template-grid">{styleSchema.shape.templateId.options.map((id) => <button aria-label={`${TEMPLATE_LABELS[id]}模板`} disabled={isBusy} className={`template-card template-card--${id} ${id === style.templateId ? 'template-card--selected' : ''}`} aria-pressed={id === style.templateId} key={id} onClick={() => onStyle(templateStyle(id))}><span>Aa 字</span><small>{TEMPLATE_LABELS[id]}</small></button>)}</div>
    {job.options.translationEnabled && <label className="check-label"><input type="checkbox" checked={job.options.bilingual} disabled={isBusy} onChange={(event) => onBilingual(event.target.checked)} />双语字幕（译文 + 原文）</label>}
    <div className="form-grid"><label>文字颜色<input aria-label="文字颜色" type="color" disabled={isBusy} value={style.textColor} onChange={(event) => onStyle({ ...style, textColor: event.target.value })} /></label>
      <label>字体<select aria-label="字体" disabled={isBusy} value={style.fontId} onChange={(event) => onStyle({ ...style, fontId: styleSchema.shape.fontId.parse(event.target.value) })}><option value="managed-cjk">Noto CJK 常规</option><option value="managed-cjk-bold">Noto CJK 粗体</option></select></label></div>
    <div className="form-grid"><label>字幕位置<select aria-label="字幕位置" disabled={isBusy} value={style.layout.anchor} onChange={(event) => onStyle({ ...style, layout: { ...style.layout, anchor: styleSchema.shape.layout.shape.anchor.parse(event.target.value) } })}><option value="bottom-center">底部居中</option><option value="center">画面居中</option><option value="top-center">顶部居中</option></select></label>
      <label>入场效果<select aria-label="入场效果" disabled={isBusy} value={style.animation.type} onChange={(event) => onStyle({ ...style, animation: { ...style.animation, type: styleSchema.shape.animation.shape.type.parse(event.target.value) } })}><option value="fade">淡入淡出</option><option value="none">无动画</option></select></label></div>
    <label>强调关键词<input aria-label="强调关键词" disabled={isBusy} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="用逗号分隔，先选中字幕" /></label>
    <button className="button button--subtle" disabled={isBusy || !selectedIds.length} onClick={() => {
      const words = keywords.split(/[,，]/).map((word) => word.trim()).filter(Boolean);
      onStyle({ ...style, emphasisBySegment: [...style.emphasisBySegment.filter((item) => !selectedIds.includes(item.segmentId)), ...selectedIds.map((segmentId) => ({ segmentId, keywords: words }))] });
    }}>为选中字幕设置强调</button>
    <div className="ai-style"><label>AI 设计描述<textarea aria-label="AI 设计描述" rows={2} value={prompt} disabled={isBusy} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：电影感，白色字幕，淡黄色强调" /></label>
      <button className="button button--subtle" disabled={isBusy || !prompt.trim() || !job.options.styleProfileId} onClick={() => onDesign(prompt.trim())}>✧ 生成 AI 样式</button><p className="hint">生成字体、配色和有限动画配置；不修改字幕文字。</p></div>
  </section>;
}


