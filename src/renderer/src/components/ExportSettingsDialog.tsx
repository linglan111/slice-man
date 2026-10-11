import { useEffect, useState, type ReactNode } from 'react';
import { exportSettingsSchema, type ExportSettings } from '../../../shared/export-contracts';
import { requireResult } from '../lib/api-result';
import { ExportVideoOptions } from './ExportVideoOptions';
import { Modal } from './Modal';

export function ExportSettingsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [settings, setSettings] = useState<ExportSettings>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let isMounted = true;
    void requireResult(window.api.exportSettings.status()).then((result) => { if (isMounted) setSettings(result); }).catch((cause: unknown) => { if (isMounted) setError(cause instanceof Error ? cause.message : '无法读取导出设置。'); });
    return () => { isMounted = false; };
  }, []);
  async function chooseDirectory(): Promise<void> {
    if (!settings || isBusy) return;
    setIsBusy(true); setError(''); setNotice('');
    try { const next = await requireResult(window.api.exportSettings.chooseDirectory()); if (next) setSettings((current) => current ? { ...current, directory: next.directory } : next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法选择导出位置。'); }
    finally { setIsBusy(false); }
  }
  async function save(): Promise<void> {
    if (!settings || isBusy) return;
    const validated = exportSettingsSchema.safeParse(settings);
    if (!validated.success) { setError('请检查导出设置后再保存。'); return; }
    setIsBusy(true); setError(''); setNotice('');
    try { setSettings(await requireResult(window.api.exportSettings.saveSettings(validated.data))); setNotice('导出默认设置已保存。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '导出设置保存失败。'); }
    finally { setIsBusy(false); }
  }
  return <Modal title="导出设置" onClose={onClose} isBusy={isBusy}>
    <p className="hint">这里设置视频与字幕文件的导出默认值。每次导出都可以临时更改，不会改动这些默认值。</p>
    {settings ? <>
      <label>默认导出位置<input aria-label="默认导出位置" value={settings.directory} readOnly /></label><button className="button" disabled={isBusy} onClick={() => void chooseDirectory()}>选择默认导出位置</button>
      <fieldset><legend>字幕烧录视频</legend><label>默认视频格式<select aria-label="默认视频格式" disabled={isBusy} value={settings.videoFormat} onChange={(event) => { const next = event.target.value; if (next === 'mp4' || next === 'mkv') setSettings({ ...settings, videoFormat: next }); }}><option value="mp4">MP4</option><option value="mkv">MKV</option></select></label><ExportVideoOptions value={settings} disabled={isBusy} onChange={(next) => setSettings({ ...settings, ...next })} /></fieldset>
      <fieldset><legend>独立字幕文件</legend><label>默认字幕格式<select aria-label="默认字幕格式" disabled={isBusy} value={settings.subtitleFormat} onChange={(event) => { const next = event.target.value; if (next === 'srt' || next === 'ass' || next === 'vtt') setSettings({ ...settings, subtitleFormat: next }); }}><option value="srt">SRT</option><option value="ass">ASS</option><option value="vtt">VTT</option></select></label><p className="hint">字幕文件使用当前文字和时间轴，无需识别、翻译或视频编码。ASS 保留支持的样式；SRT/VTT 以文字和时间为主。</p></fieldset>
    </> : <p role="status">正在读取导出设置…</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-message">{error}</p>}
    <footer className="modal__footer"><button className="button" disabled={isBusy} onClick={onClose}>关闭</button><button className="button button--primary" disabled={isBusy || !settings} onClick={() => void save()}>{isBusy ? '保存中…' : '保存导出设置'}</button></footer>
  </Modal>;
}
