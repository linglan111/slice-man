import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProviderLiveSnapshot } from '../../../shared/provider-diagnostics-contracts';
import { Modal } from './Modal';

export const LIVE_PHASE_LABELS: Record<ProviderLiveSnapshot['phase'], string> = { waiting: '等待模型响应', thinking: '模型思考中', answer: '正在输出结果', complete: '输出已完成', failed: '请求失败', cancelled: '请求已取消' };
const OPERATIONS: Record<ProviderLiveSnapshot['operation'], string> = { review: '字幕检查', names: '人名检查', chapters: '章节切分', translate: '字幕翻译', style: '样式生成' };

function LiveText({ label, text }: { label: string; text: string }): ReactNode {
  const ref = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => { if (follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  return <pre ref={ref} aria-label={label} tabIndex={0} onScroll={(event) => { const element = event.currentTarget; follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 32; }}>{text}</pre>;
}

export function ProviderLiveDialog({ items, error, onClose }: { items: ProviderLiveSnapshot[]; error: string; onClose: () => void }): ReactNode {
  const [selectedId, setSelectedId] = useState('');
  const selected = items.find((item) => item.requestId === selectedId) ?? items[0];
  return <Modal title="AI 流式信息" className="provider-live-dialog" onClose={onClose}>
    <p className="hint">实时显示服务返回的思考与回答。思考内容仅临时保留，关闭软件后不保留；部分模型不会返回思考内容。</p>
    {items.length > 1 && <label>查看请求<select aria-label="查看流式请求" value={selected?.requestId ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{items.map((item) => <option value={item.requestId} key={item.requestId}>{OPERATIONS[item.operation]} · {item.model} · {new Date(item.startedAt).toLocaleTimeString()} · {LIVE_PHASE_LABELS[item.phase]}</option>)}</select></label>}
    {selected ? <>
      <div className="provider-live-summary" role="status"><strong>{LIVE_PHASE_LABELS[selected.phase]}</strong><span>{OPERATIONS[selected.operation]} · {selected.model} · {Math.floor(selected.elapsedMs / 1000)} 秒</span><span>已接收 {selected.wireBytes.toLocaleString()} 字节 · 回答 {selected.answerBytes.toLocaleString()} 字节</span></div>
      <div className="provider-live-content">
        <section><h3>模型思考</h3><LiveText key={`${selected.requestId}-thinking`} label="模型思考内容" text={selected.thinkingText || (selected.phase === 'waiting' ? '正在等待服务响应…' : '服务尚未返回可展示的思考内容。')} />{selected.thinkingTruncated && <p className="hint">仅显示最近一部分思考内容。</p>}</section>
        <section><h3>回答内容</h3><LiveText key={`${selected.requestId}-answer`} label="流式回答内容" text={selected.answerText || (selected.phase === 'thinking' ? '模型正在思考，尚未开始输出回答。' : '尚未收到回答文字。')} />{selected.answerTruncated && <p className="hint">仅显示最近一部分回答内容；可在请求日志中查看保存的回答预览。</p>}</section>
      </div>
    </> : <p className="hint" role="status">当前暂无流式请求。开始 AI 操作后，此处会自动更新。</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer className="modal__footer"><button className="button button--primary" onClick={onClose}>返回工作区</button></footer>
  </Modal>;
}
