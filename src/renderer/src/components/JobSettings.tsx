import type { ReactNode } from 'react';
import { optionsSchema, type Job, type JobOptions, type Profile, type RuntimeStatus } from '../../../shared/contracts';
import { LANGUAGES } from '../lib/presentation';

type Props = { job: Job; profiles: Profile[]; runtime: RuntimeStatus | null; isBusy: boolean; onChange: (options: JobOptions) => void; onInstall: () => void; onProfiles: () => void };
export function JobSettings({ job, profiles, runtime, isBusy, onChange, onInstall, onProfiles }: Props): ReactNode {
  const options = job.options;
  function update(patch: Partial<JobOptions>): void { onChange({ ...options, ...patch }); }
  function profileSelect(label: string, key: 'recognitionProfileId' | 'translationProfileId' | 'styleProfileId' | 'reviewProfileId' | 'chapterProfileId', onlyOpenai = false): ReactNode {
    return <label>{label}<select aria-label={label} disabled={isBusy} value={options[key] ?? ''} onChange={(event) => update({ [key]: event.target.value || undefined })}>
      <option value="">选择 API 服务</option>{profiles.filter((profile) => !onlyOpenai || profile.protocol === 'openai').map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>;
  }
  return <section className="settings-panel" aria-label="生成设置">
    <div className="section-heading"><h2>生成设置</h2><span className="eyebrow">WORKFLOW</span></div>
    <div className="form-grid"><label>原语言<select aria-label="原语言" disabled={isBusy} value={options.sourceLanguage} onChange={(event) => update({ sourceLanguage: event.target.value })}><option value="auto">自动检测</option>{LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>
      {options.translationEnabled && <label>目标语言<select aria-label="目标语言" disabled={isBusy} value={options.targetLanguage} onChange={(event) => update({ targetLanguage: event.target.value })}>{LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>}</div>
    <label className="check-label"><input aria-label="翻译字幕" type="checkbox" disabled={isBusy} checked={options.translationEnabled} onChange={(event) => update({ translationEnabled: event.target.checked })} />翻译字幕</label>
    {!options.translationEnabled && <p className="hint">原语言模式 · 生成、修复、预览和导出均使用原文。</p>}
    <label>识别方式<select aria-label="识别方式" disabled={isBusy} value={options.recognition} onChange={(event) => update({ recognition: optionsSchema.shape.recognition.parse(event.target.value) })}><option value="local">本地 Whisper</option><option value="cloud">云端 OpenAI 兼容</option></select></label>
    {options.recognition === 'cloud' ? <>{profileSelect('语音识别服务', 'recognitionProfileId', true)}<p className="hint">会上传提取的音频。请选择支持片段时间戳的模型。</p></> : <>
      <label>本地模型<select aria-label="本地模型" disabled={isBusy} value={options.modelId} onChange={(event) => update({ modelId: optionsSchema.shape.modelId.parse(event.target.value) })}><option value="base">Base · 轻量</option><option value="small">Small · 均衡</option><option value="large-v3-turbo">Large v3 Turbo · 高质量</option></select></label>
      <label className="check-label"><input type="checkbox" disabled={isBusy} checked={options.preferGpu} onChange={(event) => update({ preferGpu: event.target.checked })} />优先使用 NVIDIA GPU</label>
      <div className="runtime-summary"><span className={`status-dot ${runtime?.cpuReady ? 'status-dot--ready' : ''}`} />{runtime?.cpuReady ? `引擎可用 · ${runtime.actualBackend.toUpperCase()}` : '首次使用需安装本地引擎'}</div>
      <button className="button button--subtle" onClick={onInstall}>管理本地引擎与模型</button>
      <p className="hint">本地识别不上传音频；GPU 不可用时自动回退 CPU。</p>
    </>}
    {options.translationEnabled && profileSelect('翻译服务', 'translationProfileId')}
    {profileSelect('AI 检查服务（可选）', 'reviewProfileId')}
    {profileSelect('AI 样式服务（可选）', 'styleProfileId')}
    {profileSelect('章节分析服务（可选）', 'chapterProfileId')}
    <p className="hint">AI 文字操作复用全文章节切分，每次请求提供整章字幕；语音识别和全片人名检查除外。并发上限在 API 服务中设置。未指定章节服务时，使用本次操作所选服务。</p>
    <button className="text-button" onClick={onProfiles}>管理 API 服务 →</button>
  </section>;
}



