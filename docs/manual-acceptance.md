# Manual Acceptance Scope

Automated tests verify request formats, subtitle timing, persistence, UI actions and real video encoding. The following release checks still require a person or a different target environment. An unperformed check is not a pass.

## Clean Windows installation

On both Windows 10 x64 and Windows 11 x64, without Node.js, Python, FFmpeg or build tools:

1. Install the NSIS package as a normal user. Check startup, Chinese UI, window size and fonts.
2. Select local recognition and install the Base model with one action.
3. Check download progress, cancellation, restart and network failure recovery. A partial file must not be treated as an installed model.
4. Import a video from a path containing spaces and Chinese characters. Recognize, translate, preview and export MP4.
5. Restart and check retained jobs, subtitle revisions and settings. Verify installation/uninstallation file handling.

A successful build or test on the development computer does not replace this clean-machine check.

## Real user-owned API credentials

The deterministic suite uses local HTTP provider fixtures. A separately authorized real DeepSeek desktop suite passed translation, selected retranslation, AI style and Chat/Responses/Anthropic-format requests using local Whisper speech; it did not call cloud speech. Native OpenAI, Anthropic and Gemini services still require actual target credentials and models. Verify:

- Translation and AI style design: connection test, whole-job translation, selected retranslation and natural-language style generation.
- OpenAI-format speech: the selected model actually provides segment timestamps. A text-only transcription response must fail clearly.
- Compatible custom endpoints: base URL, model and Chat/Responses setting match the service's actual capabilities.
- Authentication failure, exhausted quota, rate limiting, timeout and network interruption produce useful errors and can be retried.
- Session-only credentials are unavailable after restart. Persisted credentials are locally encrypted and absent from ordinary profile reads and exported artifacts.

Use Chinese, English and intended source languages to assess recognition accuracy, proper nouns, contextual translation and reading speed. Never put keys into acceptance records.

## Subtitle and video appearance

For the optional-translation and review workflow, verify both local and URL import mode choices. Original-language projects must generate/repair/export without configuring a translation service; switching a translated project to original-only must show source text while retaining stored translations. Check the compact editor at 1050x700, both sidebar states and Windows scaling: scroll subtitles, settings and long inline forms while the preview and action bar remain visible. Check packaged taskbar/executable/installer icons and that Alt does not restore File/Edit/View/Window.

Check AI text-review suspicions against intended languages and real text providers. Verify every inspected cue has one grade (无/低/中/高) under the same versioned rules, with grounded reasons for nonzero grades. Review a coherent passage, a minor punctuation issue, a concrete contextual mismatch and an explicit negation/key-number translation contradiction. Check topic shifts, quotations, humour, spoken ellipsis and unfamiliar names do not alone trigger a high grade. Compare full and selected review context, including batch boundaries and nonadjacent selections; changing a neighbour or inserting/deleting a contextual cue must mark dependent formerly-clear results for recheck. Unreviewed, legacy-ungraded and stale results must remain distinct from “无”. Grade filtering/counts, selecting a grade for scoped repair and the standard explanation must work at minimum window size.

Listen before accepting a repair: review does not analyze audio or guarantee perfectly identical model judgments. Test disjoint selections, a gap without cues, automatically expanded boundary cues, optional combined translation, ignored findings and recheck after editing. Failed/cancelled combined operations must retain the old target subtitles and unrelated corrections.

Use landscape/portrait video, long sentences, CJK text, punctuation, bilingual subtitles, several speakers, silence and background music:

- Check synchronization, sentence boundaries, omissions and duplication. Corrections must appear in both preview and final video.
- On a long video, use the native progress bar and subtitle time buttons to seek forward, backward and near the end before full buffering. Confirm the decoded picture changes to the target and playback continues there, rather than checking only the time label.
- After recognition, check live playback subtitles before translation, after translation and in bilingual mode. Pause and seek across cue boundaries/gaps, edit text/timing inline and switch projects; visible text must follow current media/content. Add/delete from both preview and proofreading, including empty/all-cue timelines. Check lyric highlighting/follow controls and that editing/manual browsing does not scroll input away. Resize portrait/landscape previews and check fullscreen captions and control usability; fullscreen captions are view-only. Browser typography is responsive feedback; inspect the exported video to accept final burn-in appearance.
- For an existing job with repeated tail text, use “重新识别原片” after updating. Check the replacement warning, cancel once to retain current content, then confirm a rerun. Successful recognition replaces source/translated/manual subtitle text and clears cue-specific emphasis; translate again and listen to the tail against the original dialogue. Failed or cancelled reruns must retain the previous subtitle content and exported files.
- Inspect all five templates, regular/bold fonts, outlines, shadows, keyword emphasis and fades. Long lines must remain readable inside the frame.
- Disable subtitle tracks in an external player and confirm MP4/MKV subtitle pixels remain visible.
- Check **导出设置** and the real native folder/save dialogs. Verify persisted independent defaults and per-export changes, H.264/H.265/original-codec behavior, selected resolution/quality and no enlargement of smaller sources. Accept resized subtitle geometry and target CPU encoding performance; unsupported original codecs should ask for an explicit supported encoder.
- Use **导出字幕文件** to export SRT, ASS and VTT after adding/editing/deleting cues. Open them in intended external players/editors and assess timing, encoding and supported styling; video settings must not require a video encode for subtitle files.
- Compare source and output image/audio quality, orientation, dimensions and duration. SRT/VTT retain text/timing; external ASS appearance depends on player support.
- Check 100%, 150% and 200% Windows scaling, keyboard navigation, dialog focus and actual display readability.

## Link import and download preferences

Automated actual Electron tests use an isolated native-directory-dialog fixture and probe the generated media. On a target Windows installation, also check:

- The lower-left **链接导入设置** entry clearly opens preferences, and **链接导入** starts the URL flow. Verify the real Windows directory picker, Chinese/spaced paths, folder creation and permissions; preferences persist after restart.
- Confirm default **1080p** and **original video encoding**, then try intended format/encoder/quality choices. Check effective format explanations, no enlargement of low-resolution sources, conversion progress/cancel and practical performance of H.264/H.265 on the target CPU.
- Install managed tools on a clean machine and test proxy/slow network/site restrictions. Real YouTube/bilibili observations apply to the supplied public links at the recorded test time; login-protected, regional or other videos require separate checks. The app does not automatically read browser cookies or log into sites.
- Play the completed download and check picture/audio synchronization before recognizing speech. Existing user files must remain intact after failure/cancel; the resulting project must continue to find its downloaded source after restart. Moving/deleting the source folder outside the application can invalidate its path.

## Hardware and media compatibility

The environment report records tested CPU/GPU, driver, model and measurements. These observations do not establish support or speed for every NVIDIA card.

- Complete recognition on a target CPU-only computer. Test other target GPUs/drivers and inspect the actual reported backend.
- Confirm CPU fallback when GPU initialization is unavailable or fails.
- Assess long-video wall time, memory/VRAM/disk use and cancellation response.
- Test target camera/phone formats. HDR, unusual color metadata, variable frame rate, rotation and unusual audio tracks require watching actual output.
- Verify export to the intended filesystem. Atomic publication currently requires hard-link support (normally a local NTFS volume); unsupported FAT/exFAT/network destinations produce `DESTINATION_UNSUPPORTED` and require choosing a supported folder. Existing files are never overwritten.
- Check intended proxy, enterprise certificate, offline/slow-network and antivirus environments.

## Acceptance record

Record application/Windows versions, CPU/GPU/driver, model, provider/model name, media characteristics, actions, expected/actual results and screenshots. Retain reproducible steps for failures. Do not commit personal media or API credentials.
