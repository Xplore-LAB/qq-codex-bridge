# Operations

Use `qq-codex-bridge check` for offline validation and `probe` to read the current Codex thread. `auth-check` contacts Tencent without sending messages. Only `start` begins receiving and processing QQ messages. Binding and starting are deliberately separate commands.

For a background Linux deployment, customize `qq-codex-bridge.service.example`, then install it into `~/.config/systemd/user/`. Set `ExecStart` to the actual CLI path reported by `command -v qq-codex-bridge`. Enable it only after pairing and account testing.

Do not run two consumers for the same bot identity. If migrating a bot from OpenClaw, explicitly disable only its old QQ channel first. The bridge does not automatically change OpenClaw configuration or reuse its credentials.

When a task's outcome is known, a restart can reconcile its turn ID and continue delivery. An interrupted handoff or ambiguous send is marked uncertain rather than repeated blindly. Check the desktop session or QQ inbox before deciding how to recover it. `/retry` retries a known failed delivery, not agent execution.

Logs contain task IDs and failure categories. Credentials, original prompts, attachment URLs, and message text are not intentionally logged. Config and credentials use mode 600; media directories use mode 700. SQLite uses WAL, a busy timeout, and foreign-key enforcement.

Media originals and generated files are not automatically deleted. Retain files needed by active tasks or quote references, and clean old data only after review. To back up the database while running, use SQLite's backup API; copying just the main file can omit active WAL data.

Known constraints: private chats and one paired user only; the primary adapter is pinned to a tested Codex protocol; native QQ streaming and buttons depend on account permissions; STT/TTS must be configured separately; no guarantee of exactly-once execution or delivery across services.

## Mobile Codex commands

`/new` creates and immediately binds an empty thread in the current working directory, using the server's configured defaults. `/fork` copies the current conversation. `/resume` lists the last 15 sessions; `/resume N` selects a numbered entry within ten minutes, or supply a full thread ID. Existing `/session ID` remains available. Pending mobile tasks block session and model changes.

`/model` displays the live catalog. `/model NAME [EFFORT]` (or model number) validates the selection and saves it for subsequent mobile turns in that thread. Settings are applied through `turn/start`, including for empty new threads; they do not retroactively change a running turn. `/compact` starts server-side compaction. `/rename NAME` renames the session. `/history` displays a bounded recent transcript.

`/stop` aliases `/cancel` and only interrupts owner mobile tasks. `/steer TEXT` adds input to the current mobile task with an exact turn-ID precondition. Ordinary messages retain queue semantics and never implicitly interrupt desktop work. `/answer NONCE QUESTION ANSWER` answers actual Codex questions; numbered options are accepted, and answers are owner-, account-, connection- and turn-scoped with a ten-minute expiry. Secret questions require the desktop.

`/skills`, `/mcp`, `/apps` query server inventories; `/usage` queries account rate limits (not a token invoice). Upstream authentication or network failures remain explicit errors. Unknown slash commands are handled locally and never interpreted by the model. Use `/help` or `/` for the text menu; QQ's input autocomplete is not provided by the bridge.

This is not terminal UI parity: interactive login/OAuth, terminal editors, secret inputs and additional permission-grant protocols still require the desktop. Existing execution/file approvals remain supported. No command silently elevates permissions.
