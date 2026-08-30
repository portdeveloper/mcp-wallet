# MCP Wallet

An OAuth-protected MCP server backed by a Dynamic embedded wallet on Monad testnet.

The wallet supports two complete paths:

1. Add the local MCP URL to a compatible coding agent.
2. The agent starts OAuth and opens the wallet website.
3. Sign in using email OTP through Dynamic.
4. Dynamic creates an embedded EVM wallet.
5. Authorize the coding agent to read the wallet address.
6. The agent can call `wallet_get_address`.
7. With the separate transfer permission, the agent can prepare an exact native MON transfer.
8. The wallet owner reviews the immutable request in the browser and explicitly approves or rejects it.
9. Dynamic signs in the browser, and the API verifies the confirmed transaction against the request.

Token transfers, delegated signing, and server-side signing are intentionally excluded. The transfer milestone supports native testnet MON only.

## What is implemented

- OAuth 2.1-style authorization code flow with PKCE, dynamic client registration, refresh-token rotation, and revocation.
- MCP Streamable HTTP endpoint with protected-resource and authorization-server discovery metadata.
- Email-only Dynamic sign-in UI and automatic embedded EVM wallet selection.
- Server-side Dynamic JWT verification plus a fresh Dynamic profile lookup before accepting an embedded wallet address.
- Read-only `wallet_get_address` MCP tool for Monad testnet (chain ID `10143`).
- `wallet_prepare_transfer` and `wallet_get_transfer_status` MCP tools under the separate `wallet:transfer` OAuth scope.
- Short-lived browser approval requests that bind the MCP client, wallet, recipient, and exact amount.
- Browser-only Dynamic signing plus independent API verification of the confirmed sender, recipient, and value.
- PostgreSQL persistence for users, wallets, transfer requests, OAuth clients, authorization requests, codes, and hashed tokens.
- Separate web, API, worker, migration, and database processes locally—the same boundaries intended for Railway.

## Service architecture

Local development uses the same service boundaries as Railway:

| Service | Local URL | Production role |
|---|---|---|
| `web` | http://localhost:3000 | Dashboard and Dynamic authentication UI |
| `api` | http://localhost:3001 | OAuth authorization server and MCP resource server |
| `worker` | Private | Background confirmation/indexing process |
| `postgres` | localhost:5432 | Persistent application and OAuth state |
| `migrate` | One-shot | Applies database migrations before services start |

The API and worker never receive a wallet private key or key share. Dynamic owns the embedded-wallet custody/key-management layer. Transfer requests store only public transaction details and require explicit browser approval; raw keys remain absent from PostgreSQL and Railway variables.

## Dynamic sandbox setup

Create a sandbox environment in the Dynamic dashboard and configure it as follows:

1. Under authentication methods, enable **Email OTP only**.
2. Disable social, phone, passkey, guest, and external-wallet login.
3. Enable EVM embedded wallets and **Create on sign up**.
4. Disable embedded-wallet creation for third-party wallet signups.
5. Add `http://localhost:3000` to the allowed origins.
6. Copy the environment ID.

Then create the local environment file:

```bash
cp .env.example .env
```

Set `DYNAMIC_ENVIRONMENT_ID` to the sandbox environment ID. Replace `TOKEN_PEPPER` with a long random local value. The web service receives its public configuration at request time, so the same container image can be promoted between environments without rebuilding it.

## Start local development

```bash
docker compose up --build
```

The database migration must complete before the API, web, and worker services become ready.

## Connect a local coding agent

Add an HTTP/remote MCP server to the agent with:

- Name: `mcp-wallet`
- URL: `http://localhost:3001/mcp`

When the client first connects, the endpoint returns an OAuth challenge. A compatible MCP client will discover the authorization server, register itself, and open `http://localhost:3000/authorize`. Verify the email OTP, review the `wallet:read` and `wallet:transfer` permissions, wait for the embedded wallet address to appear, and select **Authorize agent**.

The client can then call `wallet_get_address` or prepare a transfer:

1. Call `wallet_prepare_transfer` with a recipient address and native MON amount.
2. Open the returned approval URL before its 10-minute expiry.
3. Sign in as the wallet owner and verify the full recipient, amount, network, and requesting client.
4. Select **Approve** to sign and broadcast through Dynamic, or **Reject** to cancel the request.
5. Call `wallet_get_transfer_status` with the returned request ID to observe `pending_approval`, `confirmed`, `rejected`, or `expired`.

Existing MCP connections authorized before the transfer scope was added must be removed and added again so the owner can grant `wallet:transfer`.

This is a localhost flow, so the coding agent must run on the same computer. A remote/cloud agent cannot reach your machine’s `localhost`; use the hosted HTTPS API URL after deployment.

## Production mapping (Railway)

Create one Railway project with PostgreSQL and three services built from this repository:

| Railway service | Docker target | Required configuration |
|---|---|---|
| Web | `web-production` | `API_URL`, `DYNAMIC_ENVIRONMENT_ID`, `MONAD_RPC_URL` |
| API | `api-production` | `API_URL`, `WEB_URL`, `DATABASE_URL`, `DYNAMIC_ENVIRONMENT_ID`, `TOKEN_PEPPER`, `PORT` |
| Worker | `worker-production` | `DATABASE_URL` |

Run `pnpm db:migrate` as the API service’s pre-deploy command. Give the web and API services public HTTPS domains, set `API_URL` and `WEB_URL` to those exact origins, and add the web origin in Dynamic. No AWS service is required.

The browser-safe configuration is injected by the Next.js server at request time. Do not put secrets into those public values; `TOKEN_PEPPER` remains API-only.

## Acceptance checks

1. `docker compose up --build` reports healthy `api` and `web` services.
2. Opening `http://localhost:3000` and completing email OTP creates and displays one embedded EVM wallet.
3. Adding `http://localhost:3001/mcp` to a compatible local coding agent opens the authorization UI.
4. After approval, calling `wallet_get_address` returns the same address displayed on the website and identifies Monad testnet chain ID `10143`.
5. PostgreSQL contains public wallet/transfer details and hashed OAuth tokens—no Dynamic JWTs, private keys, seed phrases, or key shares.
6. Preparing a transfer returns a browser approval URL and does not move funds.
7. Rejecting or letting the request expire leaves the wallet unchanged.
8. Approving a funded native MON request returns a successful Monad testnet transaction that exactly matches the reviewed recipient and amount.
9. `wallet_get_transfer_status` reports the confirmed hash and explorer URL.

## Run checks without Docker

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

PostgreSQL is still required for API integration tests and runtime.

The repository’s automated checks validate compilation, builds, PKCE helpers, and OAuth/MCP discovery. The final email-OTP test requires your real Dynamic sandbox environment ID and cannot be completed with placeholder credentials.
