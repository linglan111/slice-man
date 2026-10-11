import type { ReactNode } from 'react';
import { REVIEW_RISK_LABELS, REVIEW_RULES, REVIEW_RUBRIC_VERSION } from '../../../shared/contracts';
import { REVIEW_LEVELS } from '../lib/review-presentation';

export function ReviewRubricHelp({ onClose }: { onClose: () => void }): ReactNode {
  return <section className="review-rubric" aria-label="可疑度判断标准"><div className="review-rubric__head"><h3>可疑度判断标准</h3><button className="icon-button" aria-label="关闭判断标准" onClick={onClose}>×</button></div><p>标准版本：{REVIEW_RUBRIC_VERSION.replace(/^contextual-review-/, '')}</p><p>结合相邻对话检查时轴、原文和已有译文。等级由统一规则确定；这是可疑提示，无法证明音频中实际说了什么。</p>{REVIEW_LEVELS.map((level) => <div className="review-rubric__tier" key={level}><strong>{level === 'none' ? '无 · 未发现明显疑点' : `${REVIEW_RISK_LABELS[level]}可疑度`}</strong>{level === 'none' ? <p>本次检查未发现明显可疑项，仍可人工校对。</p> : <ul>{REVIEW_RULES.filter((rule) => rule.riskLevel === level).map((rule) => <li key={rule.ruleId}>{rule.description}<span className="review-rubric__example">例如：{rule.example}。需排除：{rule.counterexample}。</span></li>)}</ul>}</div>)}</section>;
}
