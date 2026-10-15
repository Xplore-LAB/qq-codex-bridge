# Configuration

Run `qq-codex-bridge init --thread THREAD_ID` rather than copying local credentials into the repository. Use `QQ_BRIDGE_CONFIG_DIR` for another config directory. Credentials and task data are separate from the package.

Common settings:

| Field | Meaning |
| --- | --- |
| `backend` | `app-server` (default) or the reduced `queue` fallback |
| `threadId` | Existing Codex session, never an implicitly created replacement |
| `socket` | Existing Codex control socket |
| `sendRoots` | Absolute directories eligible for outgoing files |
| `streaming.enabled` | Progress/typing support |
| `streaming.native` | Opt into QQ C2C native streaming; defaults to false pending account testing |
| `limits` | Attachment count, byte limit, pending tasks, and wait timeout |
| `voice.enabled` | Enable explicitly configured speech providers |
| `video` | Bounded frame extraction and maximum input duration |
| `approvals` | Genuine approval forwarding and expiry |

To configure speech, edit the config with your provider's compatible API and model names:

```json
{
  "voice": {
    "enabled": true,
    "stt": {"baseUrl": "https://speech.example.com/v1", "model": "your-stt-model", "keyEnv": "SPEECH_API_KEY"},
    "tts": {"baseUrl": "https://speech.example.com/v1", "model": "your-tts-model", "keyEnv": "SPEECH_API_KEY", "voice": "your-voice"}
  }
}
```

Set the named key in the bridge process's environment. This example is a schema illustration, not a working provider. No speech service or paid account is provisioned automatically.

The adapters use `/audio/transcriptions` and `/audio/speech`. FFmpeg converts common audio inputs and extracts a bounded set of video frames. Raw SILK needs a compatible conversion path or QQ-provided WAV URL. TTS currently speaks at most the first 4,000 characters and preserves text delivery as a fallback.

Normal messages are admitted silently and sent to Codex verbatim. File-transfer instructions are added only to requests that ask for artifacts. Attachment and quote metadata are included only when present. The queue fallback retains its correlation marker outside the shared prompt builder. With native streaming enabled, waiting uses the QQ typing notification. Streaming starts with actual answer text and never replaces an already submitted prefix; QQ rejects prefix rewrites. Commentary is excluded when its phase is available. Long replies send the remaining tail separately without repeating the acknowledged streamed prefix.
