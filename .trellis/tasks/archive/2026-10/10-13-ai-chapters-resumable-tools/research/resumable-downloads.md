# Research: Resumable managed tool and model downloads

- Query: Which tool/model download paths lose progress, and how can cancellation, network interruption and app restart safely resume without replacing a working installation?
- Scope: mixed; internal source/spec inspection and HTTP standard reference
- Date: 2026-10-13

## Findings

### Exact user-facing scope and files found

| File | Role / evidence |
| --- | --- |
| `src/main/services/runtime/artifacts.ts` | Shared download, SHA-256/size verification and safe ZIP extraction. |
| `src/main/services/runtime/manifest.ts` | Trusted pinned Windows CPU/GPU Whisper archives and all three selectable models. |
| `src/main/services/runtime/index.ts` | Downloads model + CPU + optional GPU, tests actual inference, activates immutable installation with atomic state pointer. |
| `src/main/services/download/manifest.ts` | Trusted pinned standalone yt-dlp executable and Deno archive. |
| `src/main/services/download/lib/download-service.ts` | Tool installer and separate online-video import pipeline; tools activate only after actual version probes. |
| `src/main/index.ts` | Both services receive `app.getPath('userData')`; unpackaged-only fixture manifest substitution. |
| `src/main/ipc/index.ts` | Runtime install/cancel controller, download install/cancel IPC, and cancellation on disposal. |
| `src/shared/contracts.ts`, `src/shared/ipc-validation.ts` | Runtime status/progress and strict typed IPC validation. |
| `src/shared/download-contracts.ts`, `src/shared/channels.ts`, `src/preload/index.ts` | Download status, channel allow-list, validated preload status subscription. |
| `src/renderer/src/components/RuntimeDialog.tsx` | Selectable model, install progress, cancel install; no resume inventory. |
| `src/renderer/src/components/DownloaderDialog.tsx` | Managed tools install, settings, progress and cancel; no resume inventory. |
| `tests/integration/runtime/install.test.ts` | Real loopback downloader integration; retry, abort cleanup, hash rejection and activation rollback. |
| `tests/unit/backend/download.test.ts` | Tool install rollback/version probes, controlled cleanup, active-operation races. |
| `tests/e2e/desktop.spec.ts` | Real CPU installation/inference and failed/cancelled update retention. |
| `tests/e2e/download.spec.ts`, `tests/e2e/download-helpers.ts` | Genuine tool executable fixture installation, corruption, cancel, rollback and import; fixture currently serves full `200` bodies only. |
| `scripts/setup-whisper-fixtures.cjs`, `scripts/setup-download-fixtures.cjs`, `scripts/setup-resources.cjs` | Developer/build acquisitions, separate from application installers. |

All product-facing binary acquisitions currently flow through **one `downloadArtifact` helper**: three Whisper models (Base 147,951,465 bytes; Small 487,601,967; Large v3 Turbo 1,624,555,275), Whisper CPU archive 3,968,674, optional GPU archive 459,854,042; yt-dlp 17,840,399 and Deno archive 42,630,221. Pins are source-controlled exact URL/size/SHA-256. Engine pin is 1.8.3, tool pins 2026.08.19 / 2.9.7; these are observed project pins, not claims about latest releases.

FFmpeg/FFprobe, fonts, notices and the inference sample are installed application resources, not extra downloads exposed in product UI. Their `setup-resources` script downloads at developer/build time. Fixture setup scripts likewise prepare ignored developer caches, not app-owned user downloads. Do not broaden the product requirement into CI/build cache migration unless deliberately chosen.

Online URL/video acquisition belongs to the same DownloadService but uses native yt-dlp, its own `.partial-<UUID>` media directory, optional conversion, and job commit. User wording “各个工具下载” naturally covers all seven managed artifacts above. Preserve online-video cancellation cleanup/commit semantics; resuming online videos is a separate scope decision.

### Root cause and contracts that must survive

- `artifacts.ts:44` makes a plain GET without Range, with one 30-minute request timeout. `:56` resets received bytes to zero each attempt; `:70` opens destination with `flags: 'w'`. `:77` unconditionally removes destination on *every* error, before checking abort. Three bounded retries therefore also restart byte zero.
- `runtime/index.ts:206` uses new UUID staging for every install, `:225`, `:231`, `:263` download model/CPU/GPU to it; `:321` recursively removes staging in `finally`. Keeping a `.part` next to the current destination cannot survive cancellation or subsequent install.
- `download-service.ts:285` similarly creates a UUID tool candidate directory; `:297`/`:303` acquire binaries, `:357` deletes failed candidate. Durable progress must be independent of these directories.
- Runtime activation `runtime/index.ts:285-315` preserves immutable previous installation until pointer rename; models retain previously installed entries. Download-tool activation `download-service.ts:314-341` runs both native version probes and renames an exclusively owned pointer file. Keep these behaviors and actual CPU/GPU inference checks intact.
- `artifacts.ts:18-30` verifies final exact size and complete SHA-256. `:62` bounds incoming bytes. `:104-180` checks ZIP traversal/symlinks/expanded-size ceiling and extracts with exclusive creation. A partial/resumable file must never bypass any of these checks or be executed/extracted.
- `ipc/index.ts:381-382` aborts runtime/download work on disposal. `main/index.ts:168-170` calls disposal before quit. Crash/restart must recover only stable cached bytes, never assume async abort cleanup finished.
- Status currently omits resumable/cache bytes: `contracts.ts:287-303`, strict `ipc-validation.ts:11-33`, `download-contracts.ts:66`. UI has only install/cancel callbacks. Existing install command can serve as resume entry; new cache-clear actions require typed shared/preload/IPC extension.

### Proposed architecture (planning recommendation, not implementation)

1. Add one app-owned download cache directory beneath **userData**, outside runtime staging and tool candidates. Derive entry filename/key from a stable digest of trusted source URL + expected hash + expected size. Never derive paths from response filenames/headers or arbitrary renderer input. Store `key.part`, small versioned `key.json` sidecar and optionally `key.verified` complete payload. Do not use short-lived redirect/signed CDN URL as identity or persist credentials.
2. Metadata holds exact manifest identity, bounded strong ETag / Last-Modified / response Date if available, timestamps and phase. Source manifest remains authority. Load with strict schema and bounded JSON size; actual file `stat` is byte-offset authority, not an untrusted byte counter. Write metadata through unique exclusive temp + close/atomic rename. A crash during metadata update must never allow appending unknown bytes; reject/restart that entry safely.
3. Download into stable cache, then verify whole payload. Copy verified payload into a newly owned install staging path, or use a validated cache-to-staging helper with cancellation and safe exclusive destination creation. Avoid hard links to executables/models that an installer could mutate; avoid consuming the durable file with rename before the entire multi-artifact install succeeds. Existing smoke/version probes and final state activation stay unchanged.
4. Network failure or user cancellation closes write/read streams and retains valid owned partial + metadata. Integrity failures (size excess, mismatched hash, invalid range) discard/quarantine **that entry only**; never remove old installed bytes or parent cache/userData. Complete earlier assets can be reused after a later download/extraction/probe interruption. Recheck complete cached SHA-256 before use, including after restart.
5. Central per-entry locking prevents append/copy/delete races; installers already have separate busy guards but cache clear needs the same lock. Single-instance isolation is by userData; keep dev/prod/E2E separation. Any TTL/size pruning must target only recognized cache files with validated ownership and skip active entries. Prefer explicit “清除下载缓存” with size displayed; never silently delete paused progress under the promise of resume. Cache policy and retention threshold should be made explicit in design.
6. Recalculate free-space requirement for **remaining download + retained complete cache + staging copy + extraction**; current runtime estimate (`:216`) and tool estimate (`:292`) predate durable duplication. Large model copy alone can temporarily double its disk use. Early owned-space failure retains resumable cache and previous install.

### HTTP and byte safety behavior

The following implementation decisions combine HTTP rules below with the project's stronger pinned-artifact requirements:

| Situation | Planned handling |
| --- | --- |
| No cached bytes | Plain GET; request identity encoding; save response validators before streaming. |
| `0 < localBytes < expectedSize` | GET trusted original URL with `Range: bytes=<localBytes>-`; send If-Range only for a legal strong validator. Report progress including prior bytes. |
| Valid `206` | Require single byte Content-Range start exactly equal to actual local size; known total equals pin; end and body size bounded/consistent; reject multipart/encoded bodies. Only then append. |
| `200` for range request | Server ignored range or entity changed. Reset only owned partial/metadata and write new full body, never append it. Show restart reason if visible. |
| `416` | If local length equals pinned full size, locally verify and finish without network. Otherwise invalidate entry/reset once to a full request; bound attempts so malformed servers cannot cause loops. |
| Wrong start/total/validator or overlong body | Do not append questionable data. Close response, invalidate only this entry, structured integrity failure or one bounded fresh retry according to design. |
| Length already equals pin after crash | Run exact full hash before any request/installation; successful result can be reused immediately. |
| Local length exceeds pin, malformed metadata, wrong manifest key, unsafe path | Refuse reuse; preserve unrelated files. Clear only verified owned cache entry. |
| Incomplete clean response / dropped connection | Retain valid prefix; retry remaining range within existing bounded policy. Completion does not imply validity until exact length/hash succeeds. |
| No usable strong HTTP validator | Pinned URL/size/hash still prevents accepting mixed final data. Decide explicitly whether to range with final-hash enforcement (more resumability) or restart conservatively; never send a weak ETag as If-Range. |

Force `Accept-Encoding: identity` and reject non-identity Content-Encoding before combining byte offsets: Fetch decoding can otherwise disagree with representation Content-Range/length. Do not require `Accept-Ranges` to be present before attempting a range. Redirects must still start from pinned origin and end in normal verified HTTPS delivery (loopback HTTP only in existing unpackaged tests). A range-capable GitHub/HuggingFace response is not guaranteed by inspecting source URLs; runtime must handle fallback honestly.

### UI/status plan

- Keep install buttons resumable automatically: interrupted item shows saved bytes and “继续下载/继续安装”; active cancel can read “暂停下载” when bytes are retained, while cancellation during extraction/probing is accurately described.
- Runtime status should report relevant cached model/CPU/GPU asset entries; model selection chooses its own resumable entry and does not erase other models' progress. Download status adds managed-tool resume summary separate from online-video state. Expose labels/bytes/total/resumable/cache state, never internal paths or arbitrary URLs.
- On app restart status scans validated cache metadata; changing selection shows the proper saved progress. No automatic background download on opening settings. Progress fraction includes prefix and weighted asset stages; 100% is reached only after verification and installation completes. Byte progress and verification/install phases should be distinct.
- Add a cache-clear action if design adopts manual cleanup; busy guard, scoped namespace and safe typed enum IDs instead of renderer-supplied filesystem paths. Update strict result/event schemas together, preload subscription cleanup and tests.

### Meaningful deterministic verification plan

1. Extend loopback HTTP fixture with captured Range/If-Range headers, chunk throttling, connection drop at known offset, strong ETag/change mode, full-200 fallback, valid/invalid 206 and 416. Assert actual transferred bytes and exact resumed offset, not only request count/UI text.
2. Cancel after a committed nonzero prefix; assert cache remains, install staging disappears, no activation, previous pointer/executable/model bytes unchanged. Reinstantiate service with same cache root and resume; ensure full hash/native probes succeed and no prefix bytes are retransferred.
3. Simulate abrupt termination with persisted part/sidecar then launch real isolated Electron again; verify visible resume action and final install. Graceful-close abort and forced child kill are distinct cases. Never kill the user's app.
4. For each managed asset category (model, CPU ZIP, GPU ZIP, yt-dlp executable, Deno ZIP), interrupt acquisition and finish via resumed fixture; parameterize all selectable model identities/key separation. Preserve CPU fallback and old working tools on GPU/version/integrity failures.
5. Cover changed ETag returning200 (no duplicate prefix), range ignored200, bad Content-Range start/total/end, compressed body, truncated/overlong body, same-size wrong hash, 416, full cached verified body, malicious/invalid metadata, symlink/junction parent, stale write temp and concurrent clear/install. Existing unrelated/cache sibling files survive cleanup.
6. If a complete asset is cached when a later asset fails, retry must reuse it rather than download again; if pin changes, isolate new key and never combine old partial. Cache locking and UI status must distinguish ready installed version from incomplete replacement.
7. Revise `tests/integration/runtime/install.test.ts:112` (“cancels ... removes its partial file”) to assert final staging absent **and durable cache retained**. Keep online-video tests that require partial-media deletion unchanged. Update mocked `downloadArtifact` in tool unit tests when helper signature/config changes.
8. Keep real CPU inference/Electron tool probes in existing E2E; local range fixtures prove transport correctness, not external CDN resume availability. Large live downloads are not needed for deterministic coverage and were not run in this research.

### External references

Primary reference: [RFC 9110 (HTTP Semantics, June 2022), If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5), [Content-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4), [416 Range Not Satisfiable](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.17). Checked 2026-10-13.

HTTP-specific summary: servers may ignore Range; If-Range mismatch requests full representation. Weak ETags cannot be used for If-Range; HTTP dates require strong-validator conditions. A 206 Content-Range identifies the returned interval and representation length. A 416 can describe current length. These response semantics require client validation before appending. Other recommendations above are proposed project security/integrity choices rather than additional claims made by the standard.

### Related specs

- `.trellis/spec/backend/online-download.md`: pinned tools, version probe, immutable rollback, owned confined cleanup, strict settings/status, separate model/install cancellation, isolated native fixtures.
- `.trellis/spec/shared/native-runtime-testing.md`: whole-resource hash, inference-proven ready status, failed/cancelled activation retention, packaged fixture flags forbidden, single-instance userData isolation, real/mock evidence separation.
- `.trellis/spec/backend/environment.md`: independent dev/prod paths and setup order.
- `.trellis/spec/backend/index.md`: typed strict boundaries, domain service layout, thin IPC handlers, English documentation.
- Current native-runtime spec says truncated artifacts are cleaned. New resumable cache semantics must clarify **owned staging cleanup versus valid durable prefix retention**; do not simply remove the existing integrity rule.

## Caveats / Not Found

- No current durable download cache/resume metadata or HTTP range client found in product acquisition path. Media playback Range support (`src/main/lib/media-protocol.ts`) is a server for local files and is not a reusable network download client.
- No live external artifact acquisition/install, native process launch, product edit, task activation or git mutation performed. Root task only is authoritative; this report writes solely inside its research directory.
- User requested tool downloads; online-video import resume and developer/build helper reuse are optional separate scope, not silently included.
- Restart-safe cache ownership, missing-validator policy, cache retention/clear behavior and status schema shape remain design decisions for the planning parent.
