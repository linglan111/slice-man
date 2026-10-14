import type { ReactNode } from 'react';

type IconName = 'import' | 'link' | 'video' | 'engine' | 'settings' | 'download' | 'export' | 'collapse' | 'expand' | 'recognize' | 'translate' | 'review' | 'repair' | 'edit' | 'generate' | 'add' | 'names' | 'style' | 'chapters';
const paths: Record<IconName, string> = {
  import: 'M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5',
  link: 'm10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0m4 1 2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0',
  video: 'M4 4h16v16H4zM4 8h16M8 4v4m8-4v4m-6 4 5 3-5 3z',
  engine: 'M6 6h12v12H6zM9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  download: 'M12 3v12m-4-4 4 4 4-4M4 20h16',
  export: 'M14 3h7v7m0-7-11 11M10 4H3v17h17v-7',
  collapse: 'M3 4h18v16H3zM8 4v16m8-12-4 4 4 4',
  expand: 'M3 4h18v16H3zM8 4v16m4-12 4 4-4 4',
  recognize: 'M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4',
  translate: 'M3 4h10M8 2v2M5 4c1 5 3 7 7 9M11 4c-1 5-3 7-7 9m9 7 4-10 4 10m-6-3h5',
  review: 'm4 12 4 4 6-8M15 3h6v18H3V3h8',
  repair: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1',
  edit: 'm4 16 12-12 4 4-12 12H4zM13 7l4 4',
  generate: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  add: 'M4 4h16v16H4zM12 8v8m-4-4h8',
  names: 'M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 21v-2a7 7 0 0 1 10-6m3 5 2 2 4-5',
  style: 'M4 5h12M10 5v14m-4 0h8M18 3v6m-3-3h6',
  chapters: 'M3 4h7v16H3zM14 4h7v7h-7zM14 15h7m-7 5h7',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }): ReactNode {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
