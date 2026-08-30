"use client";

import {
  getAuthToken,
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePublicConfig } from "../providers";

export function AuthorizeAgent() {
  const { apiUrl } = usePublicConfig();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request_id");
  const isLoggedIn = useIsLoggedIn();
  const wallets = useUserWallets();
  const { sdkHasLoaded, setShowAuthFlow } = useDynamicContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [authorization, setAuthorization] = useState<{
    client_name: string;
    scopes: string[];
  }>();
  const wallet = useMemo(
    () =>
      wallets.find(
        (candidate) =>
          candidate.connector.isEmbeddedWallet && candidate.chain.toUpperCase() === "EVM",
      ),
    [wallets],
  );

  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    void fetch(`${apiUrl}/oauth/authorize/requests/${requestId}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Authorization request is invalid or expired");
        setAuthorization(
          (await response.json()) as { client_name: string; scopes: string[] },
        );
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setError(cause.message);
        }
      });
    return () => controller.abort();
  }, [apiUrl, requestId]);

  async function authorize() {
    const token = getAuthToken();
    if (!requestId || !token || !wallet?.address) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/oauth/authorize/complete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          request_id: requestId,
          wallet_address: wallet.address,
        }),
      });
      const result = (await response.json()) as { error?: string; redirect_uri?: string };
      if (!response.ok || !result.redirect_uri) {
        throw new Error(result.error ?? "Authorization could not be completed");
      }
      window.location.assign(result.redirect_uri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authorization failed");
      setSubmitting(false);
    }
  }

  if (!requestId) {
    return (
      <main className="centered-page">
        <section className="auth-card">
          <span className="eyebrow">Invalid request</span>
          <h1>This authorization link is incomplete.</h1>
          <a href="/">Return to wallet</a>
        </section>
      </main>
    );
  }

  return (
    <main className="centered-page">
      <section className="auth-card">
        <span className="eyebrow">Coding agent connection</span>
        <h1>Authorize MCP Wallet</h1>
        <p>
          {authorization?.client_name ?? "Your coding agent"} is requesting the
          permissions below. Every transfer still requires your explicit browser approval.
        </p>
        <div className="permission-list">
          {authorization?.scopes.includes("wallet:read") ? (
            <div className="permission-row">
              <span className="permission-icon">✓</span>
              <div><strong>Read wallet address</strong><span>Monad testnet only</span></div>
            </div>
          ) : null}
          {authorization?.scopes.includes("wallet:transfer") ? (
            <div className="permission-row">
              <span className="permission-icon">✓</span>
              <div>
                <strong>Request native MON transfers</strong>
                <span>The agent can prepare requests, but cannot sign or send them</span>
              </div>
            </div>
          ) : null}
        </div>

        {!sdkHasLoaded ? (
          <div className="status-row"><span className="pulse" /> Loading secure sign-in…</div>
        ) : !authorization && !error ? (
          <div className="status-row"><span className="pulse" /> Loading permissions…</div>
        ) : !isLoggedIn ? (
          <button className="primary-button wide" onClick={() => setShowAuthFlow(true)}>
            Continue with email
          </button>
        ) : !wallet ? (
          <div className="status-row"><span className="pulse" /> Creating your wallet…</div>
        ) : (
          <>
            <div className="selected-wallet">
              <span>Wallet</span><code>{wallet.address}</code>
            </div>
            <button className="primary-button wide" disabled={submitting} onClick={authorize}>
              {submitting ? "Authorizing…" : "Authorize agent"}
            </button>
          </>
        )}
        {error ? <p className="inline-error">{error}</p> : null}
        <p className="fine-print">Authorization expires if this page is left open for more than 10 minutes.</p>
      </section>
    </main>
  );
}
