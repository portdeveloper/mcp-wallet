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
  const [showDisclaimer, setShowDisclaimer] = useState(true);
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

      {showDisclaimer ? (
        <div className="disclaimer-backdrop">
          <section
            className="disclaimer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="disclaimer-title"
            aria-describedby="disclaimer-copy"
          >
            <span className="panel-label">Testnet notice</span>
            <h2 id="disclaimer-title">Use test funds only.</h2>
            <p id="disclaimer-copy">
              Review every transfer before approving. MCP Wallet is
              experimental and not financial advice.
            </p>
            <button
              className="warning-ack-button"
              autoFocus
              onClick={() => setShowDisclaimer(false)}
            >
              I understand
            </button>
          </section>
        </div>
      ) : null}

      <section className={isLoggedIn ? "hero hero-wallet" : "hero hero-solo"}>
        {!isLoggedIn ? (
          <div className="hero-copy">
            <h1>Your agent wallet.</h1>
            <p>You approve every transfer.</p>

            {!sdkHasLoaded ? (
              <div className="status-row"><span className="pulse" /> Loading secure sign-in…</div>
            ) : (
              <button className="primary-button" onClick={() => setShowAuthFlow(true)}>
                Continue with email
              </button>
            )}
          </div>
        ) : null}

        {isLoggedIn ? (
          <div className="wallet-panel" aria-live="polite">
            <div className="panel-header">
              <div>
                <h2>Your wallet</h2>
              </div>
            </div>

            {wallet ? (
              <>
                <div className="address-block">
                  <span>Wallet address</span>
                  <div className="address-row">
                    <code>{wallet.address}</code>
                    <button
                      className="icon-button"
                      aria-label={copied ? "Copied" : "Copy address"}
                      title={copied ? "Copied" : "Copy address"}
                      onClick={copyAddress}
                    >
                      {copied ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="8" y="8" width="11" height="11" rx="2" />
                          <path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="network-row">
                <span className="network-dot" />
                <div>
                  <strong>{MONAD_TESTNET.name}</strong>
                </div>
                </div>
                {syncError ? <p className="inline-error">{syncError}</p> : null}
              </>
            ) : (
              <div className="empty-state">
                <span className="pulse" />
                <p>Creating your embedded EVM wallet…</p>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
