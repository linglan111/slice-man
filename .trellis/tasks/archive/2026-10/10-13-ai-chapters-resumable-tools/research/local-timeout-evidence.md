# Sanitized local timeout evidence

Read-only inspection on2026-10-13 of the installed app's SQLite database, querying only configuration and job metrics. No encrypted keys, API keys, endpoints, subtitle contents or user filenames were printed; no provider request or DB write occurred.

- Most recent project:1027 cues, duration3744554ms (~62m24.554s), configured review service protocol OpenAI-compatible, model`deepseek-flash`, timeout120000ms. Review and names both resolve this reviewProfileId.
- This project has neither persisted reviewReport nor nameReport. This does not prove which requests failed or their elapsed timing.
- Older project:269 cues, duration699339ms, no configured review profile.
- Only one persisted profile was present, with the same120000ms deadline.

Together with requestJson's three fresh-deadline attempts and full response.text consumption, the observed PROVIDER_TIMEOUT identifies a120-second local per-attempt deadline; up to360.75seconds can elapse across three attempts. Larger whole-timeline requests and delayed reasoning/output are plausible causes, but there is no timing log to discriminate provider generation, connection, first-byte latency or network stalls. Do not assert a confirmed remote/model failure or run paid diagnostics automatically.

Planning requirement: introduce sanitized operation/request timing, prompt byte/cue metrics, distinct deadline/network/HTTP error presentation and user-controlled long-text timing; do not silently regenerate an entire expensive request after a generation deadline. Retain existing one-complete-selection review and global-name context unless the user explicitly changes those requirements.
