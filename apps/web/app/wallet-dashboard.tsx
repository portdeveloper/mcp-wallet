"use client";

import {
  DynamicWidget,
  getAuthToken,
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { MONAD_TESTNET } from "@mcp-wallet/shared";
import { useEffect, useMemo, useState } from "react";
import { usePublicConfig } from "./providers";

export function WalletDashboard() {
  const { apiUrl } = usePublicConfig();
  const isLoggedIn = useIsLoggedIn();
  const wallets = useUserWallets();
  const { sdkHasLoaded, setShowAuthFlow } = useDynamicContext();
  const [copied, setCopied] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const wallet = useMemo(
    () =>
      wallets.find(
        (candidate) =>
          candidate.connector.isEmbeddedWallet && candidate.chain.toUpperCase() === "EVM",
      ),
    [wallets],
  );

  useEffect(() => {
    if (!isLoggedIn || !wallet?.address) return;
    const token = getAuthToken();
    if (!token) return;

    const controller = new AbortController();
    void fetch(`${apiUrl}/api/session`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ wallet_address: wallet.address }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const data = (await response.json().catch(() => undefined)) as
          | { error?: string }
          | undefined;
        setSyncError(data?.error ?? "Unable to sync the wallet session");
      } else {
        setSyncError(undefined);
      }
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name !== "AbortError") {
        setSyncError("The local API is unavailable");
      }
    });

    return () => controller.abort();
  }, [isLoggedIn, wallet?.address]);

  async function copyAddress() {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="MCP Wallet home">
          <span className="brand-mark">M</span>
          <span>MCP Wallet</span>
        </a>
        {isLoggedIn ? <DynamicWidget variant="dropdown" /> : null}
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Developer wallet · Monad testnet</span>
          <h1>Your agent gets access. You keep control.</h1>
          <p>
            Connect once with email and get a dedicated embedded wallet for your
            coding agent. No seed phrase and no wallet extension required.
          </p>

          {!sdkHasLoaded ? (
            <div className="status-row"><span className="pulse" /> Loading secure sign-in…</div>
          ) : !isLoggedIn ? (
            <button className="primary-button" onClick={() => setShowAuthFlow(true)}>
              Continue with email
            </button>
          ) : null}
        </div>

        <div className="wallet-panel" aria-live="polite">
          <div className="panel-header">
            <div>
              <span className="panel-label">Embedded wallet</span>
              <h2>{isLoggedIn ? "Your wallet" : "Not connected"}</h2>
            </div>
            <span className={isLoggedIn ? "status-pill active" : "status-pill"}>
              {isLoggedIn ? "Active" : "Waiting"}
            </span>
          </div>

          {isLoggedIn && wallet ? (
            <>
              <div className="address-block">
                <span>Wallet address</span>
                <code>{wallet.address}</code>
                <button className="secondary-button" onClick={copyAddress}>
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>
              <div className="network-row">
                <span className="network-dot" />
                <div>
                  <strong>{MONAD_TESTNET.name}</strong>
                  <span>Chain ID {MONAD_TESTNET.id}</span>
                </div>
              </div>
              {syncError ? <p className="inline-error">{syncError}</p> : null}
            </>
          ) : isLoggedIn ? (
            <div className="empty-state">
              <span className="pulse" />
              <p>Creating your embedded EVM wallet…</p>
            </div>
          ) : (
            <div className="empty-state">
              <div className="address-placeholder" />
              <p>Your address will appear here after email verification.</p>
            </div>
          )}
        </div>
      </section>

      <section className="steps" aria-label="How it works">
        <article><span>01</span><h3>Add the MCP</h3><p>Use the local MCP URL in your coding agent.</p></article>
        <article><span>02</span><h3>Verify your email</h3><p>The agent opens this secure browser flow.</p></article>
        <article><span>03</span><h3>Get your address</h3><p>Dynamic creates the embedded EVM wallet.</p></article>
      </section>
    </main>
  );
}
