// @vitest-environment jsdom
import { useState, type ReactNode, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_RISK_LABELS, REVIEW_RUBRIC_VERSION, REVIEW_RULES, type Job, type ReviewRiskLevel } from '../../../src/shared/contracts';
import { SubtitleList } from '../../../src/renderer/src/components/SubtitleList';
import { savedJob } from './app-fixtures';

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
    const filter = screen.getByLabelText('可疑度筛选');
    for (const [level, label] of Object.entries(REVIEW_RISK_LABELS)) {
      fireEvent.change(filter, { target: { value: 'all' } });
      expect(screen.getByLabelText(`可疑度：${label}`)).toBeTruthy();
      expect(within(filter).getByRole('option', { name: `${label}（1）` })).toBeTruthy();
      fireEvent.change(filter, { target: { value: level } });
      const rows = screen.getAllByRole('article');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain(level);
    }
    fireEvent.change(filter, { target: { value: 'all' } });
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
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: '选择当前等级' }));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('选择字幕 3') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('选择字幕 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新识别选中' }));
    expect(onRepair).toHaveBeenCalledExactlyOnceWith(['cue-0', 'cue-2'], 'recognize');
    expect(screen.queryByRole('button', { name: /重译选中/ })).toBeNull();
  });

  it('keeps a previously clear context-stale cue out of none counts and exposes row and batch recheck', () => {
    const job = gradedJob(); const report = job.reviewReport;
    if (!report?.assessments) throw new Error('Graded fixture absent');
    report.state = 'stale'; report.assessments = report.assessments.map((assessment) => assessment.segmentId === 'cue-0' ? { ...assessment, status: 'recheck' } : assessment);
    const input = props(job); render(<SubtitleList {...input} />);
    expect(screen.getByLabelText('上次可疑度：无，需复查')).toBeTruthy();
    expect(screen.queryByLabelText('可疑度：无')).toBeNull();
    expect(within(screen.getByLabelText('可疑度筛选')).getByRole('option', { name: '无（0）' })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('segment-0')).getByRole('button', { name: '复查' }));
    expect(input.onReview).toHaveBeenCalledWith(['cue-0']);
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'pending' } });
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
    expect(within(screen.getByLabelText('可疑度筛选')).getByRole('option', { name: '无（0）' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'pending' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it.each(['rubric', 'mode'])('invalidates displayed current grades after %s changes rather than inventing none', (change) => {
    const job = gradedJob(); const report = job.reviewReport; if (!report?.rubric) throw new Error('Rubric missing');
    if (change === 'rubric') report.rubric = { ...report.rubric, version: 'outdated-rubric' };
    else job.options.translationEnabled = true;
    render(<SubtitleList {...props(job)} />);
    expect(screen.getByLabelText('上次可疑度：高，需复查')).toBeTruthy();
    for (const label of Object.values(REVIEW_RISK_LABELS)) expect(within(screen.getByLabelText('可疑度筛选')).getByRole('option', { name: `${label}（0）` })).toBeTruthy();
  });

  it('expands the exact shared rubric inside the local subtitle scroll region', () => {
    render(<SubtitleList {...props(gradedJob())} />);
    fireEvent.click(screen.getByRole('button', { name: '可疑度判断标准' }));
    const help = screen.getByRole('region', { name: '可疑度判断标准' });
    expect(help.closest('.subtitle-list')).toBeTruthy();
    expect(help.textContent).toContain('标准版本：v1');
    expect(help.textContent).toContain('无 · 未发现明显疑点');
    for (const rule of REVIEW_RULES) expect(help.textContent).toContain(rule.description);
    expect(help.textContent).toContain('话题变化');
    fireEvent.click(screen.getByRole('button', { name: '关闭判断标准' }));
    expect(screen.queryByRole('region', { name: '可疑度判断标准' })).toBeNull();
  });
});
