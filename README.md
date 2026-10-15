# QQ–Codex Bridge

Use QQ private messages to work with an existing local Codex session and exchange images, documents, audio, and video.

This is a standalone command-line tool built with TypeScript, the Tencent QQ SDK, SQLite, and the Codex App Server protocol. It does not require OpenClaw. It refuses to share a bot identity that is still enabled in an OpenClaw QQ channel, preventing two agents from independently executing the same message.

## Install

Requirements: Linux or macOS, Node.js **24**, a signed-in Codex CLI with its app server running, and QQ bot credentials or QR onboarding access. Install FFmpeg for audio conversion and video frame extraction. The optional queue fallback also requires Python 3.

```bash
git clone https://github.com/Xplore-LAB/qq-codex-bridge.git
cd qq-codex-bridge
npm ci
npm test
npm link
qq-codex-bridge --help
```

Private repository access requires your normal GitHub authentication. This repository is not published to the public npm registry.

## Configure an existing session

Copy the ID of the existing Codex session you want to continue. The tool does not silently create another user session.

```bash
qq-codex-bridge init --thread YOUR_EXISTING_THREAD_ID
qq-codex-bridge check
qq-codex-bridge probe
```

`init` creates configuration and an empty task database. It does **not** contact QQ. `check` validates the local environment. `probe` reads the existing Codex session without submitting a prompt.

By default, data lives outside the installed package:

| Data | Location |
| --- | --- |
| Configuration | `~/.config/qq-codex-bridge/config.json` |
| Credentials | `~/.config/qq-codex-bridge/credentials.json` (mode 600) |
| Task database | `~/.local/state/qq-codex-bridge/bridge.db` |
| Media files | `~/.local/share/qq-codex-bridge/media/` |

Set `QQ_BRIDGE_CONFIG_DIR` to isolate another installation. `init` also accepts `--state-dir`, `--media-dir`, `--socket`, `--app-id`, and `--owner`. `CODEX_HOME` controls the default Codex socket and fallback history database location. Existing configuration is not silently overwritten.

## Bind and connect

Finish local checks before connecting a robot. Use a dedicated QQ bot, or explicitly migrate its existing channel first.

```bash
qq-codex-bridge bind
```

Scan the QR code at the path printed by the command. When a new bot identity is bound, send the printed `/pair ...` command to that bot in a private chat. Binding writes credentials but **does not start the bridge**.

```bash
qq-codex-bridge auth-check
qq-codex-bridge start
```

The first unpaired account ignores messages except the matching pairing command. Once paired, only that user's private messages are accepted. Starting the bridge uses the existing Codex session's permissions; it does not disable approvals or weaken its sandbox.

## Features

- Receive text, images, documents, voice, and video attachments.
- Pass images into Codex as image inputs; expose other downloaded files by local path.
- Send local files back through explicit media tags, with message receipts.
- Persist tasks, delivery progress, quote references, approvals, and reminders in SQLite.
- Deduplicate incoming events; recover known running turns without resubmitting them.
- Queue messages while the desktop session is busy, without automatically steering it.
- Cancel a specific task and retry its failed result delivery independently.
- Forward genuine Codex approvals using QQ buttons or scoped command fallbacks.
- Show typing status; optionally enable native C2C streaming.
- Configure compatible STT/TTS providers and bounded video frame extraction.

Audio/video transport is separate from understanding the content. STT/TTS is disabled until explicitly configured. QQ file permissions, voice encoding, native streaming, approval routing, and proactive-message windows require real-account testing. Local automated tests do not prove these platform permissions.

## QQ commands

| Command | Action |
| --- | --- |
| `/help` | Show commands |
| `/status` | Connection, session, latest task, and voice configuration |
| `/cancel [task-id]` | Cancel your queued task or its specific Codex turn |
| `/retry [task-id]` | Retry a failed result delivery; do not rerun the task |
| `/session [thread-id]` | Show or select an existing session |
| `/voice on\|off` | Toggle voice replies when TTS is configured |
| `/remind 5m drink water` | Create a persistent reminder |
| `/remind list` | List pending reminders |
| `/remind cancel ID` | Cancel a reminder |

## Sending artifacts

Ask Codex to return a file. Its final response can contain:

```text
<qqfile>/absolute/path/report.md</qqfile>
<qqimage>/absolute/path/chart.png</qqimage>
<qqvideo>/absolute/path/demo.mp4</qqvideo>
<qqvoice>/absolute/path/reply.mp3</qqvoice>
```

Only explicit tags upload files; a Markdown file link alone does not. Configure `sendRoots` for your workspace. Real paths, hidden files, keys, image signatures, attachment count, and file sizes are checked. The default limit is eight attachments per message and 50 MiB per file, subject to any lower platform limit.

## Development and checks

```bash
npm run build
npm test
npm pack --dry-run
```

The tests use fake QQ delivery, temporary SQLite databases, a local mock speech provider, a local JSON-RPC server, and FFmpeg fixtures. They do not connect to a QQ robot. Runtime configuration, credentials, QR codes, media, databases, deployment snapshots, and logs are excluded from Git and the package.

The generated Codex protocol types were produced with Codex CLI `0.162.1`. The Unix-socket WebSocket adapter is version-sensitive: run `probe` after upgrading Codex. See [architecture](docs/architecture.md), [configuration](docs/configuration.md), and [operations](docs/operations.md).
