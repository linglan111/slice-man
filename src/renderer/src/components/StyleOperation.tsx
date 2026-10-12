import { useState, type ReactNode } from 'react';
import type { Job } from '../../../shared/contracts';

type Props = { job: Job; isBusy: boolean; onSettings: () => void; onClose: () => void; onDesign: (prompt: string) => Promise<void> };
export function StyleOperation({ job, isBusy, onSettings, onClose, onDesign }: Props): ReactNode {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  return <section className="operation-panel__grid" aria-label="样式操作">
    <label>AI 设计描述<textarea aria-label="AI 设计描述" rows={3} disabled={isBusy} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：电影感，白色字幕，淡黄色强调" /></label>
    <div><p className="hint">设计字体、配色和有限动画，不修改字幕文字。模板、字体、位置与强调可在样式设置中调整。</p><button className="button" onClick={onSettings}>打开样式设置</button>{!job.options.styleProfileId && <p className="hint">请在生成设置中选择 AI 样式服务，再生成 AI 样式。</p>}</div>
    {error && <p className="error-message operation-panel__wide" role="alert">{error}</p>}
    <footer className="operation-panel__actions"><button className="button" onClick={onClose}>取消</button><button className="button button--primary" disabled={isBusy || !prompt.trim() || !job.options.styleProfileId} onClick={() => { setError(''); void onDesign(prompt.trim()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '样式生成失败。')); }}>生成 AI 样式</button></footer>
  </section>;
}
