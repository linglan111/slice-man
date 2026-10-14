// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterReviewStatus } from '../../../src/renderer/src/components/ChapterReviewStatus';
import type { ChapterReviewRun } from '../../../src/shared/chapter-contracts';
afterEach(cleanup);
const run: ChapterReviewRun={version:1,id:'run',planId:'plan',planRevision:0,sourceFingerprint:'source',timelineFingerprint:'timeline',profileId:'profile',providerFingerprint:'provider',rubricVersion:'v1',translationEnabled:true,targetIds:['a','b','c','d','e'],state:'failed',startedAt:0,chapters:[{chapterId:'one',targetIds:['a','b'],state:'completed'},{chapterId:'two',targetIds:['c'],state:'failed'},{chapterId:'three',targetIds:['d','e'],state:'pending'}]};
describe('chapter checking coverage status',()=>{
  it('shows cue and chapter coverage and resumes the saved full scope',()=>{
    const onResume=vi.fn(); render(<ChapterReviewStatus run={run} isBusy={false} onResume={onResume}/>);
    expect(screen.getByText('已完成 2/5 条 · 1/3 章；待检查 2 条，失败 1 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'继续检查剩余章节'})); expect(onResume).toHaveBeenCalledWith(['a','b','c','d','e']);
  });
  it('labels stale records honestly and does not offer compatible resume',()=>{
    render(<ChapterReviewStatus run={{...run,state:'stale'}} isBusy={false} onResume={vi.fn()}/>);
    expect(screen.getByText(/旧记录已完成 2\/5 条/)).toBeTruthy(); expect(screen.getByText(/检查结果已过期/)).toBeTruthy(); expect(screen.queryByRole('button',{name:'继续检查剩余章节'})).toBeNull();
  });
});
