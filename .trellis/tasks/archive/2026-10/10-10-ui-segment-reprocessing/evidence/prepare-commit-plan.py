"""Build a reviewable plan only; this never stages or commits anything."""
from pathlib import Path
import difflib
import json
import subprocess
import zipfile

root = Path.cwd()
evidence = root / '.trellis/tasks/10-10-ui-segment-reprocessing/evidence'
with zipfile.ZipFile(evidence / 'source-before.zip') as archive:
    original = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
paths = set(original)
for directory in ('src', 'tests', 'scripts'):
    paths.update(path.relative_to(root).as_posix() for path in (root / directory).rglob('*') if path.is_file())
changed = []
patches = []
for name in sorted(paths):
    path = root / name
    current = path.read_bytes() if path.exists() else b''
    before = original.get(name, b'')
    if current == before:
        continue
    changed.append({'path': name, 'kind': 'modified' if name in original else 'added'})
    try:
        patches.extend(difflib.unified_diff(before.decode('utf-8-sig').splitlines(True), current.decode('utf-8-sig').splitlines(True), fromfile='before/' + name, tofile='after/' + name))
    except UnicodeDecodeError:
        patches.append('Binary asset changed: ' + name + '\n')
(evidence / 'source-changes.json').write_text(json.dumps(changed, indent=2), encoding='utf-8')
(evidence / 'task-source-review.patch').write_text(''.join(patches), encoding='utf-8')

baseline_extras = ['.gitignore', '.npmrc', 'electron.vite.config.ts', 'eslint.config.mjs', 'playwright.config.ts', 'tsconfig.json', 'vitest.config.ts', 'resources/runtime-smoke.wav']
baseline_extras += [path.relative_to(root).as_posix() for path in (root / 'resources/notices').glob('*') if path.is_file()]
backend = [item['path'] for item in changed if item['path'].startswith(('src/main/', 'src/preload/', 'src/shared/', 'tests/integration/', 'tests/unit/backend/', 'tests/unit/shared/'))]
frontend = [item['path'] for item in changed if item['path'] not in backend and item['path'] != 'README.md']
frontend += ['resources/icons/icon.svg', 'resources/icons/icon.png', 'resources/icons/icon.ico']
docs = ['README.md', 'docs/manual-acceptance.md', '.trellis/spec/frontend/live-subtitle-preview.md', '.trellis/spec/frontend/css-design.md', '.trellis/spec/shared/subtitle-contracts.md', '.trellis/spec/shared/subtitle-review-reprocessing.md', '.trellis/spec/shared/index.md']
groups = [
    {'message': 'chore: track existing application baseline', 'files': sorted(set(original) | set(baseline_extras)), 'source': 'Original source-before.zip bytes for captured paths; existing current bytes only for explicitly listed baseline extras. Do not change working files.'},
    {'message': 'feat: add optional translation and contextual subtitle repair', 'files': backend},
    {'message': 'feat: refine subtitle workspace and application identity', 'files': sorted(set(frontend))},
    {'message': 'docs: define subtitle review and reprocessing contracts', 'files': docs, 'partial': {'.trellis/spec/shared/index.md': 'Stage only the subtitle-review-reprocessing.md row added by this task.'}},
]
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines()
included = {name for group in groups for name in group['files']}
excluded = sorted(set(untracked) - included)
excluded += ['.trellis/spec/backend/index.md (pre-existing tracked changes)', '.trellis/spec/frontend/index.md (pre-existing tracked changes)', '.trellis/spec/shared/index.md (pre-existing rows excluded)']
plan = {'status': 'Awaiting one-shot user confirmation; no staging performed', 'groups': groups, 'excluded': excluded, 'bookkeeping': 'After work commits, Trellis archives only this task and records its journal. Other tasks and unrelated configuration remain untouched.'}
(evidence / 'commit-plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
lines = ['# Proposed commit plan', '', 'No files have been staged. Reply 行 to approve all four batches, or 我自己来 to handle Git yourself.', '', 'The repository currently tracks guidance only. Batch 1 explicitly includes the existing application baseline so a checkout is reproducible; captured original bytes will be staged without replacing working files. This inclusion requires your confirmation.', '']
for index, group in enumerate(groups, 1):
    lines += [f"## {index}. {group['message']}", '']
    if 'source' in group:
        lines += [group['source'], '']
    if 'partial' in group:
        lines += [group['partial']['.trellis/spec/shared/index.md'], '']
    lines += ['- ' + name for name in group['files']]
    lines += ['']
lines += ['## Excluded / unrecognized paths', '', 'Current task artifacts below are reserved for the later archive commit; all other listed paths remain untouched.', '']
lines += ['- ' + name for name in excluded]
(evidence / 'commit-plan.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'changed_source_paths': len(changed), 'batches': [(g['message'], len(g['files'])) for g in groups], 'excluded': len(excluded)}))
