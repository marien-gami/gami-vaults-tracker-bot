// vaultsConfig.js - Version améliorée avec types d'actions explicites
export const VAULTS = [
  {
    name: "Alpine BTC Flagship",
    vaultAddress: "0x6625ba54dc861e9f5c678983dba5ba96d19a9224",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
        tokenSymbol: "WBTC",
        tokenDecimals: 8,
        minAmount: 0
      },
      {
        tokenAddress: "0x6625ba54dc861e9f5c678983dba5ba96d19a9224", // AlpineBTC
        tokenSymbol: "AlpineBTC",
        tokenDecimals: 8,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x6e553f65": "Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0xf3cbf47c": "Withdraw",
      "0x77a84317": "Withdraw"
    }
  },
  {
    name: "Alpine USDC Flagship",
    vaultAddress: "0xd066649bcb7d8d3335fe29cad0aed6e17d5828b5",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xd066649bcb7d8d3335fe29cad0aed6e17d5828b5", // AlpineUSDC
        tokenSymbol: "AlpineUSDC",
        tokenDecimals: 6,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x6e553f65": "Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0xf3cbf47c": "Withdraw",
      "0x77a84317": "Withdraw"
    }
  },
  {
    name: "Gami Stake DAO USDC",
    vaultAddress: "0x33e1339567c183fbadcb43f72d11c47229d468ab",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x33e1339567c183fbadcb43f72d11c47229d468ab", // GamisdUSDC
        tokenSymbol: "gamisdUSDC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0xa5948c89": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Gami WBTC",
    vaultAddress: "0x414070fb9e64fd69160d75da57e75ba11f9f605a",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
        tokenSymbol: "WBTC",
        tokenDecimals: 8,
        minAmount: 0
      },
      {
        tokenAddress: "0x414070fb9e64fd69160d75da57e75ba11f9f605a", // GamiWBTC
        tokenSymbol: "gamiWBTC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw"
    }
  },
  {
    name: "Gami USDC",
    vaultAddress: "0xdae854d0896ad2fee335689a3f7b4a95fd1a3e46",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xdae854d0896ad2fee335689a3f7b4a95fd1a3e46", // GamiUSDC
        tokenSymbol: "gamiUSDC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw"
    }
  },
  {
    name: "Gami lvlUSD",
    vaultAddress: "0x59b7942F7D2AFD085691ce65c152e0D38D4Eff22",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x59b7942F7D2AFD085691ce65c152e0D38D4Eff22", // GamilvlUSDC
        tokenSymbol: "gamilvlUSD",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Gami hemiBTC",
    vaultAddress: "0x2a676c2744421b4fae65ce86b47adacb620047d4",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0x06ea695B91700071B161A434fED42D1DcbAD9f00", // hemiBTC
        tokenSymbol: "hemiBTC",
        tokenDecimals: 8,
        minAmount: 0
      },
      {
        tokenAddress: "0x2A676c2744421b4fAe65ce86b47adaCb620047d4", // GamihemiBTC
        tokenSymbol: "gamihemiBTC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Gami ETH",
    vaultAddress: "0x2031eceec018549a2c729cacd6c0bfc4be2524ed",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
        tokenSymbol: "WETH",
        tokenDecimals: 18,
        minAmount: 0
      },
      {
        tokenAddress: "0x2031ECeec018549a2C729caCd6c0BFc4be2524ed", // GamiETH
        tokenSymbol: "gamiETH",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Gami MSA Def",
    vaultAddress: "0xb725f2277f3f62ad017a6dc418433b326a9f6334",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xb725f2277f3f62ad017a6dc418433b326a9f6334", // GamiMSAdef
        tokenSymbol: "gamiMSAUSDCdef",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Gami MSA Dyn",
    vaultAddress: "0xf56bfe07b8d6e6d74258cdb6969a633629b06b08",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xf56bfe07b8d6e6d74258cdb6969a633629b06b08", // GamiMSAdyn
        tokenSymbol: "gamiMSAUSDCdyn",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x85b77f45": "Request Deposit",
      "0x7d41c86e": "Request Withdraw",
      "0x5cfe2fe4": "Request Withdraw"
    }
  },
  {
    name: "Silo Gami USDC",
    vaultAddress: "0x1F0570a081FeE0e4dF6eAC470f9d2D53CDEDa1c5",
    chainId: 43114,
    trackedTokens: [
      {
        tokenAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x1F0570a081FeE0e4dF6eAC470f9d2D53CDEDa1c5", // GamiUSDC
        tokenSymbol: "gamisiloUSDC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x6e553f65": "Deposit",
      "0xba087652": "Withdraw"
    }
  },
  {
    name: "Silo Gami WAVAX",
    vaultAddress: "0x0F78Ea587D8E2950319e0b467c665bD2CB73051B",
    chainId: 43114,
    trackedTokens: [
      {
        tokenAddress: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
        tokenSymbol: "WAVAX",
        tokenDecimals: 18,
        minAmount: 0
      },
      {
        tokenAddress: "0x0F78Ea587D8E2950319e0b467c665bD2CB73051B", // GamiWAVAX
        tokenSymbol: "gamisiloWAVAX",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedMethodsMap: {
      "0x6e553f65": "Deposit",
      "0xba087652": "Withdraw"
    }
  },
];
