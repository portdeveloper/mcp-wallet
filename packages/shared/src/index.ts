export const MCP_SCOPES = ["wallet:read", "wallet:transfer"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MONAD_TESTNET = {
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Monad",
    symbol: "MON",
  },
  blockExplorerUrl: "https://testnet.monadscan.com",
  defaultRpcUrl: "https://testnet-rpc.monad.xyz",
} as const;

export interface WalletSummary {
  address: string;
  chain: "EVM";
  network: typeof MONAD_TESTNET.name;
}
