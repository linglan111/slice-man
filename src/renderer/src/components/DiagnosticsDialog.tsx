import { useEffect, useState, type ReactNode } from 'react';
import type { ProviderDiagnostic } from '../../../shared/provider-diagnostics-contracts';
import { requireResult } from '../lib/api-result';
import { Modal } from './Modal';
const STATE_LABELS: Record<ProviderDiagnostic['state'], string> = {waiting: '等待响应', receiving: '接收中', transport_complete: '接收完成，待校验', validated: '已校验', published: '已应用', failed: '失败', cancelled: '已取消', interrupted: '中断'};
const OPERATIONS: Record<ProviderDiagnostic['operation'], string> = {review: '字幕检查', names: '人名检查', chapters: '章节切分', translate: '字幕翻译', style: '样式生成'};
export function DiagnosticsDialog({jobId, onClose, onRetry, isOperationBusy = false}: {jobId?: string; onClose: () => void; onRetry?: (record: ProviderDiagnostic) => void; isOperationBusy?: boolean}): ReactNode {
  const [items, setItems] = useState<ProviderDiagnostic[]>([]);
  const [detail, setDetail] = useState<ProviderDiagnostic>();
  const [answer, setAnswer] = useState<{text: string; truncated: boolean}>();
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {let current = true; void requireResult(window.api.diagnostics.list({jobId})).then((next) => {if (current) {setItems(next); setHasMore(next.length === 50);}}).catch((cause: unknown) => {if (current) setError(cause instanceof Error ? cause.message : '无法读取请求日志');}); return () => {current = false;};}, [jobId]);
  async function perform(action: () => Promise<void>): Promise<void> {setIsBusy(true); setError(''); try {await action();} catch(cause) {setError(cause instanceof Error ? cause.message : '请求日志读取失败');} finally {setIsBusy(false);}}
  async function refresh(): Promise<void> {const next = await requireResult(window.api.diagnostics.list({jobId})); setItems(next); setHasMore(next.length === 50);}
  async function loadMore(): Promise<void> {
    const cursor = items.at(-1); if (!cursor) return;
    const next = await requireResult(window.api.diagnostics.list({jobId, before: cursor.startedAt, beforeId: cursor.id}));
    setItems((previous) => {const seen = new Set(previous.map((item) => item.id)); return [...previous, ...next.filter((item) => !seen.has(item.id))];});
    setHasMore(next.length === 50);
  }
  const completed = items.filter((item) => !['waiting', 'receiving', 'transport_complete'].includes(item.state));
  return <Modal title="AI 请求日志" onClose={onClose} isBusy={isBusy}>
    <p className="hint">仅记录请求阶段、耗时、用量与回答；不记录密钥和完整提示词。中断回答保留供排查，未完成 JSON 不会应用。</p>
    <div className="diagnostics-list" aria-label="请求记录">{items.map((item) => <button className="button diagnostics-item" key={item.id} disabled={isBusy} aria-pressed={detail?.id === item.id} onClick={() => void perform(async () => {const [record, text] = await Promise.all([requireResult(window.api.diagnostics.detail(item.id)), requireResult(window.api.diagnostics.readAnswer(item.id))]); setDetail(record); setAnswer(text);})}>
      <strong>{OPERATIONS[item.operation]} · {STATE_LABELS[item.state]}</strong><span>{item.model} · {(item.elapsedMs / 1000).toFixed(1)} 秒 · {item.textBytes.toLocaleString()} 字节{item.errorCode ? ` · ${item.errorCode}` : ''}</span>
    </button>)}</div>
    {hasMore && <button className="button" disabled={isBusy} onClick={() => void perform(loadMore)}>加载更早的请求</button>}
    {!items.length && <p>暂无请求日志；旧版请求无法补录。</p>}
    {detail && <section className="diagnostics-detail"><h3>{OPERATIONS[detail.operation]} · {STATE_LABELS[detail.state]}</h3><p>请求 {detail.id} · 第 {detail.attempt + 1} 次 · {detail.targetCount} 条字幕</p><p>提示 {detail.promptBytes} 字节 · 接收 {detail.wireBytes} 字节 · {detail.streamActual ? '流式响应' : '普通响应'}{detail.errorPhase ? ` · 错误阶段 ${detail.errorPhase}` : ''}</p>{detail.usage && <p>实际 token：输入 {detail.usage.inputTokens ?? '未返回'} · 输出 {detail.usage.outputTokens ?? '未返回'}</p>}<pre aria-label="已接收的 AI 回答">{answer?.text || '尚未收到回答文字'}</pre>{answer?.truncated && <p className="hint">预览已截断，原始回答保留在本地请求文件。</p>}</section>}
    {detail && onRetry && jobId && detail.jobId === jobId && (detail.state === 'failed' || detail.state === 'interrupted') && <div><p className="hint">历史日志未保存原操作范围和选项。重新设置后确认执行，不会直接重放请求。</p><button className="button" disabled={isBusy || isOperationBusy} onClick={() => onRetry(detail)}>重新设置并重试</button></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer className="modal__footer"><button className="button" disabled={isBusy || !completed.length} onClick={() => void perform(async () => {await requireResult(window.api.diagnostics.clear(completed.slice(0, 1000).map((item) => item.id))); await refresh(); setDetail(undefined); setAnswer(undefined);})}>清除此页已结束记录</button><button className="button" disabled={isBusy} onClick={() => void perform(refresh)}>刷新日志</button><button className="button button--primary" onClick={onClose}>返回工作区</button></footer>
  </Modal>;
}
