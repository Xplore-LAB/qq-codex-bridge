# Contributing / 参与改进

Thanks for helping improve QQ–Codex Bridge. 中文或英文 Issue 和 PR 均可。

## Report a problem

Search existing issues first. Include your operating system, Node.js version, Codex version, bridge commit, steps to reproduce, and expected versus actual behavior. Use the issue templates to make reports easier to act on.

Remove tokens, bot secrets, pairing codes, private message content, signed attachment URLs, and personal identifiers from logs. For a security concern, follow [SECURITY.md](SECURITY.md).

## Develop locally

Use Node.js 24 and install FFmpeg for media integration tests:

```bash
npm ci
npm test
npm pack --dry-run
```

The tests do not need live QQ credentials. Do not connect a development process to a production bot. See [architecture](docs/architecture.md) for module boundaries and [operations](docs/operations.md) for task recovery behavior.

Keep changes focused. Explain the problem, resulting behavior, and validation in your PR. Add meaningful regression coverage for behavior changes. Update both README languages when changing setup or user-facing capabilities. Generated protocol types should only change with a documented compatibility check.

Do not commit runtime configuration, credentials, databases, QR images, media, or logs. A passing local suite does not prove QQ account permissions or compatibility with a different Codex protocol version.

## Licensing

Original code is currently all rights reserved; see [LICENSE](LICENSE). No general open-source license or contributor license agreement is implied by this guide. Licensing questions should be resolved with the maintainer before substantial contributions.
