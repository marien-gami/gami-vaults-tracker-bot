// chains.js — Registre des chains supportées.
//
// rpcUrls        : RPC publics par défaut, essayés dans l'ordre (repli automatique).
//                  Chacun a été testé sur eth_getLogs avec une plage de logsBlockRange blocs.
//                  RPC_URL_<chainId> dans l'env (liste séparée par des virgules) passe DEVANT.
// logsBlockRange : taille max d'une plage eth_getLogs. Override : LOGS_BLOCK_RANGE_<chainId>.
//
// Pour ajouter une chain : ajouter une entrée ici, puis des vaults dans vaults.json.

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
