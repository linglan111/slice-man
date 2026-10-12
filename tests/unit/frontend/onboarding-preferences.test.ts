// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeenFeatureGuide, markFeatureGuideSeen, ONBOARDING_STORAGE_KEY } from '../../../src/renderer/src/lib/onboarding-preferences';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('feature guide preference', () => {
  it.each([null, '', 'true', '1', '{broken', 'unknown'])('treats missing or unrecognized %s as unseen', (stored) => {
    if (stored !== null) localStorage.setItem(ONBOARDING_STORAGE_KEY, stored);
    expect(hasSeenFeatureGuide()).toBe(false);
  });
  it('remembers dismissal without changing layout or projects', () => {
    localStorage.setItem('slice-man.layout', 'preserve-me');
    markFeatureGuideSeen();
    expect(hasSeenFeatureGuide()).toBe(true);
    expect(localStorage.getItem('slice-man.layout')).toBe('preserve-me');
    expect(localStorage.length).toBe(2);
  });
  it('tolerates unavailable reads and writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(hasSeenFeatureGuide()).toBe(false);
    expect(() => markFeatureGuideSeen()).not.toThrow();
  });
});
