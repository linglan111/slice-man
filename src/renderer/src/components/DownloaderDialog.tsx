import { useEffect, useState, type ReactNode } from "react";
import type {
  DownloadSettings,
  DownloadStatus,
} from "../../../shared/contracts";
import { Modal } from "./Modal";
import { DownloadCacheInfo } from "./DownloadCacheInfo";
import { downloadSettingsSchema } from "../../../shared/download-contracts";

export function DownloaderDialog({
  onClose,
}: {
  onClose: () => void;
}): ReactNode {
  const [status, setStatus] = useState<DownloadStatus>();
  const [settings, setSettings] = useState<DownloadSettings>(() =>
    downloadSettingsSchema.parse({ proxy: "" }),
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.api.onDownloadStatus((next) => {
      if (isMounted) setStatus(next);
    });
    void window.api.download.status().then((result) => {
      if (!isMounted) return;
      if (result.success) {
        setStatus(result.data);
        setSettings(result.data.settings);
      } else setError(result.error);
      setIsLoaded(true);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);
  const isBusy =
    isSaving ||
    (!!status &&
      ["installing", "downloading", "converting", "importing"].includes(
        status.state,
      ));
  async function chooseDirectory(): Promise<void> {
    setError("");
    setIsSaving(true);
    try {
      const result = await window.api.download.chooseDirectory();
      if (result.success && result.data) {
        setStatus(result.data);
        setSettings((current) => ({
          ...current,
          directory: result.data?.settings.directory ?? current.directory,
        }));
      } else if (!result.success) setError(result.error);
    } catch {
      setError("无法选择下载目录，请重试。");
    } finally {
      setIsSaving(false);
    }
  }
  async function save(): Promise<void> {
    setError("");
    setIsSaving(true);
    try {
      const result = await window.api.download.saveSettings(settings);
      if (result.success) setStatus(result.data);
      else setError(result.error);
    } catch {
      setError("设置保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }
  async function install(): Promise<void> {
    setError("");
    setIsSaving(true);
    try {
      const result = await window.api.download.install();
      if (result.success) setStatus(result.data);
      else setError(result.error);
    } catch {
      setError("工具安装失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }
  async function clearCache(): Promise<void> {
    setError(""); setIsSaving(true);
    try {
      const result = await window.api.download.clearDownloadCache();
      if (result.success === true) setStatus(result.data);
      else setError(result.error);
    } catch { setError("下载缓存无法清除，请重试。"); }
    finally { setIsSaving(false); }
  }
  return (
    <Modal title="链接导入设置" onClose={onClose} isBusy={isBusy}>
      <p role="status">
        {status?.ready ? "下载工具已就绪" : "下载工具尚未安装"} · yt-dlp{" "}
        {status?.version ?? "…"} · Deno {status?.denoVersion ?? "…"}
      </p>
      <p className="hint">
        一键安装官方 Windows 下载工具和 JavaScript 运行时，无需 Python。下载约{" "}
        {Math.ceil((status?.sizeBytes ?? 0) / 1_000_000)}{" "}
        MB。失败更新保留原有可用安装。
      </p>
      <DownloadCacheInfo cache={status?.downloadCache} isBusy={isBusy} onClear={() => void clearCache()} />
      <label>
        下载位置
        <input
          aria-label="下载位置"
          readOnly
          value={settings.directory || status?.defaultDirectory || ""}
        />
      </label>
      <div className="modal__footer">
        <button
          className="button"
          disabled={isBusy || !isLoaded || !status}
          onClick={() => void chooseDirectory()}
        >
          选择下载位置
        </button>
        <button
          className="button"
          disabled={isBusy || !isLoaded}
          onClick={() => setSettings({ ...settings, directory: "" })}
        >
          使用默认视频目录
        </button>
      </div>
      <p className="hint">
        下载文件保存在所选位置的独立视频文件夹内。默认使用 Windows 视频目录下的
        Slice Man；任务始终引用完成后的本地文件。
      </p>
      <label>
        下载容器格式
        <select
          aria-label="下载容器格式"
          disabled={isBusy || !isLoaded}
          value={settings.container}
          onChange={(event) =>
            setSettings({
              ...settings,
              container: event.target.value as DownloadSettings["container"],
            })
          }
        >
          <option value="mp4">MP4（默认）</option>
          <option value="mkv">MKV</option>
          <option value="original">保留原格式</option>
        </select>
      </label>
      <label>
        下载视频编码
        <select
          aria-label="下载视频编码"
          disabled={isBusy || !isLoaded}
          value={settings.videoCodec}
          onChange={(event) =>
            setSettings({
              ...settings,
              videoCodec: event.target.value as DownloadSettings["videoCodec"],
            })
          }
        >
          <option value="original">保留原编码（默认）</option>
          <option value="h264">H.264（软件转码）</option>
          <option value="h265">H.265（软件转码）</option>
        </select>
      </label>
      <p className="hint">
        容器与编码独立：保留编码时仅重新封装；指定 H.264/H.265
        会重新编码并改变文件体积/画质。保留原格式同时指定编码时，最终使用
        MKV。原编码与目标容器不兼容时会明确报错。
      </p>
      {settings.container === "original" &&
        settings.videoCodec !== "original" && (
          <p role="status">
            当前组合最终保存为 MKV，视频使用{" "}
            {settings.videoCodec === "h264" ? "H.264" : "H.265"}。
          </p>
        )}
      <label>
        视频下载清晰度
        <select
          aria-label="视频下载清晰度"
          disabled={isBusy || !isLoaded}
          value={settings.quality}
          onChange={(event) =>
            setSettings({
              ...settings,
              quality: event.target.value as DownloadSettings["quality"],
            })
          }
        >
          <option value="360p">最高 360p</option>
          <option value="480p">最高 480p</option>
          <option value="720p">最高 720p</option>
          <option value="1080p">最高 1080p（默认）</option>
          <option value="1440p">最高 1440p</option>
          <option value="2160p">最高 2160p（4K）</option>
          <option value="best">网站可用的最佳画质</option>
        </select>
      </label>
      <p className="hint">
        原片分辨率较低时保持原大小，不放大。网站未提供尺寸且实际视频超过所选上限时，保留原编码会提示改选上限或
        H.264/H.265；指定编码可缩小到上限。
      </p>
      <label>
        下载代理（可选）
        <input
          aria-label="下载代理（可选）"
          disabled={isBusy || !isLoaded}
          value={settings.proxy}
          placeholder="http://127.0.0.1:7890"
          onChange={(event) =>
            setSettings({ ...settings, proxy: event.target.value })
          }
        />
      </label>
      <p className="hint">
        代理仅用于视频下载，支持无账号密码的 HTTP(S)/SOCKS5
        地址。只下载当前链接的视频；不读取浏览器登录信息。网站访问限制仍然适用。
      </p>
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
            {status?.state === "installing" ? "取消安装（保留下载）" : "取消视频下载"}
          </button>
        ) : (
          <button className="button" onClick={onClose}>
            关闭
          </button>
        )}
        <button
          className="button"
          disabled={isBusy || !isLoaded || !status}
          onClick={() => void save()}
        >
          保存下载设置
        </button>
        <button
          className="button button--primary"
          disabled={isBusy || !isLoaded || !status}
          onClick={() => void install()}
        >
          {status?.downloadCache?.assets.length ? "继续安装下载工具" : status?.ready ? "重新安装固定版本" : "一键安装下载工具"}
        </button>
      </footer>
    </Modal>
  );
}
