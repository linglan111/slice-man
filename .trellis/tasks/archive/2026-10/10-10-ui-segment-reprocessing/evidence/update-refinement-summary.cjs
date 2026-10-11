const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = __dirname;
const summaryPath = path.join(directory, 'e2e-summary.json');
const beforePath = path.join(directory, 'e2e-summary-before-contextual.json');
if (!fs.existsSync(beforePath)) fs.copyFileSync(summaryPath, beforePath);
const summary = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const contextual = JSON.parse(fs.readFileSync(path.join(directory, 'contextual-four-grade-workflow.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(directory, 'source-only-workflow.json'), 'utf8'));
const finalLog = fs.readFileSync(path.join(directory, 'refinement-final-layout-contextual-e2e.log'), 'utf8');
if (!finalLog.includes('2 passed') || finalLog.includes('1 failed')) throw new Error('Final two-case gate not passed');
for (const output of source.outputs) if (!fs.existsSync(output)) throw new Error(`Missing preserved export: ${output}`);
summary.distinctTests = 20;
summary.passed = 20;
summary.result = '20 distinct tests passed across original and refinement batches: 16 affected regressions plus four task cases. The four refinement cases passed across batches; the final CSS/help build reran and passed contextual review and minimum/default layout. Counts do not mean all 20 ran against one build.';
summary.batches.push(
  {log: 'refinement-e2e.log', result: '3 passed (contextual four-grade case, layout and both-mode import); one source-only test still used the removed batch button, migrated without weakening processing/export assertions.'},
  {log: 'refinement-source-only-e2e.log', result: '1 passed: source-only workflow uses pending filter/select + scoped repair; ASR7, review4, translation0, permanent real exports preserved.'},
  {log: 'refinement-final-layout-contextual-e2e.log', command: "npx playwright test tests/e2e/contextual-review.spec.ts tests/e2e/subtitle-workspace.spec.ts -g 'all cues receive|fixed preview'", result: '2 passed against final build: graded selected/pending/report/help at 1050x700, real decoded overview, four filters, legacy restart, original default/minimum portrait/banner/inline/range/menu/shortcuts.'}
);
summary.sourceOnlyEvidence.reviewRequests = source.counters.review;
summary.refinement = {
  distinctTests: 4, passed: 4, finalBuildRerunTests: 2,
  rubricVersion: contextual.rubricVersion, cueCount: contextual.cueCount,
  initialGrades: contextual.initialGrades,
  allTargetsExplicit: true, crossBatchContext: true,
  quickHighOnlyRepair: true, neighborEditInvalidatesNoneAndIssues: true,
  legacyUngraded: true, localHelpVersion: 'v1',
  minimumLayout: contextual.minimumLayout,
  buildLog: 'refinement-final-build.log',
  typecheckLog: 'refinement-typecheck.log',
  mainBuildSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve('out/main/index.js'))).digest('hex'),
  screenshotOverview: 'contextual-four-grade-overview.png',
  screenshots: ['contextual-grade-none.png', 'contextual-grade-low.png', 'contextual-grade-medium.png', 'contextual-grade-high.png', 'contextual-layout-selected-minimum.png', 'contextual-layout-pending-minimum.png', 'contextual-minimum-pending-standards.png', 'contextual-neighbour-change-stale.png', 'contextual-legacy-ungraded.png'],
  priorArtifacts: 'Earlier package/check artifacts refer to the pre-refinement build. Native final package evidence is coordinator-owned.',
  supersededFailures: ['refinement-e2e.log source-only selector', 'refinement-final-contextual-e2e.log graded selected overflow', 'refinement-layout-diagnostic.log same overflow']
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'refinement-e2e-summary.json'), JSON.stringify(summary.refinement, null, 2) + '\n');
console.log('20 distinct tests passed across original/refinement batches; final two-case gate passed. All permanent source-only exports exist.');
