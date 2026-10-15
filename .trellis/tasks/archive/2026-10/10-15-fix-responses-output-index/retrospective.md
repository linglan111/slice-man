# Bug analysis: reasoning-first Responses

## 1. Root cause category

- E, implicit assumption: Responses output-item indexes were treated as Chat alternative-choice indexes; only zero was accepted.
- B, external contract: reasoning and message are separate output items, and both have content-part lifecycle events.
- D, coverage gap: existing mocked Responses tests emitted only text at index0 or returned ordinary JSON. Previously gated live tests did not establish compatibility.

## 2. Why the first correction was insufficient

The initial index fix added type/identity checks but assumed every content part belonged to a message. This rejected actual reasoning content-part events before the first normal answer byte. Three real HTTP200 requests exposed this immediately. The incomplete fixture did not reproduce this shape, so the initial local check passed. The revised official-shape fixture first reproduced six failures, then passed after kind-aware handling. The initial real failures remain recorded and cannot be labelled as successful live validation.

## 3. Prevention mechanisms

| Priority | Mechanism | Concrete action | Status |
| --- | --- | --- | --- |
| P0 | Protocol semantics | Separate Responses item/part indexes from Chat choices; classify reasoning/text before binding identity | Fixed |
| P0 | Fixture coverage | Full reasoning content added/done, text item1, final output and multiple text parts | Added |
| P0 | Persistence regression | Real HTTP, files/SQLite, actual Electron, no saved reasoning, published statuses and restart | Added |
| P0 | Honest live evidence | Explicit bounded calls, raw SSE forwarding, immutable failed ledger, fail fast after an unsuccessful operation | Added |
| P1 | Spec sync | Document valid reasoning-first lifecycle and distinguish JSON fallback/local fixture/live coverage | Updated |

## 4. Systematic expansion

The shared parser is used by chapters, subtitle review, names, translation and style. Correct the shared provider boundary; do not switch user mode, bypass validation, increase timeouts or alter stored projects to conceal the problem. Reuse existing negative tests for refusal/tools/truncation/incomplete or mismatched final text.

## 5. Knowledge capture

The executable contracts and test expectations are captured in `.trellis/spec/shared/ai-chapters-and-artifacts.md`. Live outcomes and budget accounting are recorded separately in this task's research/validation so local regression success never substitutes for an actual upstream result.
