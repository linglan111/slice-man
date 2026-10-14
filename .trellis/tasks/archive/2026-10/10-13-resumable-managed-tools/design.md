# Design boundary

## Dependencies
Independent of all AI/chapter children. Coordinate new IPC/result types with parent but do not edit chapter/provider modules.

## Ownership
Stable pinned artifact cache, Range transport, RuntimeService and managed yt-dlp/Deno installation consumers/status, free-space accounting and explicit cache clear. Renderer consumer integration coordinated by parent.

Follow ../10-13-ai-chapters-resumable-tools/design.md for contract, data flow, capacity, failure/publication, compatibility and cleanup rules. Parent coordinates shared App/JobService/IPC/schema files; do not overwrite other workers. A material design change returns to parent planning review.

## Evidence
Load curated specs/research in implement.jsonl/check.jsonl, with child-side loading if native injection is absent. No newly passing test claim is made during planning.
