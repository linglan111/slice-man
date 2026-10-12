import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExportInput } from '../../../shared/contracts';
import type { ExportSettings } from '../../../shared/export-contracts';
import { requireResult } from '../lib/api-result';
import { ExportVideoOptions } from './ExportVideoOptions';
import { Modal } from './Modal';

type Props = { jobId: string; initialKind?: 'video' | 'subtitle'; onExport: (input: ExportInput) => Promise<boolean>; onClose: () => void };
const FORMATS: ExportInput['format'][] = ['mp4', 'mkv', 'srt', 'ass', 'vtt'];
export function ExportDialog(props: Props): ReactNode {
  return <Modal title="导出作品" onClose={props.onClose}><ExportForm {...props} /></Modal>;
}

export function ExportForm({ jobId, initialKind = 'video', onExport, onClose }: Props): ReactNode {
  const [settings, setSettings] = useState<ExportSettings>();
  const [format, setFormat] = useState<ExportInput['format']>(initialKind === 'subtitle' ? 'srt' : 'mp4');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    let isMounted = true;
    void requireResult(window.api.exportSettings.status()).then((result) => {
      if (isMounted) { setSettings(result); setFormat(initialKind === 'subtitle' ? result.subtitleFormat : result.videoFormat); }
    }).catch((cause: unknown) => { if (isMounted) setError(cause instanceof Error ? cause.message : '无法读取导出设置。'); });
    return () => { isMounted = false; isMountedRef.current = false; };
  }, [initialKind]);
  const isVideo = format === 'mp4' || format === 'mkv';
  async function save(): Promise<void> {
    if (isBusy || !settings) return;
    setIsBusy(true); setError('');
    try {
      const input: ExportInput = isVideo ? { jobId, format, quality: settings.quality, videoCodec: settings.videoCodec, resolution: settings.resolution } : { jobId, format };
      if (await onExport(input) && isMountedRef.current) onClose();
    }
    catch (cause) { if (isMountedRef.current) setError(cause instanceof Error ? cause.message : '导出失败，请重试。'); }
    finally { if (isMountedRef.current) setIsBusy(false); }
  }
  return <section className="export-form operation-panel__grid" aria-label="导出操作">
    <div className="modal__footer" role="group" aria-label="导出类型"><button className={`button ${isVideo ? 'button--primary' : ''}`} disabled={isBusy || !settings} aria-pressed={isVideo} onClick={() => { if (settings) setFormat(settings.videoFormat); }}>字幕烧录视频</button><button className={`button ${!isVideo ? 'button--primary' : ''}`} disabled={isBusy || !settings} aria-pressed={!isVideo} onClick={() => { if (settings) setFormat(settings.subtitleFormat); }}>独立字幕文件</button></div>
    <label>导出格式<select aria-label="导出格式" value={format} disabled={isBusy || !settings} onChange={(event) => { const next = FORMATS.find((value) => value === event.target.value); if (next) setFormat(next); }}><optgroup label="字幕烧录视频">{FORMATS.slice(0, 2).map((value) => <option key={value} value={value}>{value.toUpperCase()} · 字幕烧录视频</option>)}</optgroup><optgroup label="独立字幕文件">{FORMATS.slice(2).map((value) => <option key={value} value={value}>{value.toUpperCase()} · 独立字幕文件</option>)}</optgroup></select></label>
    {settings ? <><div className="export-form__directory"><span>默认保存位置</span><span className="export-form__path" title={settings.directory}>{settings.directory}</span><small>保存时可另选；本次调整不改默认设置。</small></div>{isVideo ? <ExportVideoOptions compact value={settings} disabled={isBusy} onChange={(next) => setSettings({ ...settings, ...next })} /> : <p className="hint">只保存当前文字和时间轴，不调用 AI，也不编码视频。ASS 保留支持的样式；SRT/VTT 以文字和时间为主。</p>}</> : <p role="status">正在读取导出设置…</p>}
    {isBusy && <p role="status">正在导出，可关闭此面板后在工作区取消处理。</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <footer className="modal__footer"><button className="button" onClick={onClose}>返回工作区</button><button className="button button--primary" disabled={isBusy || !settings} onClick={() => void save()}>{isBusy ? '导出中…' : '选择保存位置并导出'}</button></footer>
  </section>;
}

