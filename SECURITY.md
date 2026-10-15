# Security

Do not publish bot secrets, authentication tokens, pairing codes, private messages, or sensitive attachment URLs in issues or pull requests.

To report a vulnerability, use the repository's **Security → Report a vulnerability** option if enabled. If private reporting is unavailable, open an issue requesting a private contact method without including exploit details or sensitive data. No response-time commitment or supported-version guarantee is currently offered.

Use a dedicated bot identity. The bridge accepts one paired user's private messages and acts with the connected Codex session's existing permissions. Review your session permissions and outgoing `sendRoots` before deployment. See [operations](docs/operations.md) for storage, logging, and recovery details.
