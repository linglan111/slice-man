import { fireEvent, screen, within } from '@testing-library/react';
import type { ReviewFilter } from '../../../src/renderer/src/lib/review-presentation';

const LABELS: Record<ReviewFilter, string> = { all: '全部', unchecked: '未检查', none: '无', low: '低', medium: '中', high: '高' };
export function setReviewFilters(...filters: ReviewFilter[]): void {
  const trigger = screen.getByRole('button', { name: '可疑度筛选' });
  fireEvent.click(trigger);
  const group = screen.getByRole('group', { name: '可疑度筛选选项' });
  fireEvent.click(within(group).getByRole('checkbox', { name: /^全部（/ }));
  for (const filter of filters.filter((value) => value !== 'all')) fireEvent.click(within(group).getByRole('checkbox', { name: new RegExp(`^${LABELS[filter]}（`) }));
  fireEvent.keyDown(group, { key: 'Escape' });
}
export function reviewFilterChoice(name: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: '可疑度筛选' }));
  const group = screen.getByRole('group', { name: '可疑度筛选选项' });
  const choice = within(group).getByRole('checkbox', { name });
  fireEvent.keyDown(group, { key: 'Escape' });
  return choice;
}
