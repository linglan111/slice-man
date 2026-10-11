import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppApi, Job, Profile, RuntimeStatus, Segment, StageName, ReprocessTarget } from '../../shared/contracts';
import { requireResult } from './lib/api-result';
import { formatTime, STAGE_LABELS, STATE_LABELS } from './lib/presentation';
import { JobSettings } from './components/JobSettings';
import { SubtitleList } from './components/SubtitleList';
import { StylePanel } from './components/StylePanel';
import { ProfileEditor } from './components/ProfileEditor';
import { ProfileManager } from './components/ProfileManager';
import { RuntimeDialog } from './components/RuntimeDialog';
import { SegmentEditor } from './components/SegmentEditor';
import { ExportDialog } from './components/ExportDialog';
import { RecognitionResetDialog } from './components/RecognitionResetDialog';
import { LiveVideoPreview } from './components/LiveVideoPreview';
import { DownloaderDialog } from './components/DownloaderDialog';
import { OnlineImportDialog } from './components/OnlineImportDialog';
import { ExportSettingsDialog } from './components/ExportSettingsDialog';
import { LocalImportDialog } from './components/LocalImportDialog';
import { ReprocessingPanel } from './components/ReprocessingPanel';
import { Icon } from './components/Icon';
import appIcon from './assets/app-icon.svg';

type Dialog = 'profiles' | 'profile-edit' | 'runtime' | 'export' | 'export-subtitle' | 'export-settings' | 'downloader' | 'online-import' | 'local-import' | null;
type RecognitionTarget = Parameters<AppApi['jobs']['recognizeAgain']>[0] & { recognition: 'local' | 'cloud'; subtitleCount: number; hasEmphasis: boolean };
type EditTarget = { segment: Segment; revision: number; jobId: string; source: string; durationMs: number; location: 'preview' | 'list'; isNew: boolean };
const WORKFLOW_STAGES: StageName[] = ['recognize', 'translate', 'export'];

export function App(): ReactNode {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem('slice-man.sidebar-collapsed') === 'true');
  const [partialRange, setPartialRange] = useState<{ startMs: number; endMs: number } | undefined>();
  const [partialOperation, setPartialOperation] = useState<'recognize' | 'translate' | null>(null);
  const [reviewProgress, setReviewProgress] = useState<{ progress: number; message: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editingProfile, setEditingProfile] = useState<Profile>();
  const [editingSegment, setEditingSegment] = useState<EditTarget | null>(null);
  const [recognitionTarget, setRecognitionTarget] = useState<RecognitionTarget | null>(null);
  const [busy, setBusy] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [installProgress, setInstallProgress] = useState<{ progress: number; message: string } | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const job = jobs.find((item) => item.id === selectedJobId);
  const isRunning = Boolean(busy) || Boolean(job && Object.values(job.stages).some((stage) => stage.state === 'running'));
  const canRecognize = Boolean(job && (job.options.recognition === 'cloud' ? job.options.recognitionProfileId : runtime?.cpuReady && runtime.installedModels.includes(job.options.modelId)));
  const canGenerate = Boolean(job && (job.options.translationEnabled ? job.options.translationProfileId && (job.segments.length > 0 ? job.stages.recognize.state === 'succeeded' : job.stages.recognize.state !== 'succeeded' && canRecognize) : !job.segments.length && job.stages.recognize.state !== 'succeeded' && canRecognize));
  const visibleStages = WORKFLOW_STAGES.filter((name) => name !== 'translate' || job?.options.translationEnabled);
  useEffect(() => { localStorage.setItem('slice-man.sidebar-collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed]);

  function commitJob(next: Job): void {
    setJobs((current) => {
      const previous = current.find((item) => item.id === next.id);
      if (previous && (previous.revision > next.revision || previous.updatedAt > next.updatedAt)) return current;
      return [next, ...current.filter((item) => item.id !== next.id)];
    });
  }

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.api.onProgress((event) => {
      if (!isMounted) return;
      if (event.stage === 'review') setReviewProgress({ progress: event.progress, message: event.message });
      if (event.stage === 'install') setInstallProgress({ progress: event.progress, message: event.message });
      if (event.job) commitJob(event.job);
    });
    async function load(): Promise<void> {
      try {
        const [savedJobs, savedProfiles, status] = await Promise.all([requireResult(window.api.jobs.list()), requireResult(window.api.profiles.list()), requireResult(window.api.runtime.status())]);
        if (isMounted) { setJobs(savedJobs); setProfiles(savedProfiles); setRuntime(status); setSelectedJobId(savedJobs[0]?.id ?? ''); }
      } catch (cause) { if (isMounted) setError(cause instanceof Error ? cause.message : '应用初始化失败，请重新启动。'); }
      finally { if (isMounted) setIsLoading(false); }
    }
    void load();
    return () => { isMounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setPlaybackUrl(''); setPlaybackError(''); setCurrentTimeMs(0); setSelectedIds([]); setActiveIds([]); setPartialOperation(null); setPartialRange(undefined); setReviewProgress(null);
    if (selectedJobId) {
      void requireResult(window.api.jobs.playback(selectedJobId)).then((result) => { if (isCurrent) setPlaybackUrl(result.url); }).catch((cause: unknown) => { if (isCurrent) setPlaybackError(cause instanceof Error ? cause.message : '无法创建视频预览。'); });
    }
    return () => { isCurrent = false; };
  }, [selectedJobId]);

  useEffect(() => { setEditingSegment(null); }, [selectedJobId, playbackUrl]);
  useEffect(() => { if (job && !job.options.translationEnabled && partialOperation === 'translate') setPartialOperation(null); }, [job, partialOperation]);

  async function perform(label: string, action: () => Promise<void>, shouldRethrow = false): Promise<void> {
    setBusy(label); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); if (shouldRethrow) throw cause; }
    finally { setBusy(''); }
  }

  function importVideo(): void { setDialog('local-import'); }
  async function generate(): Promise<void> {
    if (!job) return;
    const current = job;
    await perform('生成字幕', async () => {
      if (!current.segments.length) commitJob(await requireResult(window.api.jobs.recognize(current.id)));
      if (current.options.translationEnabled) commitJob(await requireResult(window.api.jobs.translate({ jobId: current.id, ...(current.stages.translate.state === 'succeeded' ? { segmentIds: current.segments.map((segment) => segment.id) } : {}) })));
      setNotice('字幕已生成，可校对文字和时间，再选择样式。');
    });
  }
  async function retry(): Promise<void> {
    if (!job) return;
    const current = job;
    if (['failed', 'cancelled', 'interrupted'].includes(current.stages.export.state)) { setDialog('export'); return; }
    if (current.segments.length) return;
    await generate();
  }
  async function recognizeAgain(target: RecognitionTarget): Promise<void> {
    if (isRunning) return;
    setRecognitionTarget(null);
    await perform('重新识别', async () => {
      try {
        commitJob(await requireResult(window.api.jobs.recognizeAgain({ jobId: target.jobId, revision: target.revision })));
        setSelectedIds([]);
        setNotice(`原片已重新识别，旧译文和手工校对已替换。${job?.options.translationEnabled ? '不会自动翻译，请检查新字幕，再点击“翻译全部字幕”；' : '请检查新原文字幕；'}导出需要重新生成。`);
      } catch (cause) {
        throw new Error(`重新识别未完成，本次操作未替换已有字幕和校对结果。${cause instanceof Error ? cause.message : '请重试。'}`, { cause });
      }
    });
  }
  function openPartial(ids: string[], operation: 'recognize' | 'translate'): void { setPartialRange(undefined); videoRef.current?.pause(); setSelectedIds(ids); setPartialOperation(operation); }
  async function executePartial(target: ReprocessTarget, translate: boolean): Promise<void> {
    if (!job || !partialOperation) return;
    const operation = partialOperation; const current = job;
    await perform(operation === 'recognize' ? '重新识别片段' : '重新翻译片段', async () => {
      const input = { jobId: current.id, revision: current.revision, target };
      const next = await requireResult(operation === 'recognize' ? window.api.jobs.recognizePartial({ ...input, translate }) : window.api.jobs.translatePartial(input));
      commitJob(next); setSelectedIds([]); setPartialOperation(null);
      setNotice(operation === 'recognize' ? '片段已重新识别，请试听并复核新字幕；范围外内容保留。' : '所选字幕已重新翻译，请复核译文。');
    }, true);
  }
  function seek(ms: number): void { if (videoRef.current) videoRef.current.currentTime = ms / 1000; }
  function editSegment(segment: Segment, location: 'preview' | 'list'): void {
    if (!job || isRunning) return;
    videoRef.current?.pause();
    setEditingSegment({ segment: { ...segment }, revision: job.revision, jobId: job.id, source: playbackUrl, durationMs: job.media.durationMs, location, isNew: false });
  }
  function addSegment(location: 'preview' | 'list'): void {
    if (!job || isRunning) return;
    const actualMs = (videoRef.current?.currentTime ?? 0) * 1000;
    const startMs = Math.max(0, Math.min(job.media.durationMs - 1, Number.isFinite(actualMs) ? Math.floor(actualMs) : 0));
    videoRef.current?.pause();
    setEditingSegment({ segment: { id: 'new-draft', startMs, endMs: Math.min(job.media.durationMs, startMs + 2000), sourceText: '', translatedText: '', translationStale: false }, revision: job.revision, jobId: job.id, source: playbackUrl, durationMs: job.media.durationMs, location, isNew: true });
  }
  async function removeSegment(segment: Segment): Promise<void> {
    if (!job || isRunning) throw new Error('当前正在处理，请稍后再删除字幕。');
    const next = await requireResult(window.api.jobs.removeSegment({ jobId: job.id, revision: job.revision, segmentId: segment.id }));
    commitJob(next); setSelectedIds((ids) => ids.filter((id) => id !== segment.id));
    setEditingSegment((current) => current?.jobId === job.id && current.segment.id === segment.id ? null : current);
  }
  const editor = editingSegment && job?.id === editingSegment.jobId && playbackUrl === editingSegment.source ? <SegmentEditor key={`${editingSegment.jobId}-${editingSegment.segment.id}-${editingSegment.revision}-${editingSegment.location}`} segment={editingSegment.segment} durationMs={editingSegment.durationMs} translationEnabled={job.options.translationEnabled} isBusy={isRunning} isNew={editingSegment.isNew} onClose={() => setEditingSegment((current) => current === editingSegment ? null : current)} onDelete={editingSegment.isNew ? undefined : async () => {
    if (isRunning) throw new Error('当前正在处理，请稍后再删除字幕。');
    const next = await requireResult(window.api.jobs.removeSegment({ jobId: editingSegment.jobId, revision: editingSegment.revision, segmentId: editingSegment.segment.id }));
    commitJob(next); setSelectedIds((ids) => ids.filter((id) => id !== editingSegment.segment.id));
  }} onSave={async (segment) => {
    if (isRunning) throw new Error('当前正在处理，请稍后再保存字幕。');
    const next = await requireResult(editingSegment.isNew ? window.api.jobs.addSegment({ jobId: editingSegment.jobId, revision: editingSegment.revision, segment: { startMs: segment.startMs, endMs: segment.endMs, sourceText: segment.sourceText, translatedText: segment.translatedText } }) : window.api.jobs.editSegment({ jobId: editingSegment.jobId, segment, revision: editingSegment.revision }));
    commitJob(next);
  }} /> : null;

  return <div className={`app-shell ${isSidebarCollapsed ? 'app-shell--collapsed' : ''}`}><aside className="sidebar"><div className="brand"><img className="brand__mark" src={appIcon} alt="" /><div className="sidebar__label"><strong>Slice Man</strong><small>识别、翻译、校对，一站完成</small></div></div>
    <button className="sidebar-link sidebar__toggle" aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setIsSidebarCollapsed((value) => !value)}><Icon name={isSidebarCollapsed ? 'expand' : 'collapse'} /><span className="sidebar__label">收起侧边栏</span></button>
    <button className="button button--primary sidebar__import" aria-label="导入视频" title="导入视频" disabled={isRunning} onClick={importVideo}><Icon name="import" /><span className="sidebar__label">导入视频</span></button>
    <button className="button sidebar__import" aria-label="链接导入" title="链接导入" disabled={isRunning} onClick={() => setDialog('online-import')}><Icon name="link" /><span className="sidebar__label">链接导入</span></button>
    <div className="sidebar__section-title"><span className="sidebar__label">最近项目</span><span>{jobs.length}</span></div>
    <nav className="history-list" aria-label="项目历史">{jobs.map((item) => <button aria-label={item.name} title={item.name} aria-current={item.id === selectedJobId ? 'page' : undefined} className={`history-item ${item.id === selectedJobId ? 'history-item--active' : ''}`} disabled={isRunning} key={item.id} onClick={() => setSelectedJobId(item.id)}><Icon name="video" /><span className="sidebar__label"><strong>{item.name}</strong><small>{formatTime(item.media.durationMs)} · {item.segments.length} 条字幕</small></span></button>)}{!jobs.length && <p className="sidebar__empty sidebar__label">导入后，项目与处理进度<br />会保存在这台电脑。</p>}</nav>
    <footer className="sidebar__footer"><button className="sidebar-link" aria-label="本地引擎" title="本地引擎" onClick={() => setDialog('runtime')}><Icon name="engine" /><span className="sidebar__label">本地引擎</span><span className={`status-dot ${runtime?.cpuReady ? 'status-dot--ready' : ''}`} /></button><button className="sidebar-link" aria-label="API 服务" title="API 服务" onClick={() => setDialog('profiles')}><Icon name="settings" /><span className="sidebar__label">API 服务</span></button><button className="sidebar-link" aria-label="链接导入设置" title="链接导入设置" onClick={() => setDialog('downloader')}><Icon name="download" /><span className="sidebar__label">链接导入设置</span></button><button className="sidebar-link" aria-label="导出设置" title="导出设置" onClick={() => setDialog('export-settings')}><Icon name="export" /><span className="sidebar__label">导出设置</span></button><p className="sidebar__label">Windows 桌面版 · v0.1</p></footer>
  </aside><main className="main-workspace"><header className="workspace-header"><div><span className="eyebrow">SUBTITLE STUDIO</span><h1>{job?.name ?? '识别、翻译、校对，一站完成'}</h1><p>{job ? `${job.media.width} × ${job.media.height} · ${formatTime(job.media.durationMs)}${job.actualBackend ? ` · 识别后端 ${job.actualBackend.toUpperCase()}` : ''}` : '识别、翻译、校对，让字幕成为视频的一部分。'}</p></div>
    {job && <div className="workspace-export-actions"><button className="button" disabled={isRunning || !job.segments.length} onClick={() => setDialog('export-subtitle')}>导出字幕文件</button><button className="button button--primary" aria-label="导出作品" disabled={isRunning || !job.segments.length} onClick={() => setDialog('export')}>导出作品 ↗</button></div>}</header>
    {error && <div className="banner banner--error" role="alert"><div><strong>需要处理的问题</strong><p>{error}</p></div><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="banner banner--success" role="status">{notice}<button className="icon-button" aria-label="关闭成功提示" onClick={() => setNotice('')}>×</button></div>}
    {isRunning && job && <div className="processing-strip" role="status"><span>{busy || '正在处理'}{busy === 'AI 检查字幕' && reviewProgress ? ` · ${reviewProgress.message}` : '…'}</span><button className="text-button" onClick={() => { void requireResult(window.api.jobs.cancel(job.id)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '取消失败')); }}>取消当前处理</button></div>}
    {isLoading ? <div className="loading-state" role="status">正在读取本地项目与引擎状态…</div> : job ? <>
      <div className="stage-strip" aria-label="处理进度">{visibleStages.map((name, index) => <div key={name} className={`stage-pill stage-pill--${job.stages[name].state}`}><span>{job.stages[name].state === 'succeeded' ? '✓' : index + 1}</span><div><strong>{STAGE_LABELS[name]}</strong><small>{STATE_LABELS[job.stages[name].state]}</small></div></div>)}</div>
      <div className="work-grid"><div className="work-grid__content"><section className="preview-panel" aria-label="视频预览"><div className="section-heading"><h2>视频预览</h2><span className="preview-tag">实时字幕 · 点击字幕校对</span></div>
        <div className="video-stage">{playbackUrl ? <LiveVideoPreview key={`${job.id}-${playbackUrl}`} job={job} source={playbackUrl} videoRef={videoRef} isBusy={isRunning} onEdit={(segment) => editSegment(segment, 'preview')} onActiveChange={setActiveIds} onTimeUpdate={setCurrentTimeMs} onError={() => setPlaybackError('此视频无法在播放器中播放，请重新生成兼容预览或检查原片是否已移动。')} /> : <p>{playbackError || '准备兼容视频预览…'}</p>}</div>
        {playbackError && <><p className="error-message" role="alert">{playbackError}</p><button className="button" disabled={isRunning} onClick={() => void perform('重新加载视频', async () => { const result = await requireResult(window.api.jobs.playback(job.id)); setPlaybackUrl(result.url); setPlaybackError(''); })}>重新加载视频预览</button></>}
        <div className="preview-tools"><span>当前位置 {formatTime(currentTimeMs)}</span><button className="button" disabled={isRunning || !canRecognize} onClick={() => openPartial(selectedIds, 'recognize')}><Icon name="recognize" />重新识别片段</button>{job.options.translationEnabled && <button className="button" disabled={isRunning || !job.options.translationProfileId || !job.segments.length} onClick={() => openPartial(selectedIds, 'translate')}><Icon name="translate" />重新翻译片段</button>}<button className="button" aria-label="添加画面字幕" disabled={isRunning} onClick={() => addSegment('preview')}>＋ 添加画面字幕</button></div><p className="hint">全屏仅播放，退出全屏后可校对。</p>
        {partialOperation && <ReprocessingPanel key={`${job.id}-${partialOperation}-${partialRange?.startMs ?? 'selection'}`} initialRange={partialRange} job={job} operation={partialOperation} selectedIds={selectedIds} currentTimeMs={currentTimeMs} isBusy={isRunning} onClose={() => setPartialOperation(null)} onExecute={executePartial} />}
        {editingSegment?.location === 'preview' && <div className="preview-editor">{editor}</div>}
      </section><SubtitleList key={job.id} job={job} selectedIds={selectedIds} activeIds={activeIds} isBusy={isRunning} isEditing={Boolean(editor)} editingId={editingSegment?.location === 'list' && !editingSegment.isNew ? editingSegment.segment.id : undefined} draftStartMs={editingSegment?.location === 'list' && editingSegment.isNew ? editingSegment.segment.startMs : undefined} editor={editingSegment?.location === 'list' ? editor : null} onAdd={() => addSegment('list')} onRemove={(segment) => void perform('删除字幕', async () => removeSegment(segment))} onSelectMany={(ids) => { videoRef.current?.pause(); setSelectedIds(ids); }} onSelect={(id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])} onEdit={(segment) => editSegment(segment, 'list')} onSeek={seek} onPlay={(ms) => { seek(ms); void videoRef.current?.play().catch(() => setPlaybackError('暂时无法播放，请使用播放器播放按钮。')); }} onRepair={openPartial} onRepairRange={(range) => { videoRef.current?.pause(); setSelectedIds([]); setPartialRange(range); setPartialOperation('recognize'); }} onReview={(ids) => { setReviewProgress(null); void perform('AI 检查字幕', async () => { commitJob(await requireResult(window.api.jobs.reviewSubtitles({ jobId: job.id, revision: job.revision, ...(ids?.length ? { segmentIds: ids } : {}) }))); setNotice('AI 检查完成，提示为可疑项，请试听确认。'); }); }} onIgnore={(finding) => { const report = job.reviewReport; if (report) void perform('忽略提示', async () => commitJob(await requireResult(window.api.jobs.acknowledgeFinding({ jobId: job.id, reportId: report.id, findingId: finding.id, status: 'ignored' })))); }} onRetranslate={() => openPartial(selectedIds, 'translate')} />

      </div><aside className="work-grid__settings"><JobSettings job={job} profiles={profiles} runtime={runtime} isBusy={isRunning} onChange={(options) => void perform('保存设置', async () => commitJob(await requireResult(window.api.jobs.updateOptions({ jobId: job.id, options }))))} onInstall={() => setDialog('runtime')} onProfiles={() => setDialog('profiles')} />
      <div className="generate-controls"><button className="button button--primary" disabled={isRunning || !canGenerate} onClick={() => void generate()}>{isRunning ? `${busy || '处理中'}…` : job.segments.length ? job.options.translationEnabled ? '翻译全部字幕' : '原文字幕已就绪' : '一键生成字幕'}</button>{!canGenerate && <p className="hint">{!job.options.translationEnabled && job.segments.length ? '原文字幕可直接校对、选择样式和导出。' : job.segments.length && job.stages.recognize.state !== 'succeeded' ? '识别设置已变化，请先重新识别原片，再翻译。' : '可添加手工字幕并配置翻译服务，或选择识别服务生成字幕。'}</p>}
        {(job.segments.length > 0 || job.stages.recognize.state === 'succeeded') && <button className="text-button" disabled={isRunning || !canRecognize} onClick={() => setRecognitionTarget({ jobId: job.id, revision: job.revision, recognition: job.options.recognition, subtitleCount: job.segments.length, hasEmphasis: job.style.emphasisBySegment.length > 0 })}>重新识别原片</button>}
        {!isRunning && (!job.segments.length || ['failed', 'cancelled', 'interrupted'].includes(job.stages.export.state)) && visibleStages.some((name) => ['failed', 'cancelled', 'interrupted'].includes(job.stages[name].state)) && <button className="button" onClick={() => void retry()}>重试未完成阶段</button>}
        {Object.entries(job.stages).filter(([name, stage]) => name !== 'preview' && (name !== 'translate' || job.options.translationEnabled) && stage.message && stage.state !== 'idle').map(([name, stage]) => <div key={name} className={`stage-detail stage-detail--${stage.state}`}><strong>{STAGE_LABELS[name as StageName]}</strong><p>{stage.message}</p>{stage.state === 'running' && <progress max={1} value={stage.progress} />}</div>)}
      {busy === 'AI 检查字幕' && reviewProgress && <div className="stage-detail" role="status"><strong>AI 检查</strong><p>{reviewProgress.message}</p><progress max={1} value={reviewProgress.progress} /></div>}</div><StylePanel key={job.id} job={job} selectedIds={selectedIds} isBusy={isRunning} onStyle={(style) => void perform('保存样式', async () => commitJob(await requireResult(window.api.jobs.setStyle({ jobId: job.id, style }))))} onBilingual={(bilingual) => void perform('保存双语设置', async () => commitJob(await requireResult(window.api.jobs.updateOptions({ jobId: job.id, options: { ...job.options, bilingual } }))))} onDesign={(prompt) => void perform('AI 设计样式', async () => { commitJob(await requireResult(window.api.jobs.designStyle({ jobId: job.id, prompt }))); setNotice('AI 样式已通过验证，可在视频预览中查看。'); })} />
      {job.outputs.length > 0 && <section className="outputs-panel"><h2>已导出文件</h2>{job.outputs.map((path, index) => <p key={`${path}-${index}`} title={path}>✓ <span>{path}</span></p>)}</section>}
      </aside></div>
    </> : <section className="welcome"><div className="welcome__art"><div className="welcome__frame"><span>▶</span><div className="welcome__caption">让每一句话，都被看见。</div></div><span className="welcome__spark">✧</span></div><span className="eyebrow">ONE VIDEO. MORE POSSIBILITIES.</span><h2>从一个视频开始</h2><p>识别原片，按需翻译内容。<br />校对、选择样式，然后导出带字幕的视频。</p><button className="button button--primary button--large" disabled={Boolean(busy)} onClick={() => void importVideo()}>＋ 选择本地视频</button><small>MP4 · MKV · MOV · WebM，取决于视频编码支持</small><div className="welcome__steps"><span>01 识别 · 按需翻译</span><span>02 校对与设计</span><span>03 永久字幕导出</span></div></section>}
  </main>
  {dialog === 'local-import' && <LocalImportDialog onClose={() => setDialog(null)} onImported={(imported) => { commitJob(imported); setSelectedJobId(imported.id); setDialog(null); }} />}
  {dialog === 'profiles' && <ProfileManager profiles={profiles} onClose={() => setDialog(null)} onEdit={(profile) => { setEditingProfile(profile); setDialog('profile-edit'); }} onTest={async (id, purpose) => (await requireResult(window.api.profiles.test(id, purpose))).message} onRemove={async (id) => { await requireResult(window.api.profiles.remove(id)); setProfiles(await requireResult(window.api.profiles.list())); }} />}
  {dialog === 'profile-edit' && <ProfileEditor profile={editingProfile} onClose={() => setDialog('profiles')} onSave={async (profile) => {
    await requireResult(window.api.profiles.save(profile));
    const [savedProfiles, savedJobs] = await Promise.all([requireResult(window.api.profiles.list()), requireResult(window.api.jobs.list())]);
    setProfiles(savedProfiles); setJobs(savedJobs);
  }} />}
  {dialog === 'runtime' && <RuntimeDialog runtime={runtime} progress={installProgress} onClose={() => setDialog(null)} onInstall={async (modelId, preferGpu) => { setInstallProgress(null); setRuntime(await requireResult(window.api.runtime.install({ modelId, preferGpu }))); }} onCancel={() => { void requireResult(window.api.runtime.cancel()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '取消安装失败')); }} />}
  {dialog === 'downloader' && <DownloaderDialog onClose={() => setDialog(null)} />}
  {dialog === 'online-import' && <OnlineImportDialog onClose={() => setDialog(null)} onImported={(imported) => { commitJob(imported); setSelectedJobId(imported.id); setDialog(null); setNotice('视频已下载并导入，可以添加字幕或识别原片。'); }} />}
  {dialog === 'export-settings' && <ExportSettingsDialog onClose={() => setDialog(null)} />}
  {(dialog === 'export' || dialog === 'export-subtitle') && job && <ExportDialog jobId={job.id} initialKind={dialog === 'export-subtitle' ? 'subtitle' : 'video'} onClose={() => setDialog(null)} onExport={async (input) => {
    setBusy('导出');
    try { const output = await requireResult(window.api.jobs.export(input)); commitJob(await requireResult(window.api.jobs.get(input.jobId))); if (output) setNotice(`导出完成：${output.path}`); return Boolean(output); }
    finally { setBusy(''); }
  }} />}
  {recognitionTarget && <RecognitionResetDialog recognition={recognitionTarget.recognition} subtitleCount={recognitionTarget.subtitleCount} hasEmphasis={recognitionTarget.hasEmphasis} isBusy={isRunning} onClose={() => setRecognitionTarget(null)} onConfirm={() => void recognizeAgain(recognitionTarget)} />}
  </div>;
}

