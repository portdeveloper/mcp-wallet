# Contributing to MCP Wallet

Thanks for helping make MCP Wallet safer and more useful. Contributions are
welcome across the MCP server, wallet UI, worker, database layer,
documentation, and tests.

MCP Wallet handles authorization and user-approved transactions. Keep pull
requests focused, explain security-sensitive behavior, and never commit wallet
secrets or production credentials.

## How work lands

All changes go through a pull request, and every pull request needs an approving
review from a code owner (@therealharpaljadeja or @portdeveloper) before it can
merge. Direct pushes to the default branch are turned off. A merge means the
work was read and accepted, not just that it was opened.

MCP Wallet is being prepared as a MOST pool repo (https://most.devnads.com).
Claim an issue with a comment before writing code and wait for a maintainer to
approve the claim. You may hold one claimed issue at a time across all pool
repos. A claim with no pull request or progress update for 7 days is released.
If you contribute with an AI agent, the agent must read and follow
https://most.devnads.com/agents.md.

## Before you start

1. Read the user and contributor documentation in `README.md`.
2. Search existing issues and claim one with a comment.
3. Wait for a maintainer to approve the claim before writing code.
4. For security vulnerabilities, contact the maintainer privately rather than
   opening a public issue.

Never include private keys, seed phrases, Dynamic JWTs, token peppers,
production database URLs, funded-wallet details, or other credentials in code,
tests, screenshots, or logs.

## Development and testing

The repository's setup, architecture, and manual acceptance checks live in
`README.md`. Before opening a pull request, run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

If a check requires Dynamic credentials or a funded testnet wallet, state what
you tested and what remains for the maintainer to verify.

## Pull requests

- Link the approved issue with `Closes #123`.
- Make one focused change per pull request.
- Explain user-visible behavior and security impact.
- Add or update automated tests for behavior changes.
- Include screenshots for visible UI changes.
- Document new environment variables in `.env.example` and `README.md`.
- Do not commit `.env`, logs, dependencies, build output, database dumps, or
  credentials.

Maintainers may ask for a smaller scope or additional security reasoning before
reviewing an implementation.
