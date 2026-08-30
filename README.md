# MCP Wallet

MCP Wallet is an OAuth-protected Model Context Protocol server backed by a Dynamic embedded wallet on Monad testnet.

It lets a coding agent read a wallet address and prepare native MON transfers. The agent never receives a private key or signing authority: every transfer is reviewed and signed by the wallet owner in the browser.

## Features

- OAuth authorization-code flow with PKCE, dynamic client registration, refresh-token rotation, and revocation.
- MCP Streamable HTTP endpoint with OAuth discovery metadata.
- Email OTP authentication through Dynamic and an automatically created embedded EVM wallet.
- `wallet_get_address` under the `wallet:read` scope.
- `wallet_prepare_transfer` and `wallet_get_transfer_status` under the `wallet:transfer` scope.
- Immutable, short-lived transfer requests with explicit browser approval.
- Independent server verification of the confirmed sender, recipient, and amount.
- PostgreSQL persistence with hashed OAuth tokens and no wallet secrets.

The current transfer implementation supports native testnet MON only. ERC-20 transfers, delegated signing, and server-side signing are intentionally excluded.

---

## For users: run and connect MCP Wallet

### Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running locally.
- A Dynamic sandbox environment.
- A local MCP-compatible coding agent, such as Codex.
- Git, if you are cloning the repository.

The coding agent must run on the same computer as the local services. A remote agent cannot access your machine's `localhost` MCP URL.

### 1. Configure Dynamic

Create a sandbox environment in the [Dynamic dashboard](https://app.dynamic.xyz) and configure it as follows:

1. Enable **Email OTP** authentication.
2. Disable social, phone, passkey, guest, and external-wallet login.
3. Enable EVM embedded wallets and **Create on sign up**.
4. Disable embedded-wallet creation for third-party wallet signups.
5. Add `http://localhost:3000` to the allowed origins.
6. Copy the environment ID.

### 2. Configure the project

From the repository root:

```bash
cp .env.example .env
```

Edit `.env` and provide at least:

```dotenv
DYNAMIC_ENVIRONMENT_ID=your-dynamic-environment-id
TOKEN_PEPPER=replace-this-with-a-long-random-local-value
```

Do not commit `.env`. It is intentionally ignored by Git.

### 3. Start the services

```bash
docker compose up --build
```

The first build may take several minutes. The one-shot `migrate` service must finish before the API, web application, and worker become ready.

Once the services are healthy:

| Service | URL |
|---|---|
| Wallet website | [http://localhost:3000](http://localhost:3000) |
| MCP endpoint | `http://localhost:3001/mcp` |
| API health | [http://localhost:3001/health](http://localhost:3001/health) |
| API readiness | [http://localhost:3001/ready](http://localhost:3001/ready) |

To run in the background instead:

```bash
docker compose up --build -d
docker compose logs -f
```

### 4. Create the wallet

1. Open [http://localhost:3000](http://localhost:3000).
2. Select **Continue with email**.
3. Complete the email OTP flow.
4. Wait for the embedded Monad testnet wallet address to appear.

### 5. Add the MCP server to your coding agent

Add an HTTP/remote MCP server with:

| Setting | Value |
|---|---|
| Name | `mcp-wallet` |
| URL | `http://localhost:3001/mcp` |

The agent should discover OAuth automatically and open the authorization page. Review the requested permissions, sign in with the wallet owner's email, and select **Authorize agent**.

If the connection was created before a new OAuth scope or tool was added, remove and add the MCP server again. OAuth refresh tokens cannot silently gain broader permissions.

### 6. Test address access

Ask the coding agent:

> Use MCP Wallet to get my wallet address.

The returned address should match the address on the wallet website and identify Monad testnet chain ID `10143`.

### 7. Test a transfer

The wallet needs testnet MON before it can send a transfer.

Ask the coding agent:

> Prepare a transfer of 0.01 MON to `0x...`.

The agent calls `wallet_prepare_transfer` and returns a browser approval URL. Open it within 10 minutes, then:

1. Confirm the requesting client, sender, full recipient address, amount, and network.
2. Select **Approve** to sign and broadcast through Dynamic, or **Reject** to cancel.
3. Ask the agent to call `wallet_get_transfer_status` with the request ID.

Preparing a transfer does not move funds. Only explicit approval in the browser signs and broadcasts it.

Approval links are single-use. The first approval attempt reserves the request before the wallet opens. If signing is cancelled after that point, ask the agent to prepare a new transfer instead of reusing the link.

### Stop or restart the project

Stop and remove the service containers while preserving PostgreSQL data:

```bash
docker compose down
```

Stop without removing the containers:

```bash
docker compose stop
```

Start existing containers again:

```bash
docker compose start
```

Delete all local project data, including the PostgreSQL volume:

```bash
docker compose down -v
```

The final command is destructive and cannot recover previously stored wallets, OAuth grants, or transfer records.

### Common problems

| Problem | What to check |
|---|---|
| Docker cannot connect | Start Docker Desktop and wait until its engine is ready. |
| Port `3000`, `3001`, or `5432` is busy | Stop the conflicting process or change the Compose port mapping. |
| Dynamic login does not load | Confirm `DYNAMIC_ENVIRONMENT_ID` and the `http://localhost:3000` allowed origin. |
| A new MCP tool is missing | Remove and re-add the MCP connection, approve its scopes, and start a new agent task. |
| Transfer approval fails | Confirm the wallet is on Monad testnet, has enough testnet MON, and the request has not expired. |
| Services do not become healthy | Run `docker compose logs -f api web migrate postgres`. |

---

## For contributors: develop MCP Wallet

### Toolchain

- Node.js 24
- pnpm 11.24.0 through Corepack
- Docker Desktop with Docker Compose
- PostgreSQL 17, normally provided by Compose

Enable the repository's pnpm version and install dependencies:

```bash
corepack enable
pnpm install
```

### Repository structure

```text
apps/
  api/       OAuth authorization server, MCP server, sessions, and transfer APIs
  web/       Next.js wallet, consent, and transfer-approval UI
  worker/    Background worker process
packages/
  db/        Drizzle schema, PostgreSQL client, and SQL migrations
  shared/    Shared scopes, network constants, and types
compose.yaml Local service orchestration
Dockerfile   Development and production build targets
```

### Local development workflows

The recommended full-stack workflow is:

```bash
docker compose up --build
```

Source directories are mounted into the development containers, and the API and web services watch for changes.

You can run workspace checks directly on the host after `pnpm install`:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Useful commands:

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all workspace development processes without Compose. External PostgreSQL is still required. |
| `pnpm typecheck` | Type-check every workspace. |
| `pnpm test` | Run all automated tests. |
| `pnpm build` | Create production builds for every workspace. |
| `pnpm lint` | Run the repository's current static checks. |
| `pnpm db:generate` | Generate a Drizzle SQL migration from schema changes. |
| `pnpm db:migrate` | Apply pending migrations using `DATABASE_URL`. |

### Environment variables

| Variable | Used by | Secret | Description |
|---|---|---:|---|
| `WEB_URL` | API | No | Exact public origin of the browser application. |
| `API_URL` | API and web | No | Exact public origin of the API and OAuth issuer. |
| `DYNAMIC_ENVIRONMENT_ID` | API and web | No | Dynamic project environment identifier. |
| `MONAD_RPC_URL` | API and web | No | Monad testnet JSON-RPC endpoint. |
| `DATABASE_URL` | API, worker, migration | Yes | PostgreSQL connection string. Compose overrides it for containers. |
| `TOKEN_PEPPER` | API | Yes | Server-side pepper used when hashing OAuth tokens. Use at least 24 characters. |
| `PORT` | API | No | API listen port; defaults to `3001`. |

Never expose `TOKEN_PEPPER` or a production `DATABASE_URL` to browser code. The web application receives only public configuration at runtime.

### Database changes

1. Update `packages/db/src/schema.ts`.
2. Generate a migration:

   ```bash
   pnpm db:generate
   ```

3. Inspect the generated SQL under `packages/db/drizzle/`. Do not apply a migration that unexpectedly recreates existing tables or drops data.
4. Apply it locally:

   ```bash
   pnpm db:migrate
   ```

Compose applies pending migrations automatically through the one-shot `migrate` service.

Commit the schema change, SQL migration, Drizzle snapshot, and journal update together.

### OAuth and MCP development rules

- Add a dedicated OAuth scope when a tool introduces a materially new permission.
- Never allow refresh tokens to expand scopes without a new authorization flow.
- Enforce scopes in the MCP tool handler even when a client normally hides unavailable tools.
- Keep transfer requests bound to the authenticated user, wallet, MCP client, recipient, amount, network, and expiry.
- Treat agent-created transfers as requests only; signing must remain an explicit browser action.
- Verify a confirmed transaction independently before marking a transfer successful.
- Never store Dynamic JWTs, private keys, seed phrases, or key shares.

Future consent UI can let users grant a subset of the scopes requested by an agent. It must never add scopes the client did not request, and broader access must require fresh consent.

### Testing changes

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For changes touching OAuth, Dynamic, MCP tools, or transfers, also complete the relevant manual acceptance checks below.

### Manual acceptance checklist

1. `docker compose up --build` reports healthy `api` and `web` services.
2. Email OTP creates and displays one embedded EVM wallet.
3. Adding the MCP URL opens the correct authorization UI.
4. `wallet_get_address` returns the address displayed on the website.
5. Preparing a transfer returns an approval URL without moving funds.
6. Rejecting or allowing a request to expire leaves the wallet unchanged.
7. Approving a funded request produces the exact reviewed native MON transfer.
8. `wallet_get_transfer_status` reports the confirmed hash and explorer URL.
9. PostgreSQL contains public wallet/transfer data and hashed OAuth tokens, but no wallet secrets or Dynamic JWTs.

The real Dynamic email-OTP and transaction flows require a configured sandbox and cannot be fully exercised with placeholder credentials.

### Commit and pull-request guidance

- Keep commits focused and use an imperative or conventional commit subject.
- Include migrations with the code that depends on them.
- Document new environment variables in both `.env.example` and this README.
- Explain security-sensitive behavior and manual verification in the pull request.
- Do not commit `.env`, logs, dependencies, build output, database dumps, or credentials.

---

## Architecture

| Service | Local address | Responsibility |
|---|---|---|
| `web` | `http://localhost:3000` | Wallet dashboard, Dynamic authentication, OAuth consent, and transfer approval. |
| `api` | `http://localhost:3001` | OAuth authorization server, Dynamic session verification, MCP resource server, and transfer verification. |
| `worker` | Private | Background processing and connection checks. |
| `postgres` | `localhost:5432` | Users, public wallet data, OAuth state, hashed tokens, and transfer requests. |
| `migrate` | One-shot | Applies versioned SQL migrations before application services start. |

Dynamic owns the embedded-wallet custody and key-management layer. The API and worker receive only public wallet information and authenticated session claims.

## Production deployment on Railway

Create one Railway project with PostgreSQL and three services built from this repository:

| Railway service | Docker target | Required configuration |
|---|---|---|
| Web | `web-production` | `API_URL`, `DYNAMIC_ENVIRONMENT_ID`, `MONAD_RPC_URL` |
| API | `api-production` | `API_URL`, `WEB_URL`, `DATABASE_URL`, `DYNAMIC_ENVIRONMENT_ID`, `MONAD_RPC_URL`, `TOKEN_PEPPER`, `PORT` |
| Worker | `worker-production` | `DATABASE_URL` |

Run `pnpm db:migrate` as the API service's pre-deploy command. Give the web and API services public HTTPS domains, set `API_URL` and `WEB_URL` to those exact origins, and add the web origin to Dynamic's allowed origins.

Use the hosted HTTPS MCP URL for remote/cloud coding agents. Do not expose a local PostgreSQL port publicly.

## Security notes

- OAuth access and refresh tokens are stored as hashes.
- Dynamic JWTs are verified and not persisted.
- The API performs a fresh Dynamic profile lookup before accepting a wallet address.
- Transfer requests expire after 10 minutes and require owner authentication.
- The browser signs through Dynamic; the server never receives wallet key material.
- Confirmed transfers are checked against their immutable request before being recorded as successful.
