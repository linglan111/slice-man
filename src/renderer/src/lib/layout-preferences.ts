export type LayoutPreferences = { sidebar: number | null; columns: number; secondary: number; editor: number };
export const DEFAULT_LAYOUT: LayoutPreferences = { sidebar: null, columns: .5, secondary: .42, editor: .45 };
export const LAYOUT_KEY = 'slice-man.layout';
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}
export function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_LAYOUT };
    const values = parsed as Record<string, unknown>;
    const bounded = (key: keyof LayoutPreferences, min: number, max: number): number | null => {
      const value = values[key];
      return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : DEFAULT_LAYOUT[key];
    };
    return { sidebar: bounded('sidebar', 160, 300), columns: bounded('columns', .15, .85) ?? .5, secondary: bounded('secondary', .1, .8) ?? .42, editor: bounded('editor', .1, .9) ?? .45 };
  } catch { return { ...DEFAULT_LAYOUT }; }
}
