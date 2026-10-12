import type { ReactNode } from 'react';
import type { ExportSettings } from '../../../shared/export-contracts';

type VideoChoices = Pick<ExportSettings, 'videoCodec' | 'resolution' | 'quality'>;
type Props = { value: VideoChoices; disabled: boolean; onChange: (value: VideoChoices) => void; compact?: boolean };
const CODECS: ExportSettings['videoCodec'][] = ['original', 'h264', 'h265'];
const RESOLUTIONS: ExportSettings['resolution'][] = ['original', '360p', '480p', '720p', '1080p', '1440p', '2160p'];
const QUALITIES: ExportSettings['quality'][] = ['balanced', 'high', 'small'];

export function ExportVideoOptions({ value, disabled, onChange, compact = false }: Props): ReactNode {
  return <>
    <label>视频编码<select aria-label="视频编码" disabled={disabled} value={value.videoCodec} onChange={(event) => { const next = CODECS.find((codec) => codec === event.target.value); if (next) onChange({ ...value, videoCodec: next }); }}><option value="original">原编码（同类型重新编码）</option><option value="h264">H.264</option><option value="h265">H.265</option></select></label>
    <label>导出分辨率<select aria-label="导出分辨率" disabled={disabled} value={value.resolution} onChange={(event) => { const next = RESOLUTIONS.find((resolution) => resolution === event.target.value); if (next) onChange({ ...value, resolution: next }); }}>{RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution === 'original' ? '原分辨率' : `最高 ${resolution}${resolution === '1080p' ? '（默认）' : ''}`}</option>)}</select></label>
    <label>画质<select aria-label="画质" disabled={disabled} value={value.quality} onChange={(event) => { const next = QUALITIES.find((quality) => quality === event.target.value); if (next) onChange({ ...value, quality: next }); }}><option value="balanced">均衡 · 推荐</option><option value="high">高质量</option><option value="small">较小文件</option></select></label>
    {compact ? <details className="export-form__encoding-help"><summary>视频会重新编码 · 查看说明</summary><p className="hint">字幕永久烧入画面。原编码保留受支持的来源编码类型；遇到不支持的来源或容器组合，请选择 H.264 或 H.265。保持画面比例，低于分辨率上限的原片不会放大。</p></details> : <p className="hint">字幕永久烧入画面，所有视频都需要重新编码。原编码保留受支持的来源编码类型；遇到不支持的来源或容器组合，请选择 H.264 或 H.265。保持画面比例，低于分辨率上限的原片不会放大。</p>}
  </>;
}
