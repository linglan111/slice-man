import type { ReactNode } from "react";
import type { ArtifactCacheSummary } from "../../../shared/artifact-cache-contracts";
import { formatBytes } from "../lib/presentation";

function cacheBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return formatBytes(value);
}

export function DownloadCacheInfo({ cache, isBusy, onClear }: {
  cache?: ArtifactCacheSummary; isBusy: boolean; onClear: () => void;
}): ReactNode {
  if (!cache?.assets.length) return null;
  return <section className="device-card" aria-label="保留的工具下载">
    <strong>保留的下载 · {cacheBytes(cache.totalBytes)}</strong>
    <ul>{cache.assets.map((asset) => <li key={asset.id}>
      {asset.name} · {cacheBytes(asset.downloadedBytes)} / {cacheBytes(asset.totalBytes)}
      {asset.state === "verified" ? " · 已校验，可复用" : " · 可继续下载"}
    </li>)}</ul>
    <p className="hint">暂停、网络中断或重启后保留数据；点击安装继续。打开此窗口不会自动下载。服务器不支持续传时会重新下载对应文件。</p>
    <button className="button" disabled={isBusy} onClick={onClear}>清除下载缓存</button>
  </section>;
}
