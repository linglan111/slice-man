import type { Stage, StageName, SubtitleStyle } from '../../../shared/contracts';
import { DEFAULT_STYLE } from '../../../shared/contracts';

export const STAGE_LABELS: Record<StageName, string> = { recognize: '语音识别', translate: '字幕翻译', style: 'AI 样式', preview: '参考预览', export: '导出' };
export const STATE_LABELS: Record<Stage['state'], string> = { idle: '待处理', running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
export const TEMPLATE_LABELS: Record<SubtitleStyle['templateId'], string> = { clean: '清晰简洁', cinematic: '电影感', teaching: '教学重点', bold: '醒目粗体', soft: '柔和轻盈' };
export const LANGUAGES = [{ value: 'zh-CN', label: '简体中文' }, { value: 'zh-TW', label: '繁体中文' }, { value: 'en', label: '英语' }, { value: 'ja', label: '日语' }, { value: 'ko', label: '韩语' }, { value: 'es', label: '西班牙语' }, { value: 'fr', label: '法语' }, { value: 'de', label: '德语' }];

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}.${Math.floor(ms % 1000).toString().padStart(3, '0')}`;
}

export function formatBytes(bytes: number): string { return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.ceil(bytes / 1e6)} MB`; }

export function templateStyle(id: SubtitleStyle['templateId']): SubtitleStyle {
  const style: SubtitleStyle = { ...DEFAULT_STYLE, templateId: id, shadow: { ...DEFAULT_STYLE.shadow }, layout: { ...DEFAULT_STYLE.layout }, animation: { ...DEFAULT_STYLE.animation }, emphasisBySegment: [] };
  switch (id) {
    case 'cinematic': return { ...style, fontSizeRatio: .04, fontId: 'managed-cjk', outlineWidthRatio: .001, layout: { ...style.layout, marginBottomRatio: .1 } };
    case 'teaching': return { ...style, textColor: '#FFF5C2', outlineColor: '#143349', fontId: 'managed-cjk-bold', layout: { ...style.layout, marginBottomRatio: .09 } };
    case 'bold': return { ...style, fontSizeRatio: .055, fontId: 'managed-cjk-bold', textColor: '#FFE66D', outlineWidthRatio: .004 };
    case 'soft': return { ...style, textColor: '#E9E5FF', outlineColor: '#353047', outlineWidthRatio: .001, fontSizeRatio: .04 };
    case 'clean': return style;
  }
}

export function validateCueTimes(start: string, end: string, durationMs: number): { startMs: number; endMs: number } | string {
  if (!start.trim() || !end.trim()) return '请填写起止时间。';
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '时间必须为有效秒数。';
  if (startMs < 0 || endMs <= startMs) return '结束时间必须大于开始时间，开始时间不能小于 0。';
  if (endMs > durationMs) return '结束时间不能超过视频时长。';
  return { startMs, endMs };
}
