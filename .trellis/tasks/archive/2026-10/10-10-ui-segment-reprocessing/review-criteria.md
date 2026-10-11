# Contextual review criteria

User clarification on 2026-10-11: analyze subtitles jointly with context, grade every cue as 无/低/中/高, and establish fixed standards across repeat checks.

## Meaning of the grades

Grades measure suspicion and the potential effect on subtitle comprehension. They do not measure confidence that ASR matches the audio, because review does not read audio.

| Grade | Evidence and effect | Typical example |
| --- | --- | --- |
| 无 | No obvious contextual, source, active-translation or timing issue was identified using the supplied dialogue. | A sequence explaining import, recognition and proofreading remains coherent. |
| 低 | Minor wording/typography/readability issue, or a weak contextual signal, with no clear material meaning change. | A small punctuation problem; an awkward transition that can reasonably be ordinary spoken language. |
| 中 | A specific contextual, meaning or reading problem supports suspicion; the intended wording still requires human listening or confirmation. | A subtitle about exporting video unexpectedly names an unrelated control, with surrounding subtitles providing a concrete reason to suspect a wrong word. |
| 高 | Strong textual evidence of a severe meaning or readability problem; use conservatively. | Source says “不要删除原文件” but its stored translation says “Delete the original file”; a key quantity changes from 12 to 120. |

High source-coherence issues require sustained severe breakdown and supporting neighbouring context, not merely a new topic. Time concerns must be based on supplied timestamps/text, never an invented acoustic alignment claim. Exact rule IDs and any measurable rule prerequisites are owned by one canonical shared rubric in code.

## Counterexamples and consistency

- A topic shift, quoted statement, humour, omitted spoken subject, unfamiliar name or disagreement with external world knowledge alone does not establish a severe subtitle error.
- Read the chronological dialogue and available neighbours together. Sparse selected cues are not adjacent dialogue; selected and full reviews use the same canonical context window for each cue.
- Every request uses the same versioned definitions, rule IDs and examples. The model selects supported rules and explains evidence; the application maps those rules to fixed grades and takes the maximum supported grade for a cue.
- The model must explicitly return every target cue exactly once. An omitted cue is a failed response, never “无”. An explicit empty issue list means no issue identified.
- References must point to the supplied cue/context IDs. Reasons explain the actual mismatch; no replacement text or time patches are accepted.
- Stored reports record rubric/model/context fingerprints. Changes to supplied context invalidate dependent results, including previously “无” cues. Unreviewed, old ungraded and changed results stay distinguishable.
- Fixed standards and stable context reduce variation; model rule-selection judgment can still vary. Do not claim perfect repeatability or proof of spoken wording.

## Interface

Use an accessible grade badge on each cue and one compact selector for all/pending/four grades with current counts. Keep the existing time order, local scrolling, seek/edit/recheck/ignore and scoped repair controls. The standard explanation uses the shared rubric so the UI and prompt cannot drift apart.
