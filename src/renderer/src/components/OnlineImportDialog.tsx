import { useEffect, useState, type ReactNode } from "react";
import type { DownloadStatus, Job } from "../../../shared/contracts";
import { Modal } from "./Modal";
import { ImportOptions, type ImportChoice } from './ImportOptions';

export function OnlineImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (job: Job) => void;
}): ReactNode {
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState<ImportChoice>({ translationEnabled: false, targetLanguage: 'zh-CN' });
  const [status, setStatus] = useState<DownloadStatus>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.api.onDownloadStatus((next) => {
      if (isMounted) setStatus(next);
    });
    void window.api.download.status().then((result) => {
      if (isMounted && result.success) setStatus(result.data);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);
  const isBusy =
    isRunning ||
    (!!status &&
      ["installing", "downloading", "converting", "importing"].includes(
        status.state,
      ));
  async function download(): Promise<void> {
    setError("");
    setIsRunning(true);
    try {
      const result = await window.api.download.importUrl({ url, options: choice });
      if (result.success) onImported(result.data);
      else setError(result.error);
    } catch {
      setError("视频下载失败，请重试。");
    } finally {
      setIsRunning(false);
    }
  }
  return (
    <Modal title="链接导入视频" onClose={onClose} isBusy={isBusy}>
      <label>
        视频链接
        <input
          aria-label="视频链接"
          type="url"
          autoFocus
          disabled={isBusy}
          value={url}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <p className="hint">
        支持 yt-dlp 可处理的公开视频链接，如
        YouTube、Bilibili。完整下载并验证后自动导入；视频保存在设置的下载位置，可继续识别、校对和导出。
      </p>
      <ImportOptions value={choice} onChange={setChoice} isBusy={isBusy} />
      {status && !status.ready && (
        <p>请先关闭此窗口，在左下角「链接导入设置」中一键安装。</p>
      )}
      {status && (
        <div role="status">
          <progress max={1} value={status.progress} />
          <p>{status.message}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <footer className="modal__footer">
        {isBusy ? (
          <button
            className="button"
            onClick={() => void window.api.download.cancel()}
          >
            取消下载
          </button>
        ) : (
          <button className="button" onClick={onClose}>
            关闭
          </button>
        )}
        <button
          className="button button--primary"
          disabled={isBusy || !status?.ready || !url.trim()}
          onClick={() => void download()}
        >
          下载并导入
        </button>
      </footer>
    </Modal>
  );
}
