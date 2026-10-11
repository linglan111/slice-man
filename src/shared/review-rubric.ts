import { z } from "zod";

export const REVIEW_RUBRIC_VERSION = "contextual-review-v1";
export const reviewRiskLevelSchema = z.enum(["none", "low", "medium", "high"]);
export type ReviewRiskLevel = z.infer<typeof reviewRiskLevelSchema>;
export const REVIEW_RISK_LABELS: Record<ReviewRiskLevel, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
};
export const REVIEW_RISK_RANK: Record<ReviewRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};
export const REVIEW_RULE_IDS = [
  "source.minor_wording",
  "source.weak_coherence",
  "source.context_inconsistency",
  "source.suspected_omission",
  "source.meaning_problem",
  "source.sustained_breakdown",
  "translation.minor_wording",
  "translation.meaning_problem",
  "translation.negation_contradiction",
  "translation.key_numeric_contradiction",
  "timing.minor_flow",
  "timing.readability_concern",
  "timing.severe_readability",
] as const;
export const reviewRuleIdSchema = z.enum(REVIEW_RULE_IDS);
export type ReviewRuleId = z.infer<typeof reviewRuleIdSchema>;
export const reviewRuleSchema = z
  .object({
    ruleId: z.string().min(1).max(100),
    category: z.enum(["source", "translation", "timing"]),
    riskLevel: z.enum(["low", "medium", "high"]),
    description: z.string(),
    example: z.string(),
    counterexample: z.string(),
  })
  .strict();
export type ReviewRule = z.infer<typeof reviewRuleSchema>;
export const REVIEW_RULES: readonly ReviewRule[] = [
  {
    ruleId: "source.minor_wording",
    category: "source",
    riskLevel: "low",
    description: "轻微错字、标点或措辞问题，意思仍明确",
    example: "明确的同音错字或多余标点",
    counterexample: "陌生人名、方言与口语习惯本身不是错误",
  },
  {
    ruleId: "source.weak_coherence",
    category: "source",
    riskLevel: "low",
    description: "只有较弱的衔接疑点，没有具体含义冲突",
    example: "连接词略显生硬，但语意可理解",
    counterexample: "话题切换、引语、幽默、省略本身不构成高风险",
  },
  {
    ruleId: "source.context_inconsistency",
    category: "source",
    riskLevel: "medium",
    description: "指出与具体相邻字幕的矛盾，需试听确认",
    example: "同一对象在相邻句被赋予互相冲突的行为",
    counterexample: "单句低相关、视角变化或引用他人观点不能证明矛盾",
  },
  {
    ruleId: "source.suspected_omission",
    category: "source",
    riskLevel: "medium",
    description: "有具体衔接证据的疑似漏词或断句，无法据此证明漏识别",
    example: "相邻句连续列举，当前句缺少使句意成立的成分",
    counterexample: "视频里的空白间隔、自然停顿或口语省略不证明漏字",
  },
  {
    ruleId: "source.meaning_problem",
    category: "source",
    riskLevel: "medium",
    description: "具体词句导致明显理解障碍，但未达到持续崩坏证据",
    example: "当前句出现无法合理解析的词组，邻句可提供解释线索",
    counterexample: "专业术语、专名、笑话不能仅因不熟悉被判错",
  },
  {
    ruleId: "source.sustained_breakdown",
    category: "source",
    riskLevel: "high",
    description:
      "严重语义崩坏；必须有目标句及至少两条前后相邻字幕共同支持同一具体解释",
    example: "目标句成为无意义词串，前后两句明确延续同一说明",
    counterexample:
      "一条不相关字幕、话题变化、引用、幽默、省略或专名绝不能单独评高",
  },
  {
    ruleId: "translation.minor_wording",
    category: "translation",
    riskLevel: "low",
    description: "译文意思保留，仅有轻微措辞或标点问题",
    example: "略生硬但忠实的译法",
    counterexample: "合理意译与不同表达习惯不构成错误",
  },
  {
    ruleId: "translation.meaning_problem",
    category: "translation",
    riskLevel: "medium",
    description: "明确指出原文与已有译文的具体意义、遗漏或可读性问题",
    example: "译文遗漏一个影响理解的条件",
    counterexample: "仅因逐字不对应不能认为意译错误",
  },
  {
    ruleId: "translation.negation_contradiction",
    category: "translation",
    riskLevel: "high",
    description: "有强文本证据表明关键否定、允许/禁止或肯定关系被颠倒",
    example: "原文明确禁止进入，译文变成允许进入",
    counterexample: "反问、引用、双重否定或上下文反转需谨慎，证据不足降级",
  },
  {
    ruleId: "translation.key_numeric_contradiction",
    category: "translation",
    riskLevel: "high",
    description:
      "原文和已有译文的关键数量、价格、日期等明确矛盾，排除单位换算与格式变化",
    example: "字幕数量从 12 变为 120",
    counterexample: "1000m 与 1km、日期格式或无关数字不是矛盾",
  },
  {
    ruleId: "timing.minor_flow",
    category: "timing",
    riskLevel: "low",
    description: "时轴略影响阅读节奏，含义与阅读仍基本可用",
    example: "很短间隔可能使阅读衔接略生硬",
    counterexample: "自然停顿、换人说话或叠加字幕本身不算异常",
  },
  {
    ruleId: "timing.readability_concern",
    category: "timing",
    riskLevel: "medium",
    description: "具体的显示时间/文本量关系导致明显阅读困难，需播放确认",
    example: "较长一句在不足一秒内显示",
    counterexample: "短词或歌词闪现不能直接认为错误",
  },
  {
    ruleId: "timing.severe_readability",
    category: "timing",
    riskLevel: "high",
    description:
      "明确严重不可读：主字幕文本至少20个非空Unicode字符，且显示不超过500ms或每秒至少45字符",
    example: "40个字符只显示400ms",
    counterexample: "短口语/词语闪现、源文与译文合理差异不能单独评高",
  },
];
export const REVIEW_RUBRIC = {
  version: REVIEW_RUBRIC_VERSION,
  rules: REVIEW_RULES,
};
