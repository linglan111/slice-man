"""Execute the exact four-batch plan confirmed by the user on 2026-10-11."""
from pathlib import Path
import json
import os
import subprocess
import zipfile

root = Path.cwd()
evidence = root / '.trellis/tasks/10-10-ui-segment-reprocessing/evidence'
plan = json.loads((evidence / 'commit-plan.json').read_text(encoding='utf-8'))
commit_environment = os.environ.copy()
# Reuse the existing AI-authored repository baseline identity for these AI
# commits. No local/global Git configuration or human identity is changed.
commit_environment.update(GIT_AUTHOR_NAME='Codex', GIT_AUTHOR_EMAIL='codex@local.invalid', GIT_COMMITTER_NAME='Codex', GIT_COMMITTER_EMAIL='codex@local.invalid')

def git(*arguments, data=None):
    result = subprocess.run(['git', *arguments], cwd=root, input=data, capture_output=True, env=commit_environment)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace') or result.stdout.decode('utf-8', errors='replace'))
    return result.stdout

receipt = evidence / 'work-commits.json'
commits = json.loads(receipt.read_text(encoding='utf-8')) if receipt.exists() else []
resume_index = len(commits)
assert resume_index < len(plan['groups'])
assert [item['message'] for item in commits] == [group['message'] for group in plan['groups'][:resume_index]]
initial_staged = set(git('diff', '--cached', '--name-only').decode().splitlines())
assert initial_staged <= set(plan['groups'][resume_index]['files']), 'Existing staged work must not be included'
assert git('branch', '--show-current').decode().strip() == 'codex/ui-segment-reprocessing'
expected_head = commits[-1]['oid'] if commits else git('rev-parse', 'fc26c3e').decode().strip()
assert git('rev-parse', 'HEAD').decode().strip() == expected_head, 'Unexpected starting history'
with zipfile.ZipFile(evidence / 'source-before.zip') as archive:
    original = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
all_paths = {name for group in plan['groups'] for name in group['files']}
working_bytes = {name: (root / name).read_bytes() for name in all_paths}

def stage_bytes(name, contents):
    oid = git('hash-object', '-w', '--path=' + name, '--stdin', data=contents).decode().strip()
    git('update-index', '--add', '--cacheinfo', '100644', oid, name)

for index, group in enumerate(plan['groups']):
    if index < resume_index:
        continue
    assert index == resume_index or not git('diff', '--cached', '--name-only').strip()
    if index == 0:
        if not initial_staged:
            for name in group['files']:
                stage_bytes(name, original.get(name, working_bytes[name]))
    else:
        for name in group['files']:
            if name in group.get('partial', {}):
                before = git('show', 'HEAD:' + name).decode('utf-8')
                row = next(line for line in working_bytes[name].decode('utf-8').splitlines() if '[subtitle-review-reprocessing.md]' in line)
                assert row not in before
                lines = before.splitlines(True)
                header = next(i for i, line in enumerate(lines) if line.startswith('| File '))
                lines.insert(header + 2, row + '\n')
                stage_bytes(name, ''.join(lines).encode('utf-8'))
            else:
                git('add', '--', name)
    staged = set(git('diff', '--cached', '--name-only').decode('utf-8').splitlines())
    # CRLF-only byte differences can normalize to an unchanged tracked blob.
    assert staged and staged <= set(group['files']), f'Unexpected staged paths: {staged - set(group["files"])}'
    if index == 0:
        # The approved baseline intentionally preserves existing source and
        # third-party notices verbatim, including their existing whitespace.
        result = subprocess.run(['git', 'diff', '--cached', '--check'], cwd=root, capture_output=True)
        (evidence / 'baseline-whitespace-check.txt').write_bytes(result.stdout + result.stderr)
        assert result.returncode in (0, 2)
    else:
        git('diff', '--cached', '--check')
    # Only this exact index exists, so the baseline staged bytes are committed as-is.
    output = git('commit', '-m', group['message']).decode('utf-8', errors='replace')
    oid = git('rev-parse', 'HEAD').decode().strip()
    commits.append({'message': group['message'], 'oid': oid, 'files': len(staged), 'approvedPaths': len(group['files'])})
    (evidence / 'work-commits.json').write_text(json.dumps(commits, indent=2), encoding='utf-8')
    print(output.splitlines()[0], flush=True)

assert not git('diff', '--cached', '--name-only').strip()
for name, contents in working_bytes.items():
    assert (root / name).read_bytes() == contents, 'Working file was changed: ' + name
plan['status'] = 'User confirmed; all four work commits completed on 2026-10-11'
plan['commits'] = commits
(evidence / 'commit-plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
print('All approved work commits completed; working file bytes preserved.', flush=True)
