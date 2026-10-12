/** UI-only preference: intentionally independent of project and layout settings. */
export const ONBOARDING_STORAGE_KEY = 'slice-man.onboarding.v1';
const SEEN_VALUE = 'seen';

export function hasSeenFeatureGuide(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === SEEN_VALUE;
  } catch {
    return false;
  }
}

/** The caller also retains dismissal in memory when storage is unavailable. */
export function markFeatureGuideSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, SEEN_VALUE);
  } catch {
    // Unavailable/quota-limited storage must not prevent closing the guide.
  }
}
