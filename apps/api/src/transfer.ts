const WEI_PER_MON = 10n ** 18n;

export function parseMonAmount(value: string): { amount: string; amountWei: string } {
  const trimmed = value.trim();
  if (trimmed.length > 80) throw new Error("Transfer amount is too large");

  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Amount must be a positive MON value with at most 18 decimals");
  }

  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(18, "0");
  const amountWei = whole * WEI_PER_MON + BigInt(fraction || "0");
  if (amountWei <= 0n) throw new Error("Transfer amount must be greater than zero");

  return { amount: formatWeiAsMon(amountWei.toString()), amountWei: amountWei.toString() };
}

export function formatWeiAsMon(value: string): string {
  const amountWei = BigInt(value);
  const whole = amountWei / WEI_PER_MON;
  const fraction = (amountWei % WEI_PER_MON).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

interface RpcTransaction {
  from: string;
  to: string | null;
  value: string;
}

interface RpcReceipt {
  status: string;
}

async function rpcRequest<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Monad RPC request failed with status ${response.status}`);

  const payload = (await response.json()) as { error?: { message?: string }; result?: T | null };
  if (payload.error) throw new Error(payload.error.message ?? "Monad RPC request failed");
  return payload.result ?? null;
}

export async function verifyMonadTransfer(
  rpcUrl: string,
  input: {
    transactionHash: string;
    senderAddress: string;
    recipientAddress: string;
    amountWei: string;
  },
): Promise<"confirmed" | "pending" | "mismatch"> {
  const [transaction, receipt] = await Promise.all([
    rpcRequest<RpcTransaction>(rpcUrl, "eth_getTransactionByHash", [input.transactionHash]),
    rpcRequest<RpcReceipt>(rpcUrl, "eth_getTransactionReceipt", [input.transactionHash]),
  ]);
  if (!transaction || !receipt) return "pending";
  if (receipt.status !== "0x1") return "mismatch";

  const matches =
    transaction.from.toLowerCase() === input.senderAddress.toLowerCase() &&
    transaction.to?.toLowerCase() === input.recipientAddress.toLowerCase() &&
    BigInt(transaction.value) === BigInt(input.amountWei);
  return matches ? "confirmed" : "mismatch";
}
