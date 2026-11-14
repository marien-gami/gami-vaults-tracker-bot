// chains.js — Registry of supported chains.
//
// rpcUrls        : default public RPCs, tried in order (automatic failover).
//                  Each one was tested with eth_getLogs over a logsBlockRange-block range.
//                  RPC_URL_<chainId> in the env (comma-separated list) goes IN FRONT of them.
// logsBlockRange : max eth_getLogs block range. Override: LOGS_BLOCK_RANGE_<chainId>.
//
// To add a chain: add an entry here, then vaults in vaults.json.

export const CHAINS = {
  1: {
    name: "Ethereum",
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://rpc.mevblocker.io"],
    logsBlockRange: 2000
  },
  8453: {
    name: "Base",
    rpcUrls: ["https://base-rpc.publicnode.com"],
    logsBlockRange: 2000
  },
  43114: {
    name: "Avalanche",
    rpcUrls: ["https://avalanche-c-chain-rpc.publicnode.com"],
    logsBlockRange: 2000
  },
  43111: {
    name: "Hemi",
    rpcUrls: ["https://rpc.hemi.network/rpc"],
    logsBlockRange: 2000
  },
  14: {
    name: "Flare",
    rpcUrls: ["https://flare-api.flare.network/ext/C/rpc", "https://rpc.ankr.com/flare"],
    logsBlockRange: 2000
  },
  4663: {
    name: "Robinhood Chain",
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    logsBlockRange: 2000
  }
};
