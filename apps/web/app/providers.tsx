"use client";

import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { MONAD_TESTNET } from "@mcp-wallet/shared";
import { createContext, type ReactNode, useContext } from "react";

export interface PublicConfig {
  apiUrl: string;
  dynamicEnvironmentId?: string;
  monadRpcUrl: string;
}

const PublicConfigContext = createContext<PublicConfig | undefined>(undefined);

export function usePublicConfig() {
  const config = useContext(PublicConfigContext);
  if (!config) throw new Error("Public configuration is unavailable");
  return config;
}

export function Providers({
  children,
  config,
}: {
  children: ReactNode;
  config: PublicConfig;
}) {
  if (!config.dynamicEnvironmentId) {
    return (
      <main className="configuration-page">
        <div className="configuration-card">
          <span className="eyebrow">Configuration required</span>
          <h1>Connect a Dynamic sandbox</h1>
          <p>
            Set <code>DYNAMIC_ENVIRONMENT_ID</code> in your local
            environment, then restart the web service.
          </p>
        </div>
      </main>
    );
  }

  const monadTestnet = {
    blockExplorerUrls: [MONAD_TESTNET.blockExplorerUrl],
    chainId: MONAD_TESTNET.id,
    iconUrls: [],
    name: MONAD_TESTNET.name,
    nativeCurrency: MONAD_TESTNET.nativeCurrency,
    networkId: MONAD_TESTNET.id,
    rpcUrls: [config.monadRpcUrl],
    vanityName: "Monad Testnet",
  };

  return (
    <PublicConfigContext.Provider value={config}>
      <DynamicContextProvider
        theme="auto"
        settings={{
          environmentId: config.dynamicEnvironmentId,
          walletConnectors: [EthereumWalletConnectors],
          overrides: { evmNetworks: [monadTestnet] },
          socialProvidersFilter: () => [],
        }}
      >
        {children}
      </DynamicContextProvider>
    </PublicConfigContext.Provider>
  );
}
