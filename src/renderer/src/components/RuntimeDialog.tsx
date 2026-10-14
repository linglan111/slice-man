import { useEffect, useRef, useState, type ReactNode } from 'react';
import { optionsSchema, type RuntimeStatus } from '../../../shared/contracts';
import { Modal } from './Modal';
import { formatBytes } from '../lib/presentation';
import { DownloadCacheInfo } from './DownloadCacheInfo';

type Props = { runtime: RuntimeStatus | null; progress: { progress: number; message: string } | null; onInstall: (modelId: 'base' | 'small' | 'large-v3-turbo', preferGpu: boolean) => Promise<void>; onCancel: () => void; onClose: () => void };
export function RuntimeDialog({ runtime, progress, onInstall, onCancel, onClose }: Props): ReactNode {
  const [modelId, setModelId] = useState<'base' | 'small' | 'large-v3-turbo'>('base');
  const [preferGpu, setPreferGpu] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [cache, setCache] = useState(runtime?.downloadCache);
  const cacheRequest = useRef(0);
  useEffect(() => {
    let mounted = true;
    const request = ++cacheRequest.current;
    void window.api.runtime.status().then((result) => {
      if (!mounted || request !== cacheRequest.current) return;
      if (result.success === true) setCache(result.data.downloadCache);
      else setError(result.error);
    }).catch(() => { if (mounted && request === cacheRequest.current) setError('下载进度无法读取，请重试。'); });
    return () => { mounted = false; };
  }, []);
  async function refreshCache(): Promise<void> {
    const request = ++cacheRequest.current;
    const result = await window.api.runtime.status();
    if (request !== cacheRequest.current) return;
    if (result.success === true) setCache(result.data.downloadCache);
    else setError(result.error);
  }
  async function clearCache(): Promise<void> {
    ++cacheRequest.current;
    setIsBusy(true); setError('');
    try {
      const result = await window.api.runtime.clearDownloadCache();
      if (result.success === true) setCache(result.data.downloadCache);
      else setError(result.error);
    } catch { setError('下载缓存无法清除，请重试。'); }
    finally { setIsBusy(false); }
  }
  async function install(): Promise<void> {
    setIsBusy(true); setError('');
    try { await onInstall(modelId, preferGpu); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '安装失败，请重试。'); }
    finally { try { await refreshCache(); } catch { setError('下载进度无法读取，请重试。'); } finally { setIsBusy(false); } }
  }
  return <Modal title="本地 Whisper 一键安装" onClose={onClose} isBusy={isBusy}>
    <div className="device-card"><span className="eyebrow">YOUR DEVICE</span><strong>{runtime?.gpuName ?? 'CPU 识别'}</strong><p>{runtime ? `${runtime.totalMemoryGb.toFixed(1)} GB 内存 · 实际后端：${runtime.actualBackend.toUpperCase()}` : '正在检测设备…'}</p><p>{runtime?.message}</p></div>
    <label>下载模型<select aria-label="下载模型" disabled={isBusy} value={modelId} onChange={(event) => setModelId(optionsSchema.shape.modelId.parse(event.target.value))}>{(runtime?.catalog ?? []).map((model) => <option key={model.id} value={model.id}>{model.name} · {formatBytes(model.sizeBytes)}{runtime?.installedModels.includes(model.id) ? ' · 已安装' : ''}</option>)}</select></label>
    <label className="check-label"><input disabled={isBusy} type="checkbox" checked={preferGpu} onChange={(event) => setPreferGpu(event.target.checked)} />安装并验证 NVIDIA 加速（若可用）</label>
    <p className="hint">自动下载、校验并运行测试，无需 Python 或编译工具。GPU 初始化失败时保留 CPU 识别。首次建议选择 Base。</p>
    <DownloadCacheInfo cache={cache ?? runtime?.downloadCache} isBusy={isBusy} onClear={() => void clearCache()} />
    {isBusy && <div className="install-progress" role="status"><progress max={1} value={progress?.progress ?? 0} /><p>{progress?.message ?? '准备安装…'}</p></div>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <footer className="modal__footer">{isBusy ? <button className="button" onClick={onCancel}>取消安装（保留下载）</button> : <button className="button" onClick={onClose}>关闭</button>}<button className="button button--primary" disabled={isBusy || !runtime} onClick={() => void install()}>{isBusy ? '安装中…' : (cache ?? runtime?.downloadCache)?.assets.some((asset) => asset.id === `model-${modelId}` || asset.id === 'whisper-cpu' || (preferGpu && asset.id === 'whisper-gpu')) ? '继续安装所选模型' : '一键安装所选模型'}</button></footer>
  </Modal>;
}

