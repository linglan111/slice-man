import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppApi, Job, Profile, RuntimeStatus, Segment, StageName, ReprocessTarget, RepairLoopInput } from '../../shared/contracts';
import { requireResult } from './lib/api-result';
import { formatTime, STAGE_LABELS, STATE_LABELS } from './lib/presentation';
import { PaneDivider } from './components/PaneDivider';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import { JobSettings } from './components/JobSettings';
import { SubtitleList } from './components/SubtitleList';
import { StylePanel } from './components/StylePanel';
import { ProfileEditor } from './components/ProfileEditor';
import { ProfileManager } from './components/ProfileManager';
import { RuntimeDialog } from './components/RuntimeDialog';
import { SegmentEditor } from './components/SegmentEditor';
import { ExportDialog, ExportForm } from './components/ExportDialog';
import { RecognitionResetDialog } from './components/RecognitionResetDialog';
import { LiveVideoPreview } from './components/LiveVideoPreview';
import { DownloaderDialog } from './components/DownloaderDialog';
import { OnlineImportDialog } from './components/OnlineImportDialog';
import { ExportSettingsDialog } from './components/ExportSettingsDialog';
import { LocalImportDialog } from './components/LocalImportDialog';
import { ReprocessingPanel } from './components/ReprocessingPanel';
import { PersonNamePanel } from './components/PersonNamePanel';
import { Modal } from './components/Modal';
import { StyleOperation } from './components/StyleOperation';
import type { ChapterExportRun } from '../../shared/chapter-export-contracts';
import { ChapterPanel } from './components/ChapterPanel';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { LIVE_PHASE_LABELS, ProviderLiveDialog } from './components/ProviderLiveDialog';
import { ReviewScopeDialog } from './components/ReviewScopeDialog';
import { useProviderLive } from './hooks/useProviderLive';
import { ChapterExportResults } from './components/ChapterExportResults';
import { ChapterReviewStatus } from './components/ChapterReviewStatus';
import { Icon } from './components/Icon';
import { FeatureGuide } from './components/FeatureGuide';
import { hasSeenFeatureGuide, markFeatureGuideSeen } from './lib/onboarding-preferences';
import { repairRunSummary } from './components/RepairLoopControls';
import appIcon from './assets/app-icon.svg';

type Dialog = 'profiles' | 'profile-edit' | 'runtime' | 'export' | 'export-subtitle' | 'export-settings' | 'downloader' | 'online-import' | 'local-import' | 'guide' | 'generation-settings' | 'style-settings' | 'review-service' | 'review-scope' | 'diagnostics' | 'live-stream' | null;
type RecognitionTarget = Parameters<AppApi['jobs']['recognizeAgain']>[0] & { recognition: 'local' | 'cloud'; subtitleCount: number; hasEmphasis: boolean };
type EditTarget = { segment: Segment; revision: number; jobId: string; source: string; durationMs: number; location: 'preview' | 'list'; isNew: boolean };
const WORKFLOW_STAGES: StageName[] = ['recognize', 'translate', 'export'];
function sidebarPreference(): boolean { try { return localStorage.getItem('slice-man.sidebar-collapsed') === 'true'; } catch { return false; } }

export function App(): ReactNode {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(sidebarPreference);
  const [activeOperation, setActiveOperation] = useState<'generate' | 'style' | 'export' | 'names' | 'chapters' | null>(null);
  const [chapterProgress, setChapterProgress] = useState<{progress: number; message: string} | null>(null);
  const [servicePurpose, setServicePurpose] = useState<'review' | 'names'>('review');
  const [reviewSelection, setReviewSelection] = useState<string[] | undefined>();
  const [reviewRange, setReviewRange] = useState<{ startMs: number; endMs: number } | undefined>();
  const [reviewService, setReviewService] = useState('');
  const [partialRange, setPartialRange] = useState<{ startMs: number; endMs: number } | undefined>();
  const [partialOperation, setPartialOperation] = useState<'recognize' | 'translate' | null>(null);
  const [namesProgress, setNamesProgress] = useState<{ progress: number; message: string; jobId: string } | null>(null);
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
  const [initialized, setInitialized] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(hasSeenFeatureGuide);
  const [guideDecided, setGuideDecided] = useState(hasSeenFeatureGuide);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [installProgress, setInstallProgress] = useState<{ progress: number; message: string } | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectedJobRef = useRef(selectedJobId);
  useEffect(() => { selectedJobRef.current = selectedJobId; }, [selectedJobId]);
  const job = jobs.find((item) => item.id === selectedJobId);
  const hasResults = Boolean(error || notice || busy || chapterProgress || job?.chapterPlan || job?.customChapterPlan || job?.reviewRun || job?.repairRun?.state === 'running' || job?.outputs.length || (job && Object.entries(job.stages).some(([name, stage]) => name !== 'preview' && (name !== 'translate' || job.options.translationEnabled) && stage.message && stage.state !== 'idle')));
  const layout = useWorkspaceLayout(isSidebarCollapsed, job?.id ?? '', Boolean(activeOperation || partialOperation || editingSegment?.location === 'preview'), hasResults);
  const isRunning = Boolean(busy) || Boolean(job && (job.repairRun?.state === 'running' || Object.values(job.stages).some((stage) => stage.state === 'running')));
  const live = useProviderLive(job?.id, isRunning || dialog === 'live-stream');
  const activeLive = live.items.find((item) => item.phase === 'waiting' || item.phase === 'thinking' || item.phase === 'answer');
  const canRecognize = Boolean(job && (job.options.recognition === 'cloud' ? job.options.recognitionProfileId : runtime?.cpuReady && runtime.installedModels.includes(job.options.modelId)));
  const canGenerate = Boolean(job && (job.options.translationEnabled ? job.options.translationProfileId && (job.segments.length > 0 ? job.stages.recognize.state === 'succeeded' : job.stages.recognize.state !== 'succeeded' && canRecognize) : !job.segments.length && job.stages.recognize.state !== 'succeeded' && canRecognize));
  const visibleStages = WORKFLOW_STAGES.filter((name) => name !== 'translate' || job?.options.translationEnabled);
  useEffect(() => { try { localStorage.setItem('slice-man.sidebar-collapsed', String(isSidebarCollapsed)); } catch { /* UI remains usable when preferences cannot be written. */ } }, [isSidebarCollapsed]);

  function commitJob(next: Job): void {
    setJobs((current) => {
      const previous = current.find((item) => item.id === next.id);
      if (previous && (previous.revision > next.revision || previous.updatedAt > next.updatedAt)) return current;
      if (previous?.repairRun && next.repairRun && (previous.repairRun.startedAt > next.repairRun.startedAt || (previous.repairRun.id === next.repairRun.id && previous.repairRun.state !== 'running' && next.repairRun.state === 'running'))) return current;
      return [next, ...current.filter((item) => item.id !== next.id)];
    });
  }

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.api.onProgress((event) => {
      if (!isMounted) return;
      if (event.stage === 'names' && event.jobId === selectedJobRef.current) setNamesProgress({ progress: event.progress, message: event.message, jobId: event.jobId });
      if (event.stage === 'review' && event.jobId === selectedJobRef.current) setReviewProgress({ progress: event.progress, message: event.message });
      if (event.stage === 'install') setInstallProgress({ progress: event.progress, message: event.message });
      if ((event.stage === 'chapters' || event.stage === 'export') && event.jobId === selectedJobRef.current) setChapterProgress({progress: event.progress, message: event.message});
      if (event.job && (event.stage !== 'repair' || (event.jobId === event.job.id && event.repairRunId === event.job.repairRun?.id))) commitJob(event.job);
    });
    async function load(): Promise<void> {
      try {
        const [savedJobs, savedProfiles, status] = await Promise.all([requireResult(window.api.jobs.list()), requireResult(window.api.profiles.list()), requireResult(window.api.runtime.status())]);
        if (isMounted) { setJobs(savedJobs); setProfiles(savedProfiles); setRuntime(status); setSelectedJobId(savedJobs[0]?.id ?? ''); setInitialized(true); }
      } catch (cause) { if (isMounted) { setError(cause instanceof Error ? cause.message : '应用初始化失败，请重新启动。'); setGuideDecided(true); } }
      finally { if (isMounted) setIsLoading(false); }
    }
    void load();
    return () => { isMounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setPlaybackUrl(''); setPlaybackError(''); setCurrentTimeMs(0); setSelectedIds([]); setActiveIds([]); setPartialOperation(null); setActiveOperation(null); setPartialRange(undefined); setReviewProgress(null); setNamesProgress(null); setChapterProgress(null);
    if (selectedJobId) {
      void requireResult(window.api.jobs.playback(selectedJobId)).then((result) => { if (isCurrent) setPlaybackUrl(result.url); }).catch((cause: unknown) => { if (isCurrent) setPlaybackError(cause instanceof Error ? cause.message : '无法创建视频预览。'); });
    }
    return () => { isCurrent = false; };
  }, [selectedJobId]);

  useEffect(() => { setEditingSegment(null); }, [selectedJobId, playbackUrl]);
  useEffect(() => { if (job && !job.options.translationEnabled && partialOperation === 'translate') setPartialOperation(null); }, [job, partialOperation]);
  useEffect(() => {
    if (!initialized || isLoading || guideDismissed || dialog || recognitionTarget || editingSegment || partialOperation || isRunning || error) return;
    const timer = window.setTimeout(() => { setGuideDecided(true); setDialog('guide'); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialized, isLoading, guideDismissed, dialog, recognitionTarget, editingSegment, partialOperation, isRunning, error]);
  function closeGuide(): void { markFeatureGuideSeen(); setGuideDismissed(true); setGuideDecided(true); setDialog(null); }
  function cancelJob(): void { if (job) void requireResult(window.api.jobs.cancel(job.id)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '取消失败')); }
  async function startRepairLoop(input: RepairLoopInput): Promise<void> {
    if (isRunning || !job || input.jobId !== job.id) return;
    videoRef.current?.pause(); setEditingSegment(null); setPartialOperation(null);
    await perform('自动循环修复', async () => { commitJob(await requireResult(window.api.jobs.repairLoop(input))); setSelectedIds([]); });
  }

  async function perform(label: string, action: () => Promise<void>, shouldRethrow = false): Promise<void> {
    setBusy(label); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); if (shouldRethrow) throw cause; }
    finally { setBusy(''); setChapterProgress(null); }
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
  function openPartial(ids: string[], operation: 'recognize' | 'translate'): void { setActiveOperation(null); setPartialRange(undefined); videoRef.current?.pause(); setSelectedIds(ids); setPartialOperation(operation); }
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
  function openOperation(operation: 'generate' | 'style' | 'export' | 'names' | 'chapters'): void {
    videoRef.current?.pause(); setPartialOperation(null); setActiveOperation(operation);
  }
  async function review(ids?: string[], current = job, range?: { startMs: number; endMs: number }): Promise<void> {
    if (!current || isRunning) return;
    if (!profiles.some((profile) => profile.id === current.options.reviewProfileId)) {
      setServicePurpose('review'); setReviewSelection(ids); setReviewRange(range); setReviewService(''); setDialog('review-service'); return;
    }
    setReviewProgress(null);
    await perform('AI 检查字幕', async () => {
      commitJob(await requireResult(window.api.jobs.reviewSubtitles({ jobId: current.id, revision: current.revision, ...(range ? { range } : ids?.length ? { segmentIds: ids } : {}) })));
      setNotice('AI 检查完成，提示为可疑项，请试听确认。');
    });
  }
  async function analyzeNames(current = job): Promise<void> {
    if (!current || isRunning) return;
    if (!profiles.some((profile) => profile.id === current.options.reviewProfileId)) { setServicePurpose('names'); setReviewService(''); setDialog('review-service'); return; }
    setNamesProgress(null);
    await perform('AI 检查人名', async () => commitJob(await requireResult(window.api.jobs.analyzeNames({ jobId: current.id, revision: current.revision }))));
  }
  async function exportWork(input: Parameters<AppApi['jobs']['export']>[0]): Promise<boolean> {
    setBusy('导出'); setError('');
    try { const output = await requireResult(window.api.jobs.export(input)); commitJob(await requireResult(window.api.jobs.get(input.jobId))); if (output) setNotice(`导出完成：${output.path}`); return Boolean(output); }
    finally { setBusy(''); }
  }
  async function designStyle(prompt: string): Promise<void> {
    if (!job) return;
    await perform('AI 设计样式', async () => { commitJob(await requireResult(window.api.jobs.designStyle({ jobId: job.id, prompt }))); setNotice('AI 样式已通过验证，可在视频预览中查看。'); }, true);
  }
  function seek(ms: number): void { if (videoRef.current) videoRef.current.currentTime = ms / 1000; }
  function editSegment(segment: Segment, location: 'preview' | 'list'): void {
    if (!job || isRunning) return;
    videoRef.current?.pause();
    if (location === 'preview') {
      setActiveOperation(null);
      setPartialOperation(null); setPartialRange(undefined);
      if (editingSegment?.location === 'preview' && editingSegment.segment.id === segment.id && editingSegment.jobId === job.id && editingSegment.source === playbackUrl) return;
    }
    setEditingSegment({ segment: { ...segment }, revision: job.revision, jobId: job.id, source: playbackUrl, durationMs: job.media.durationMs, location, isNew: false });
  }
  function addSegment(location: 'preview' | 'list'): void {
    if (!job || isRunning) return;
    if (location === 'preview') {
      setActiveOperation(null);
      setPartialOperation(null); setPartialRange(undefined);
      if (editingSegment?.location === 'preview' && editingSegment.isNew && editingSegment.jobId === job.id && editingSegment.source === playbackUrl) return;
    }
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

  const workspaceHeader = <header className="workspace-header"><div><span className="eyebrow">Slice Man</span><h1 title={job?.name}>{job?.name ?? '识别、翻译、校对，一站完成'}</h1><p>{job ? `${job.media.width} × ${job.media.height} · ${formatTime(job.media.durationMs)}${job.actualBackend ? ` · 识别后端 ${job.actualBackend.toUpperCase()}` : ''}` : '识别、翻译、校对，让字幕成为视频的一部分。'}</p></div>
    </header>;
  const workspaceStatuses = <>
    {error && <div className="banner banner--error" role="alert"><div><strong>需要处理的问题</strong><p>{error}</p></div><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="banner banner--success" role="status">{notice}<button className="icon-button" aria-label="关闭成功提示" onClick={() => setNotice('')}>×</button></div>}
    {isRunning && job && <div className="processing-strip" role="status"><span>{activeLive ? `${LIVE_PHASE_LABELS[activeLive.phase]} · ${Math.floor(activeLive.elapsedMs / 1000)} 秒 · 已接收 ${activeLive.wireBytes.toLocaleString()} 字节` : job.repairRun?.state === 'running' ? repairRunSummary(job.repairRun) : `${busy || '正在处理'}${busy === 'AI 检查字幕' && reviewProgress ? ` · ${reviewProgress.message}` : namesProgress?.jobId === job.id && (busy === 'AI 检查人名' || busy === '保存检查服务') ? ` · ${namesProgress.message}` : '…'}`}</span><button className="text-button stream-info-trigger" aria-haspopup="dialog" onClick={() => setDialog('live-stream')}>查看流式信息</button><button className="text-button" onClick={cancelJob}>取消当前处理</button></div>}
</>;
  return <div data-onboarding-state={dialog === 'guide' ? 'open' : guideDecided ? 'settled' : 'pending'} ref={layout.rootRef} style={layout.style} className={`app-shell ${isSidebarCollapsed ? 'app-shell--collapsed' : ''}`}><aside className="sidebar"><div className="brand"><img className="brand__mark" src={appIcon} alt="" /><div className="sidebar__label"><strong>Slice Man</strong><small>识别、翻译、校对，一站完成</small></div></div>
    <button className="sidebar-link sidebar__toggle" aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setIsSidebarCollapsed((value) => !value)}><Icon name={isSidebarCollapsed ? 'expand' : 'collapse'} /><span className="sidebar__label">收起侧边栏</span></button>
    <button className="button button--primary sidebar__import" aria-label="导入视频" title="导入视频" disabled={isRunning} onClick={importVideo}><Icon name="import" /><span className="sidebar__label">导入视频</span></button>
    <button className="button sidebar__import" aria-label="链接导入" title="链接导入" disabled={isRunning} onClick={() => setDialog('online-import')}><Icon name="link" /><span className="sidebar__label">链接导入</span></button>
    <div className="sidebar__section-title"><span className="sidebar__label">最近项目</span><span>{jobs.length}</span></div>
    <nav className="history-list" aria-label="项目历史">{jobs.map((item) => <button aria-label={item.name} title={item.name} aria-current={item.id === selectedJobId ? 'page' : undefined} className={`history-item ${item.id === selectedJobId ? 'history-item--active' : ''}`} disabled={isRunning} key={item.id} onClick={() => setSelectedJobId(item.id)}><Icon name="video" /><span className="sidebar__label"><strong>{item.name}</strong><small>{formatTime(item.media.durationMs)} · {item.segments.length} 条字幕</small></span></button>)}{!jobs.length && <p className="sidebar__empty sidebar__label">导入后，项目与处理进度<br />会保存在这台电脑。</p>}</nav>
    <footer className="sidebar__footer">{job && <><button className="sidebar-link" aria-label="生成设置" title="生成设置" onClick={() => setDialog('generation-settings')}><Icon name="settings" /><span className="sidebar__label">生成设置</span></button><button className="sidebar-link" aria-label="样式设置" title="样式设置" onClick={() => setDialog('style-settings')}><Icon name="settings" /><span className="sidebar__label">样式设置</span></button></>}<button className="sidebar-link" aria-label="本地引擎" title="本地引擎" onClick={() => setDialog('runtime')}><Icon name="engine" /><span className="sidebar__label">本地引擎</span><span className={`status-dot ${runtime?.cpuReady ? 'status-dot--ready' : ''}`} /></button><button className="sidebar-link" aria-label="API 服务" title="API 服务" onClick={() => setDialog('profiles')}><Icon name="settings" /><span className="sidebar__label">API 服务</span></button><button className="sidebar-link" aria-label="链接导入设置" title="链接导入设置" onClick={() => setDialog('downloader')}><Icon name="download" /><span className="sidebar__label">链接导入设置</span></button><button className="sidebar-link" aria-label="导出设置" title="导出设置" onClick={() => setDialog('export-settings')}><Icon name="export" /><span className="sidebar__label">导出设置</span></button><div className="sidebar__utilities"><button className="sidebar-link sidebar__help" aria-label="功能导航" title="功能导航" onClick={() => setDialog('guide')}><span className="sidebar__utility-icon" aria-hidden="true">?</span></button><button className="sidebar-link sidebar__reset" aria-label="重置布局" title="重置布局" onClick={layout.reset}><span className="sidebar__utility-icon" aria-hidden="true">↺</span><span className="sidebar__label">重置布局</span></button></div><p className="sidebar__label">Windows 桌面版 · v0.1</p></footer>
  {!isSidebarCollapsed && <PaneDivider label="调整侧边栏宽度" orientation="vertical" {...layout.sidebar} onChange={layout.sidebar.update} className="pane-divider--sidebar" />}</aside><main className="main-workspace">
    {!job && <>{workspaceHeader}{workspaceStatuses}</>}
    {isLoading ? <div className="loading-state" role="status">正在读取本地项目与引擎状态…</div> : job ? <div ref={layout.gridRef} className="work-grid">
      <div ref={layout.leftRef} className="work-grid__content"><section ref={layout.previewRef} className="preview-panel" aria-label="视频预览">{workspaceHeader}<div className="section-heading preview-heading"><h2>视频预览</h2><div className="stage-strip" aria-label="处理进度">{visibleStages.map((name, index) => <div key={name} className={`stage-pill stage-pill--${job.stages[name].state}`}><span>{job.stages[name].state === 'succeeded' ? '✓' : index + 1}</span><div><strong>{STAGE_LABELS[name]}</strong><small>{STATE_LABELS[job.stages[name].state]}</small></div></div>)}</div><span className="preview-tag">实时字幕 · 点击字幕校对</span></div>
        <div className="preview-media"><div className="video-stage">{playbackUrl ? <LiveVideoPreview key={`${job.id}-${playbackUrl}`} job={job} source={playbackUrl} videoRef={videoRef} isBusy={isRunning} onEdit={(segment) => editSegment(segment, 'preview')} onActiveChange={setActiveIds} onTimeUpdate={setCurrentTimeMs} onError={() => setPlaybackError('此视频无法在播放器中播放，请重新生成兼容预览或检查原片是否已移动。')} /> : <p>{playbackError || '准备兼容视频预览…'}</p>}</div></div>
        {playbackError && <><p className="error-message" role="alert">{playbackError}</p><button className="button" disabled={isRunning} onClick={() => void perform('重新加载视频', async () => { const result = await requireResult(window.api.jobs.playback(job.id)); setPlaybackUrl(result.url); setPlaybackError(''); })}>重新加载视频预览</button></>}

        <div className="preview-tools" role="toolbar" aria-label="视频操作"><span>当前位置 {formatTime(currentTimeMs)}</span>
          <button className="button" disabled={isRunning} aria-pressed={activeOperation === 'generate'} onClick={() => openOperation('generate')}><Icon name="generate" />生成</button>
          <button className="button" disabled={isRunning} aria-pressed={partialOperation === 'recognize'} onClick={() => openPartial(selectedIds, 'recognize')}><Icon name="recognize" />重新识别片段</button>
          {job.options.translationEnabled && <button className="button" disabled={isRunning} aria-pressed={partialOperation === 'translate'} onClick={() => openPartial(selectedIds, 'translate')}><Icon name="translate" />重新翻译片段</button>}
          <button className="button" aria-label="添加画面字幕" disabled={isRunning} onClick={() => addSegment('preview')}><Icon name="add" />添加画面字幕</button>
          <button className="button" disabled={isRunning || !job.segments.length} aria-pressed={activeOperation === 'names'} onClick={() => openOperation('names')}><Icon name="names" />人名检查</button>
          <button className="button" disabled={isRunning} aria-pressed={activeOperation === 'style'} onClick={() => openOperation('style')}><Icon name="style" />样式</button>
          <button className="button" disabled={isRunning || !job.segments.length} aria-pressed={activeOperation === 'chapters'} onClick={() => openOperation('chapters')}><Icon name="chapters" />章节</button>
          <button className="button" disabled={isRunning || !job.segments.length} aria-label="导出作品" aria-pressed={activeOperation === 'export'} onClick={() => openOperation('export')}><Icon name="export" />导出</button>
        </div><p className="hint">全屏仅播放，退出全屏后可校对。</p>
      </section>
      {(activeOperation || partialOperation || editingSegment?.location === 'preview') && <div className="workspace-operation-card">
        {partialOperation && <ReprocessingPanel key={`${job.id}-${partialOperation}-${partialRange?.startMs ?? 'selection'}`} initialRange={partialRange} job={job} operation={partialOperation} selectedIds={selectedIds} currentTimeMs={currentTimeMs} isBusy={isRunning} onClose={() => setPartialOperation(null)} onExecute={executePartial} />}
        {editingSegment?.location === 'preview' && <div className="preview-editor" hidden={Boolean(partialOperation || activeOperation)}>{editor}</div>}
        {activeOperation && <section className={`operation-panel ${activeOperation === 'names' ? 'operation-panel--names' : ''}`} aria-label={`${activeOperation === 'generate' ? '生成' : activeOperation === 'style' ? '样式' : activeOperation === 'export' ? '导出' : activeOperation === 'chapters' ? '章节' : '人名检查'}操作面板`}>
          <div className="section-heading"><h3>{activeOperation === 'generate' ? '生成字幕' : activeOperation === 'style' ? '字幕样式' : activeOperation === 'export' ? '导出作品' : activeOperation === 'chapters' ? '章节切分与导出' : '人名检查'}</h3><button className="icon-button" aria-label="关闭操作面板" onClick={() => setActiveOperation(null)}>×</button></div>
          {activeOperation === 'generate' && <div className="operation-panel__grid generation-operation"><div className="generation-operation__section"><h4>{job.options.translationEnabled ? '识别与翻译' : '原文字幕'}</h4><p className="hint">{job.segments.length} 条字幕 · {job.options.recognition === 'local' ? '本地 Whisper' : '云端识别'}。先识别，再按项目设置翻译。</p><button className="button" onClick={() => setDialog('generation-settings')}>打开生成设置</button></div><div className="generation-operation__section"><h4>原片识别</h4><p className="hint">重新识别会替换当前字幕，请先确认需要重建。</p>{!canGenerate && <p className="hint">{!job.options.translationEnabled && job.segments.length ? '原文字幕可直接校对、选择样式和导出。' : job.segments.length && job.stages.recognize.state !== 'succeeded' ? '识别设置已变化，请先重新识别原片，再翻译。' : '请在生成设置中配置所需识别或翻译服务。'}</p>}{(job.segments.length > 0 || job.stages.recognize.state === 'succeeded') && <button className="button" disabled={isRunning || !canRecognize} onClick={() => setRecognitionTarget({ jobId: job.id, revision: job.revision, recognition: job.options.recognition, subtitleCount: job.segments.length, hasEmphasis: job.style.emphasisBySegment.length > 0 })}>重新识别原片</button>}{!job.segments.length && !isRunning && visibleStages.some((name) => ['failed', 'cancelled', 'interrupted'].includes(job.stages[name].state)) && <button className="button" onClick={() => void retry()}>重试未完成阶段</button>}</div><footer className="operation-panel__actions"><button className="button" onClick={() => setActiveOperation(null)}>取消</button><button className="button button--primary" disabled={isRunning || !canGenerate} onClick={() => void generate()}>{isRunning ? `${busy || '处理中'}…` : job.segments.length ? job.options.translationEnabled ? '翻译全部字幕' : '原文字幕已就绪' : '一键生成字幕'}</button></footer></div>}
          {activeOperation === 'style' && <StyleOperation job={job} isBusy={isRunning} onSettings={() => setDialog('style-settings')} onClose={() => setActiveOperation(null)} onDesign={designStyle} />}
          {activeOperation === 'export' && <ExportForm jobId={job.id} onExport={exportWork} onClose={() => setActiveOperation(null)} />}
          {activeOperation === 'chapters' && <ChapterPanel key={job.id} job={job} profiles={profiles} isBusy={isRunning} onClose={() => setActiveOperation(null)} onSeek={seek} onPlan={async (input) => perform('AI 切分章节', async () => commitJob(await requireResult(window.api.jobs.planChapters(input))), true)} onUpdate={async (input) => perform('保存章节', async () => commitJob(await requireResult(window.api.jobs.updateChapters(input))), true)} onExport={async (input) => {let run: ChapterExportRun | null = null; await perform('分章节导出', async () => {run = await requireResult(window.api.chapterExports.export(input)); if (run) setNotice(`章节导出完成：${run.clips.filter((clip) => clip.state === 'complete').length} 个文件`);}, true); return run;}} />}
          {activeOperation === 'names' && <PersonNamePanel job={job} isBusy={isRunning} onAnalyze={() => void analyzeNames()} onApply={(input) => void perform('应用人名修改', async () => commitJob(await requireResult(window.api.jobs.applyNames(input))))} onUndo={(input) => void perform('撤销人名修改', async () => commitJob(await requireResult(window.api.jobs.undoNames(input))))} onCancel={() => { if (isRunning) cancelJob(); else setActiveOperation(null); }} onChooseProfile={() => { setServicePurpose('names'); setReviewService(''); setDialog('review-service'); }} />}
        </section>}
      </div>}
      </div>
      <PaneDivider label="调整预览与校对区宽度" orientation="vertical" {...layout.columns} onChange={layout.columns.update} position={layout.columns.position} className="pane-divider--columns" />
      <div ref={layout.rightRef} className="work-grid__proofreading"><SubtitleList key={job.id} onRepairLoop={(input) => void startRepairLoop(input)} onCancelRepair={cancelJob} job={job} selectedIds={selectedIds} activeIds={activeIds} isBusy={isRunning} isEditing={Boolean(editor)} editingId={editingSegment?.location === 'list' && !editingSegment.isNew ? editingSegment.segment.id : undefined} draftStartMs={editingSegment?.location === 'list' && editingSegment.isNew ? editingSegment.segment.startMs : undefined} editor={editingSegment?.location === 'list' ? editor : null} onAdd={() => addSegment('list')} onRemove={(segment) => void perform('删除字幕', async () => removeSegment(segment))} onSelectMany={(ids) => { videoRef.current?.pause(); setSelectedIds(ids); }} onSelect={(id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])} onEdit={(segment) => editSegment(segment, 'list')} onSeek={seek} onPlay={(ms) => { seek(ms); void videoRef.current?.play().catch(() => setPlaybackError('暂时无法播放，请使用播放器播放按钮。')); }} onRepair={openPartial} onRepairRange={(range) => { videoRef.current?.pause(); setSelectedIds([]); setPartialRange(range); setActiveOperation(null); setPartialOperation('recognize'); }} onReview={(ids) => void review(ids ?? (selectedIds.length ? selectedIds : undefined))} onReviewScope={() => setDialog('review-scope')} onIgnore={(finding) => { const report = job.reviewReport; if (report) void perform('忽略提示', async () => commitJob(await requireResult(window.api.jobs.acknowledgeFinding({ jobId: job.id, reportId: report.id, findingId: finding.id, status: 'ignored' })))); }} onRetranslate={() => openPartial(selectedIds, 'translate')} />{hasResults && <><PaneDivider label="调整字幕校对与结果区高度" orientation="horizontal" {...layout.results} onChange={layout.results.update} className="pane-divider--results" /><section ref={layout.resultsRef} className="workspace-results" aria-label="处理信息与结果"><div className="section-heading"><h2>处理信息与结果</h2>{live.items.length > 0 && <button className="text-button" aria-haspopup="dialog" onClick={() => setDialog('live-stream')}>流式信息</button>}<button className="text-button" onClick={() => setDialog('diagnostics')}>AI 请求日志</button></div>{workspaceStatuses}{chapterProgress && <div className="stage-detail"><strong>章节处理</strong><p>{chapterProgress.message}</p>{isRunning && <progress max={1} value={chapterProgress.progress} />}</div>}{job.reviewRun && <ChapterReviewStatus run={job.reviewRun} isBusy={isRunning} onResume={(ids) => void review(ids)} />}
      {Object.entries(job.stages).filter(([name, stage]) => name !== 'preview' && (name !== 'translate' || job.options.translationEnabled) && stage.message && stage.state !== 'idle').map(([name, stage]) => <div key={name} className={`stage-detail stage-detail--${stage.state}`}><strong>{STAGE_LABELS[name as StageName]}</strong><p>{stage.message}</p>{stage.state === 'running' && <progress max={1} value={stage.progress} />}</div>)}
      <ChapterExportResults job={job} isBusy={isRunning} onResume={async (input) => perform('继续章节导出', async () => {await requireResult(window.api.chapterExports.export(input)); setNotice('所选章节已全部导出。');}, true)} />
      {job.outputs.length > 0 && <section className="outputs-panel"><h2>已导出文件</h2>{job.outputs.map((path, index) => <p key={`${path}-${index}`} title={path}>✓ <span>{path}</span></p>)}</section>}
      </section></>}</div>
    </div> : <section className="welcome"><div className="welcome__art"><div className="welcome__frame"><span>▶</span><div className="welcome__caption">让每一句话，都被看见。</div></div><span className="welcome__spark">✧</span></div><span className="eyebrow">ONE VIDEO. MORE POSSIBILITIES.</span><h2>从一个视频开始</h2><p>识别原片，按需翻译内容。<br />校对、选择样式，然后导出带字幕的视频。</p><button className="button button--primary button--large" disabled={Boolean(busy)} onClick={() => void importVideo()}>＋ 选择本地视频</button><small>MP4 · MKV · MOV · WebM，取决于视频编码支持</small><div className="welcome__steps"><span>01 识别 · 按需翻译</span><span>02 校对与设计</span><span>03 永久字幕导出</span></div></section>}
  </main>
  {dialog === 'generation-settings' && job && <Modal title="生成设置" className="settings-dialog" onClose={() => setDialog(null)}><JobSettings job={job} profiles={profiles} runtime={runtime} isBusy={isRunning} onChange={(options) => void perform('保存设置', async () => commitJob(await requireResult(window.api.jobs.updateOptions({ jobId: job.id, options }))))} onInstall={() => setDialog('runtime')} onProfiles={() => setDialog('profiles')} /><footer className="modal__footer"><button className="button" onClick={() => setDialog(null)}>返回工作区</button></footer></Modal>}
  {dialog === 'style-settings' && job && <Modal title="样式设置" className="settings-dialog" onClose={() => setDialog(null)}><StylePanel settingsOnly job={job} selectedIds={selectedIds} isBusy={isRunning} onStyle={(style) => void perform('保存样式', async () => commitJob(await requireResult(window.api.jobs.setStyle({ jobId: job.id, style }))))} onBilingual={(bilingual) => void perform('保存双语设置', async () => commitJob(await requireResult(window.api.jobs.updateOptions({ jobId: job.id, options: { ...job.options, bilingual } }))))} onDesign={() => undefined} /><footer className="modal__footer"><button className="button" onClick={() => setDialog(null)}>返回工作区</button></footer></Modal>}
  {dialog === 'review-service' && job && <Modal title="选择 AI 检查服务" onClose={() => setDialog(null)}><p className="hint">该项目尚未配置有效检查服务。请选择文字模型服务，保存后检查；不会自动沿用翻译服务。</p><label>AI 检查服务<select aria-label="AI 检查服务" value={reviewService} onChange={(event) => setReviewService(event.target.value)}><option value="">请选择服务</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button className="text-button" onClick={() => setDialog('profiles')}>管理 API 服务</button><footer className="modal__footer"><button className="button" onClick={() => setDialog(null)}>取消</button><button className="button button--primary" disabled={!reviewService || isRunning} onClick={() => void perform('保存检查服务', async () => { const next = await requireResult(window.api.jobs.updateOptions({ jobId: job.id, options: { ...job.options, reviewProfileId: reviewService } })); commitJob(next); setDialog(null); setReviewProgress(null); if (servicePurpose === 'names') { setNamesProgress(null); commitJob(await requireResult(window.api.jobs.analyzeNames({ jobId: next.id, revision: next.revision }))); } else { commitJob(await requireResult(window.api.jobs.reviewSubtitles({ jobId: next.id, revision: next.revision, ...(reviewRange ? { range: reviewRange } : reviewSelection?.length ? { segmentIds: reviewSelection } : {}) }))); setNotice('AI 检查完成，提示为可疑项，请试听确认。'); } })}>{servicePurpose === 'names' ? '保存并检查人名' : '保存并检查'}</button></footer></Modal>}
  {dialog === 'review-scope' && job && <ReviewScopeDialog key={job.id} job={job} selectedIds={selectedIds} isBusy={isRunning} onClose={() => setDialog(null)} onReview={(scope) => { setDialog(null); void review(scope.segmentIds, job, scope.range); }} />}
  {dialog === 'live-stream' && <ProviderLiveDialog key={job?.id} items={live.items} error={live.error} onClose={() => setDialog(null)} />}
  {dialog === 'diagnostics' && <DiagnosticsDialog jobId={job?.id} onClose={() => setDialog(null)} />}
  {dialog === 'guide' && <FeatureGuide onClose={closeGuide} />}
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

