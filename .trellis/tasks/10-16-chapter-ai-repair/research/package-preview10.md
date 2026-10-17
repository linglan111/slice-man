# Windows preview 10 packaging evidence

Date: 2026-10-17 (Asia/Hong_Kong). Packaging-only teammate, released by the leader after the independent resize review. No source changes, Git commit, installation, paid AI call, or broad regression run were performed.

## Deliverable

- Installer: `F:/Code/slice man/dist/verification-0.1.5-preview.10-20261017/Slice Man Setup 0.1.5-preview.10.exe`
- Version: `0.1.5-preview.10` (CLI extra metadata only).
- Target: Windows x64, NSIS, interactive current-user installer.
- Size: **186,186,498 bytes** (177.56 MiB).
- SHA-256: `F1DBA283E527007C06CAD34E6D2B890654E2DA12C3225268F3FEA79F26A685C6`.
- Packaged `app.asar` SHA-256: `5ED01934F1385D8C1BBD03BF9009A39499DBBD60587C3D73824D6CD521A282F5`.
- Tracked `package.json` remains `0.1.4`; no package or lockfile delta was introduced.

## Commands and build result

The output directory did not exist at preflight. Earlier preview/release output directories were preserved.

```powershell
npm run build
npx electron-builder --win nsis --x64 --config.extraMetadata.version=0.1.5-preview.10 --config.directories.output=dist/verification-0.1.5-preview.10-20261017
node .native-smoke/verify-preview-package-10.cjs
```

All three final commands exited 0. Toolchain: Node 24.17.0, npm 11.13.0, electron-builder 26.15.3; packaged Electron 42.11.11, native ABI 146. Normal cached Electron extraction succeeded; no `electronDist` fallback or TLS override was needed. Existing Zod annotation warnings were nonfatal. The configured executable signing is disabled; builder reported signing skipped. Installer blockmap and `latest.yml` were produced.

Logs:

- `.native-smoke/verification-0.1.5-preview.10-build.log`
- `.native-smoke/verification-0.1.5-preview.10-package.log`
- `.native-smoke/verification-0.1.5-preview.10-verify.log`

The verifier initially used slash separators unsupported by this Windows ASAR extractor and stopped before launch. Its ignored local helper was corrected to use native `path.join`; the final complete verification passed. No application code or output was changed to resolve this helper issue.

## Bundle and packaged smoke verification

`dist/verification-0.1.5-preview.10-20261017/package-verification.json` contains complete packaged host metadata, output file hashes and resource checks. Every generated `out/` file was extracted from `app.asar` and compared byte-for-byte against the just-built local file:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `out/main/index.js` | 399070 | `8D3CB0D08D9E883D0C7713606CEEF54E0E064D29CDB0576DBF41CECE6FAA8C1C` |
| `out/preload/index.js` | 222779 | `D8FF26D4A2E2871BA8F44D9E91B3F15152C441C5AB463CE451E51757EC3F29AF` |
| `out/renderer/index.html` | 366 | `EBB9644717C32011B481E9122C8DA829808E8A442DCD28AB5DC343949C8F21EF` |
| `out/renderer/assets/index-BM5P8itC.js` | 1130207 | `24A65BFA7E834A65325F5DF308BC3D699C8BBE9DFC010C9A7EED8F092989E8D3` |
| `out/renderer/assets/index-DOopy7bo.css` | 57869 | `CED069EC944A995E5A40EA5B4187B38CB86FFF9CC7EB0350F6F99C5D11C72CC7` |

A fresh packaged process was launched from the new `win-unpacked` with isolated data at `F:/Code/slice man/.native-smoke/preview-0.1.5-preview.10-user-data`. It reported `app.isPackaged=true`, version `0.1.5-preview.10`, the expected isolated data path, and a local packaged `file:` renderer. Real profile persistence and runtime IPC succeeded; the empty isolated database had zero profiles. The helper closed only its own Playwright application handle.

Verified required packaged files: SQLite native binding, FFmpeg, FFprobe, regular/bold Noto CJK fonts, FFmpeg and application notices, runtime smoke WAV. Startup screenshot: `dist/verification-0.1.5-preview.10-20261017/verification-startup.png`.

The existing installed executable `F:/Soft/Slice Man/Slice Man.exe` retained SHA-256 `1BA170A6C021F433E5A23581A7D25F2B0060E62FBF6AF52FC9165A8700E1A2A1` before and after packaging. No install, upgrade, uninstall, or user process termination command was issued. This evidence verifies packaging/startup and current bundle inclusion; the user will perform installer/manual feature validation.
