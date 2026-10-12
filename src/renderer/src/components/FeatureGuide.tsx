import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import '../styles/feature-guide.css';

const STEPS = [
  {
    title: '准备识别与 AI 服务',
    lines: [
      '在左侧「本地引擎」安装识别模型，或在「API 服务」添加云端识别服务。',
      '需要翻译或 AI 检查时，先添加对应的文本服务；AI 检查是可选功能。',
    ],
  },
  {
    title: '导入并生成字幕',
    lines: [
      '点击「导入视频」选择本地视频，也可以通过「链接导入」下载视频。',
      '导入时选择是否翻译。在左下角「生成设置」选择语言和服务，再点击视频下方的「生成」并确认执行。',
      '原语言模式只使用原文，不会调用翻译服务。',
    ],
  },
  {
    title: '预览与校对',
    lines: [
      '左侧预览视频，右侧校对字幕。点击字幕时间定位，编辑文字和起止时间，勾选字幕可批量处理。',
      '拖动分隔线调整模块宽高；辅助设置可以收起，也可以重置布局。常用校对操作保留在右侧。',
    ],
  },
  {
    title: '检查可疑字幕',
    lines: [
      '运行「AI 检查字幕」；未配置服务时先选择服务。勾选的字幕一次整批检查，未勾选时检查全部，并按统一的可疑度标准筛选结果。',
      '结合视频试听后手工修改、重新处理或忽略问题。忽略项不会主动修复；内容或上下文改变后需要重新评估。',
      'AI 检查只分析文字和时间，不能证明音频识别正确。',
      '视频下方「人名检查」展示常见人名的次数、上下文和推荐值，确认后才批量修改；可撤销最近一次修改，并保留后续人工编辑。',
    ],
  },
  {
    title: '自动循环修复',
    lines: [
      '选择「全部字幕」或指定起止时间，可对同一范围再次修复。默认「中及以上」包含中、高可疑度，默认最多 3 轮，可设置 1–20 轮。',
      '原文或时间问题重新识别，译文问题仅重译；原语言模式不会调用翻译服务。每轮完成后复查，随时可以取消。',
      '跨越边界或重叠的字幕可能扩展实际处理范围，请核对界面显示的实际范围。忽略的相邻字幕也可能受重叠识别影响。',
      '达到轮数上限仍可能有疑点，请查看停止原因和剩余问题；后续失败或取消会保留已完成的轮次。',
    ],
  },
  {
    title: '调整样式并导出',
    lines: [
      '在左下角「样式设置」选择模板、字体和位置，并在预览中确认效果；视频下方「样式」可按描述生成 AI 样式。',
      '视频下方「导出」打开操作面板，选择「独立字幕文件」或「字幕烧录视频」；左侧「导出设置」管理默认参数和保存位置。',
      '关闭导航即可开始操作。之后点击左下角的「?」随时从第一步重新查看；收起侧栏后也可使用。',
    ],
  },
];

type FeatureGuideProps = { onClose: () => void };

/** Informational only: navigation has no project, provider or layout side effects. */
export function FeatureGuide({ onClose }: FeatureGuideProps): ReactNode {
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = STEPS[stepIndex];
  useEffect(() => { headingRef.current?.focus(); }, [stepIndex]);
  if (!step) return null;
  const isLast = stepIndex === STEPS.length - 1;
  return <Modal title="功能导航" onClose={onClose} className="feature-guide">
    <div className="feature-guide__body">
      <p className="feature-guide__progress" role="status" aria-live="polite" aria-atomic="true">
        第 {stepIndex + 1} / {STEPS.length} 步 · {step.title}
      </p>
      <h3 ref={headingRef} tabIndex={-1} className="feature-guide__heading">{step.title}</h3>
      <div className="feature-guide__copy">{step.lines.map((line) => <p key={line}>{line}</p>)}</div>
    </div>
    <footer className="modal__footer feature-guide__footer">
      <button className="button feature-guide__later" onClick={onClose}>稍后再看</button>
      <button className="button" disabled={stepIndex === 0} onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>上一步</button>
      <button className="button button--primary" onClick={isLast ? onClose : () => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}>{isLast ? '完成' : '下一步'}</button>
    </footer>
  </Modal>;
}
