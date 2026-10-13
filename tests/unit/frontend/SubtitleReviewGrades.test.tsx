// @vitest-environment jsdom
import { useState, type ReactNode, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_RISK_LABELS, REVIEW_RUBRIC_VERSION, REVIEW_RULES, type Job, type ReviewRiskLevel } from '../../../src/shared/contracts';
import { setReviewFilters, reviewFilterChoice } from './review-filter-helpers';
import { SubtitleList } from '../../../src/renderer/src/components/SubtitleList';
import { REVIEW_LEVELS } from '../../../src/renderer/src/lib/review-presentation';
import { savedJob } from './app-fixtures';

beforeEach(() => { HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(cleanup);

function gradedJob(levels: ReviewRiskLevel[] = ['none', 'low', 'medium', 'high']): Job {
  const job = savedJob(); job.options.translationEnabled = false; job.options.reviewProfileId = 'review-profile';
  job.segments = levels.map((level, index) => ({ id: `cue-${index}`, startMs: index * 600, endMs: index * 600 + 500, sourceText: `Source ${index}: ${level}`, translatedText: `Stored translation ${index}`, translationStale: false }));
  const fingerprints = Object.fromEntries(job.segments.map((cue) => [cue.id, `fingerprint-${cue.id}`]));
  job.reviewReport = {
    id: 'graded-report', profileId: 'review-profile', providerFingerprint: 'configuration', completedAt: 10, state: 'complete', translationEnabled: false,
    reviewedSegmentIds: job.segments.map((cue) => cue.id), fingerprints, rubric: { version: REVIEW_RUBRIC_VERSION, rules: [...REVIEW_RULES] },
    contextGroups: [{ id: 'context', windowSegmentIds: job.segments.map((cue) => cue.id), segmentIds: job.segments.map((cue) => cue.id), fingerprints }],
    assessments: levels.map((riskLevel, index) => ({ segmentId: `cue-${index}`, riskLevel, status: 'current', contextGroupId: 'context', findingIds: [] })), findings: [],
  };
  return job;
}

function props(job: Job): ComponentProps<typeof SubtitleList> {
  return { job, selectedIds: [], activeIds: [], isBusy: false, isEditing: false, editor: null, onAdd: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn(), onSelectMany: vi.fn(), onEdit: vi.fn(), onSeek: vi.fn(), onRetranslate: vi.fn(), onReview: vi.fn(), onRepair: vi.fn() };
}

describe('contextual four-level review presentation', () => {
  it('shows explicit badges and current counts for every level, filters without changing video order', () => {
    render(<SubtitleList {...props(gradedJob())} />);
    for (const level of REVIEW_LEVELS) {
      const label = REVIEW_RISK_LABELS[level];
      setReviewFilters('all');
      expect(screen.getByLabelText(`可疑度：${label}`)).toBeTruthy();
      expect(reviewFilterChoice(`${label}（1）`)).toBeTruthy();
      setReviewFilters(level);
      const rows = screen.getAllByRole('article');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain(level);
    }
    setReviewFilters('all');
    expect(screen.getAllByRole('article').map((row) => row.getAttribute('data-testid'))).toEqual(['segment-0', 'segment-1', 'segment-2', 'segment-3']);
    expect(screen.queryByText(/Stored translation/)).toBeNull();
  });

  it('selects only the chosen current grade in chronological order for existing scoped repair controls', () => {
    const job = gradedJob(['high', 'none', 'high', 'low']); const onRepair = vi.fn();
    function Harness(): ReactNode {
      const [selectedIds, setSelectedIds] = useState<string[]>([]);
      return <SubtitleList {...props(job)} selectedIds={selectedIds} onSelectMany={setSelectedIds} onRepair={onRepair} />;
    }
    render(<Harness />);
    setReviewFilters('high');
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('选择字幕 3') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('选择字幕 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新识别选中' }));
    expect(onRepair).toHaveBeenCalledExactlyOnceWith(['cue-0', 'cue-2'], 'recognize');
    expect(screen.queryByRole('button', { name: /重译选中/ })).toBeNull();
  });

  it('combines multiple grades in video order and toggles only visible selections', () => {
    const job = gradedJob(['high', 'none', 'medium', 'low', 'high']);
    function Harness(): ReactNode {
      const [selectedIds, setSelectedIds] = useState(['cue-1']);
      return <SubtitleList {...props(job)} selectedIds={selectedIds} onSelectMany={setSelectedIds} />;
    }
    render(<Harness />);
    setReviewFilters('high', 'medium');
    expect(screen.getAllByRole('article').map((row) => row.getAttribute('data-testid'))).toEqual(['segment-0', 'segment-2', 'segment-4']);
    expect(screen.queryByLabelText('选择当前等级')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByText('已选 4 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
    expect(screen.getByText('已选 1 条')).toBeTruthy();
    setReviewFilters('none');
    expect((screen.getByLabelText('选择字幕 2') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
    setReviewFilters('all');
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByText('已选 5 条')).toBeTruthy();
  });

  it('deduplicates pending and unchecked filters and restores all when the final choice is cleared', () => {
    const job = gradedJob(); job.reviewReport = undefined;
    render(<SubtitleList {...props(job)} />);
    setReviewFilters('pending', 'unchecked');
    expect(screen.getAllByRole('article')).toHaveLength(4);
    const trigger = screen.getByRole('button', { name: '可疑度筛选' });
    fireEvent.click(trigger);
    const group = screen.getByRole('group', { name: '可疑度筛选选项' });
    fireEvent.click(within(group).getByRole('checkbox', { name: '待检查（4）' }));
    fireEvent.click(within(group).getByRole('checkbox', { name: '未检查（4）' }));
    expect((within(group).getByRole('checkbox', { name: '全部（4）' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '可疑度筛选选项' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('heading', { name: /字幕校对/ }));
    expect(screen.queryByRole('group', { name: '可疑度筛选选项' })).toBeNull();
  });

  it('disables selection for an empty filter, busy work and missing callbacks', () => {
    const input = props(gradedJob(['high'])); const { rerender } = render(<SubtitleList {...input} />);
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(false);
    setReviewFilters('none');
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(true);
    setReviewFilters('high');
    rerender(<SubtitleList {...input} isBusy />);
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '选择时间范围' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SubtitleList {...input} onSelectMany={undefined} />);
    expect((screen.getByRole('button', { name: '全选' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('selects only overlapping filtered cues, retaining prior selections and range drafts', () => {
    const job = gradedJob(['high', 'low', 'high', 'high']); const onReview = vi.fn();
    // [0,500), [600,1100), [1200,1700), [1800,2300)
    function Harness(): ReactNode {
      const [selectedIds, setSelectedIds] = useState(['cue-1']);
      return <SubtitleList {...props(job)} selectedIds={selectedIds} onSelectMany={setSelectedIds} onReview={onReview} />;
    }
    render(<Harness />);
    setReviewFilters('high');
    const opener = screen.getByRole('button', { name: '选择时间范围' });
    opener.focus(); fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('选择范围开始（秒）'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('选择范围结束（秒）'), { target: { value: '1.8' } });
    expect(screen.getByRole('status').textContent).toContain('1 条');
    fireEvent.click(screen.getByRole('button', { name: '选择此范围' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(screen.getByText('已选 2 条')).toBeTruthy();
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('选择字幕 3') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('选择字幕 4') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(opener);
    expect((screen.getByLabelText('选择范围开始（秒）') as HTMLInputElement).value).toBe('0.5');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onReview).not.toHaveBeenCalled();
    setReviewFilters('low');
    expect((screen.getByLabelText('选择字幕 2') as HTMLInputElement).checked).toBe(true);
  });

  it('rejects invalid, out-of-video and empty time selections without changing content', () => {
    const input = props(gradedJob(['high', 'low'])); const before = JSON.stringify(input.job);
    const { rerender } = render(<SubtitleList {...input} />);
    setReviewFilters('high');
    fireEvent.click(screen.getByRole('button', { name: '选择时间范围' }));
    fireEvent.change(screen.getByLabelText('选择范围开始（秒）'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('选择范围结束（秒）'), { target: { value: '0.5' } });
    expect(screen.getByRole('alert').textContent).toContain('结束时间必须大于开始时间');
    expect((screen.getByRole('button', { name: '选择此范围' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('选择范围结束（秒）'), { target: { value: '5' } });
    expect(screen.getByRole('alert').textContent).toContain('不能超过视频时长');
    fireEvent.change(screen.getByLabelText('选择范围结束（秒）'), { target: { value: '2' } });
    expect(screen.getByRole('status').textContent).toContain('0 条');
    expect((screen.getByRole('button', { name: '选择此范围' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('选择范围开始（秒）'), { target: { value: '0' } });
    rerender(<SubtitleList {...input} isBusy />);
    expect((screen.getByRole('button', { name: '选择此范围' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input.onSelectMany).not.toHaveBeenCalled();
    expect(JSON.stringify(input.job)).toBe(before);
  });

  it('keeps a previously clear context-stale cue out of none counts and exposes row and batch recheck', () => {
    const job = gradedJob(); const report = job.reviewReport;
    if (!report?.assessments) throw new Error('Graded fixture absent');
    report.state = 'stale'; report.assessments = report.assessments.map((assessment) => assessment.segmentId === 'cue-0' ? { ...assessment, status: 'recheck' } : assessment);
    const input = props(job); render(<SubtitleList {...input} />);
    expect(screen.getByLabelText('上次可疑度：无，需复查')).toBeTruthy();
    expect(screen.queryByLabelText('可疑度：无')).toBeNull();
    expect(reviewFilterChoice('无（0）')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('segment-0')).getByRole('button', { name: '复查' }));
    expect(input.onReview).toHaveBeenCalledWith(['cue-0']);
    setReviewFilters('pending');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '复查待检查' }));
    expect(input.onReview).toHaveBeenLastCalledWith(['cue-0']);
  });

  it('distinguishes never inspected cues and legacy ungraded reports from clear results', () => {
    const job = savedJob(); const input = props(job); const { rerender } = render(<SubtitleList {...input} />);
    expect(screen.getByLabelText('未检查')).toBeTruthy();
    expect(screen.queryByLabelText('可疑度：无')).toBeNull();
    const legacy = { ...job, reviewReport: { id: 'legacy', profileId: 'profile', providerFingerprint: '', completedAt: 1, state: 'complete' as const, reviewedSegmentIds: ['old-cue'], fingerprints: { 'old-cue': 'snapshot' }, findings: [] } };
    rerender(<SubtitleList {...props(legacy)} />);
    expect(screen.getByLabelText('待重新检查')).toBeTruthy();
    expect(reviewFilterChoice('无（0）')).toBeTruthy();
    setReviewFilters('pending');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it.each(['rubric', 'mode'])('invalidates displayed current grades after %s changes rather than inventing none', (change) => {
    const job = gradedJob(); const report = job.reviewReport; if (!report?.rubric) throw new Error('Rubric missing');
    if (change === 'rubric') report.rubric = { ...report.rubric, version: 'outdated-rubric' };
    else job.options.translationEnabled = true;
    render(<SubtitleList {...props(job)} />);
    expect(screen.getByLabelText('上次可疑度：高，需复查')).toBeTruthy();
    for (const label of Object.values(REVIEW_RISK_LABELS)) expect(reviewFilterChoice(`${label}（0）`)).toBeTruthy();
  });

  it('opens the exact shared rubric outside the subtitle scroll region', () => {
    render(<SubtitleList {...props(gradedJob())} />);
    const opener = screen.getByRole('button', { name: '可疑度判断标准' });
    expect(opener.textContent).toBe('可疑度标准');
    expect(opener.closest('.review-toolbar__filter-group')).toBeTruthy();
    expect(screen.getByRole('button', { name: '全选' }).closest('.review-toolbar__view-group')).toBeTruthy();
    opener.focus();
    fireEvent.click(opener);
    const help = screen.getByRole('region', { name: '可疑度判断标准' });
    expect(help.closest('.subtitle-list')).toBeNull();
    expect(screen.getByRole('dialog', { name: '可疑度判断标准' }).contains(help)).toBe(true);
    expect(help.textContent).toContain('标准版本：v1');
    expect(help.textContent).toContain('无 · 未发现明显疑点');
    for (const rule of REVIEW_RULES) expect(help.textContent).toContain(rule.description);
    expect(help.textContent).toContain('话题变化');
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getAllByRole('heading', { name: '可疑度判断标准' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(screen.queryByRole('region', { name: '可疑度判断标准' })).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
