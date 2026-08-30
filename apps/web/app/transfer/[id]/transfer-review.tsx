"use client";

import { isEthereumWallet } from "@dynamic-labs/ethereum";
import {
  DynamicWidget,
  getAuthToken,
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { MONAD_TESTNET } from "@mcp-wallet/shared";
import { useEffect, useMemo, useState } from "react";
import { usePublicConfig } from "../../providers";

interface TransferDetails {
  id: string;
  from_address: string;
  recipient_address: string;
  amount: string;
  symbol: string;
  network: string;
  chain_id: number;
  client_name: string;
  status: string;
  transaction_hash?: string | null;
  expires_at: string;
}

export function TransferReview({ transferId }: { transferId: string }) {
  const { apiUrl } = usePublicConfig();
  const isLoggedIn = useIsLoggedIn();
  const wallets = useUserWallets();
  const { sdkHasLoaded, setShowAuthFlow } = useDynamicContext();
  const [transfer, setTransfer] = useState<TransferDetails>();
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<"signing" | "rejecting">();
  const [error, setError] = useState<string>();
  const [transactionHash, setTransactionHash] = useState<string>();
  const wallet = useMemo(
    () =>
      wallets.find(
        (candidate) =>
          candidate.connector.isEmbeddedWallet && candidate.chain.toUpperCase() === "EVM",
      ),
    [wallets],
  );

  useEffect(() => {
    const storedHash = window.localStorage.getItem(`mcp-wallet-transfer:${transferId}`);
    if (storedHash) setTransactionHash(storedHash);
  }, [transferId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const token = getAuthToken();
    if (!token) return;

    const controller = new AbortController();
    setLoading(true);
    void fetch(`${apiUrl}/api/transfers/${transferId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => undefined)) as
          | (TransferDetails & { error?: string })
          | undefined;
        if (!response.ok || !result) {
          throw new Error(result?.error ?? "Unable to load this transfer request");
        }
        setTransfer(result);
        if (result.transaction_hash) setTransactionHash(result.transaction_hash);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiUrl, isLoggedIn, transferId]);

  async function completeTransfer(hash: string) {
    const token = getAuthToken();
    if (!token || !wallet) throw new Error("Your wallet session has expired");
    const response = await fetch(`${apiUrl}/api/transfers/${transferId}/complete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        wallet_address: wallet.address,
        transaction_hash: hash,
      }),
    });
    const result = (await response.json().catch(() => undefined)) as
      | { error?: string; status?: string; transaction_hash?: string }
      | undefined;
    if (!response.ok || result?.status !== "confirmed") {
      throw new Error(result?.error ?? "Unable to verify the confirmed transaction");
    }
    window.localStorage.removeItem(`mcp-wallet-transfer:${transferId}`);
    setTransfer((current) =>
      current
        ? { ...current, status: "confirmed", transaction_hash: result.transaction_hash ?? hash }
        : current,
    );
  }

  async function claimTransfer() {
    const token = getAuthToken();
    if (!token || !wallet) throw new Error("Your wallet session has expired");
    const response = await fetch(`${apiUrl}/api/transfers/${transferId}/claim`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ wallet_address: wallet.address }),
    });
    const result = (await response.json().catch(() => undefined)) as
      | { error?: string; status?: string }
      | undefined;
    if (!response.ok || result?.status !== "approval_in_progress") {
      throw new Error(
        result?.error === "transfer_not_pending"
          ? "This transfer request has already been used"
          : result?.error ?? "Unable to reserve this transfer request",
      );
    }
    setTransfer((current) =>
      current ? { ...current, status: "approval_in_progress" } : current,
    );
  }

  async function approve() {
    if (!transfer || !wallet) return;
    setWorking("signing");
    setError(undefined);
    try {
      if (wallet.address.toLowerCase() !== transfer.from_address.toLowerCase()) {
        throw new Error("This request belongs to a different embedded wallet");
      }
      if (transactionHash) {
        await completeTransfer(transactionHash);
        return;
      }
      if (!isEthereumWallet(wallet)) throw new Error("An EVM wallet is required");

      await wallet.switchNetwork(MONAD_TESTNET.id);
      await claimTransfer();
      const hash = await wallet.sendBalance({
        amount: transfer.amount,
        toAddress: transfer.recipient_address,
      });
      setTransactionHash(hash);
      window.localStorage.setItem(`mcp-wallet-transfer:${transferId}`, hash);

      const publicClient = await wallet.getPublicClient();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted");
      await completeTransfer(hash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transfer could not be completed");
    } finally {
      setWorking(undefined);
    }
  }

  async function reject() {
    const token = getAuthToken();
    if (!token) return;
    setWorking("rejecting");
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/api/transfers/${transferId}/reject`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = (await response.json().catch(() => undefined)) as
        | { error?: string; status?: string }
        | undefined;
      if (!response.ok || result?.status !== "rejected") {
        throw new Error(result?.error ?? "Unable to reject this request");
      }
      setTransfer((current) => (current ? { ...current, status: "rejected" } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be rejected");
    } finally {
      setWorking(undefined);
    }
  }

  const canRetryVerification =
    transfer?.status === "approval_in_progress" && Boolean(transactionHash);
  const terminal =
    transfer && transfer.status !== "pending_approval" && !canRetryVerification;
  const explorerHash = transfer?.transaction_hash ?? transactionHash;

  return (
    <main className="centered-page">
      <section className="auth-card transfer-card">
        <div className="transfer-card-header">
          <span className="eyebrow">Explicit wallet approval</span>
          {isLoggedIn ? <DynamicWidget variant="dropdown" /> : null}
        </div>
        <h1>Review transfer</h1>

        {!sdkHasLoaded ? (
          <div className="status-row"><span className="pulse" /> Loading secure wallet…</div>
        ) : !isLoggedIn ? (
          <>
            <p>Sign in with the wallet owner’s email to view and approve this request.</p>
            <button className="primary-button wide" onClick={() => setShowAuthFlow(true)}>
              Continue with email
            </button>
          </>
        ) : loading || !transfer ? (
          <div className="status-row"><span className="pulse" /> Loading transfer details…</div>
        ) : (
          <>
            <div className="transfer-amount">
              <span>Amount</span>
              <strong>{transfer.amount} {transfer.symbol}</strong>
            </div>
            <dl className="transfer-details">
              <div><dt>From</dt><dd><code>{transfer.from_address}</code></dd></div>
              <div><dt>To</dt><dd><code>{transfer.recipient_address}</code></dd></div>
              <div><dt>Network</dt><dd>{transfer.network} · Chain {transfer.chain_id}</dd></div>
              <div><dt>Requested by</dt><dd>{transfer.client_name}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-pill ${transfer.status === "confirmed" ? "active" : ""}`}>{transfer.status.replaceAll("_", " ")}</span></dd></div>
            </dl>

            {terminal ? (
              <div className="transfer-result">
                This request is {transfer.status.replaceAll("_", " ")}.
                {explorerHash ? (
                  <a href={`${MONAD_TESTNET.blockExplorerUrl}/tx/${explorerHash}`} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                ) : null}
              </div>
            ) : (
              <>
                <p className="transfer-warning">
                  Confirm the amount and full recipient address. Approval signs and broadcasts an irreversible testnet transaction.
                </p>
                <div className="transfer-actions">
                  <button className="secondary-button" disabled={Boolean(working) || Boolean(transactionHash)} onClick={reject}>
                    {working === "rejecting" ? "Rejecting…" : "Reject"}
                  </button>
                  <button className="primary-button" disabled={Boolean(working)} onClick={approve}>
                    {working === "signing"
                      ? transactionHash ? "Verifying…" : "Awaiting signature…"
                      : transactionHash ? "Retry verification" : `Approve ${transfer.amount} MON`}
                  </button>
                </div>
                <p className="fine-print">This request expires at {new Date(transfer.expires_at).toLocaleString()}.</p>
              </>
            )}
          </>
        )}
        {error ? <p className="inline-error">{error}</p> : null}
      </section>
    </main>
  );
}
