import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWeiAsMon, parseMonAmount, verifyMonadTransfer } from "./transfer.js";

describe("MON transfer amounts", () => {
  it("converts exact decimal amounts without floating-point arithmetic", () => {
    expect(parseMonAmount("1")).toEqual({
      amount: "1",
      amountWei: "1000000000000000000",
    });
    expect(parseMonAmount("0.000000000000000001")).toEqual({
      amount: "0.000000000000000001",
      amountWei: "1",
    });
    expect(parseMonAmount("12.3400")).toEqual({
      amount: "12.34",
      amountWei: "12340000000000000000",
    });
    expect(formatWeiAsMon("12340000000000000000")).toBe("12.34");
  });

  it.each(["0", "-1", "1e2", "01", "1.0000000000000000001", "MON 1"])(
    "rejects unsafe amount %s",
    (amount) => expect(() => parseMonAmount(amount)).toThrow(),
  );
});

describe("Monad transaction verification", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires the confirmed transaction to match sender, recipient, and value", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              from: "0x1111111111111111111111111111111111111111",
              to: "0x2222222222222222222222222222222222222222",
              value: "0xde0b6b3a7640000",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "0x1" } }),
          { status: 200 },
        ),
      );

    await expect(
      verifyMonadTransfer("https://rpc.example", {
        transactionHash: `0x${"a".repeat(64)}`,
        senderAddress: "0x1111111111111111111111111111111111111111",
        recipientAddress: "0x2222222222222222222222222222222222222222",
        amountWei: "1000000000000000000",
      }),
    ).resolves.toBe("confirmed");
  });
});
