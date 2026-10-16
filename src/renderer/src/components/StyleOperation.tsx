import { useEffect, useState, type ReactNode } from 'react';
import type { Job } from '../../../shared/contracts';
import { Icon } from './Icon';

type Props = { job: Job; isBusy: boolean; onSettings: () => void; onClose: () => void; onDesign: (prompt: string) => Promise<void> };
export function StyleOperation({ job, isBusy, onSettings, onClose, onDesign }: Props): ReactNode {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (isBusy) setError(''); }, [isBusy]);
  return <section className="style-operation" aria-label="样式操作">
    <div className="style-operation__composer">
      <div className="style-operation__heading">
        <div className="style-operation__intro"><span className="style-operation__icon"><Icon name="generate" size={18} /></span><div><label htmlFor="style-design-prompt">AI 设计描述</label><p className="hint">字体、配色与动画，保留字幕。</p></div></div>
        <button className="button style-operation__settings" onClick={onSettings}><Icon name="settings" size={14} />打开样式设置</button>
      </div>
      <textarea id="style-design-prompt" aria-label="AI 设计描述" rows={2} disabled={isBusy} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：电影感，白色字幕，淡黄色强调" />
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer className="operation-panel__actions style-operation__actions"><p className="hint">{job.options.styleProfileId ? '模板、字体、位置与强调可在样式设置中调整。' : '请在生成设置中选择 AI 样式服务，再生成 AI 样式。'}</p><button className="button" onClick={onClose}>取消</button><button className="button button--primary" disabled={isBusy || !prompt.trim() || !job.options.styleProfileId} onClick={() => { setError(''); void onDesign(prompt.trim()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '样式生成失败。')); }}><Icon name="generate" size={14} />生成 AI 样式</button></footer>
  </section>;
}
