import type { ReactNode } from 'react';
import { REVIEW_RISK_LABELS } from '../../../shared/contracts';
import type { ReviewGradeView } from '../lib/review-presentation';

export function ReviewGrade({ view }: { view: ReviewGradeView }): ReactNode {
  if (view.state === 'unreviewed') return <span className="review-grade review-grade--unreviewed" aria-label="未检查">未检查</span>;
  if (view.state === 'legacy') return <span className="review-grade review-grade--legacy" aria-label="待重新检查" title="旧版检查未提供每条字幕的分级">待重新检查</span>;
  const label = view.riskLevel ? REVIEW_RISK_LABELS[view.riskLevel] : '';
  if (view.state === 'stale') return <span className="review-grade review-grade--stale" aria-label={`上次可疑度：${label}，需复查`} title="字幕、上下文或检查配置已变化，旧等级不计入当前统计">上次：{label}<span className="review-grade__recheck">· 需复查</span></span>;
  return <span className={`review-grade review-grade--${view.riskLevel}`} aria-label={`可疑度：${label}`} title={label === '无' ? '未发现明显可疑项；未经音频验证' : '文本与上下文可疑提示，请试听确认'}>可疑度 {label}</span>;
}
