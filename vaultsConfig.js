// vaultsConfig.js
//
// trackedEventsMap : topic0 (keccak256 de la signature d'event) → config
//
// Format de chaque entrée :
//   "0x<64 hex>": {
//     action          : string   – libellé affiché dans le message Telegram
//     callerTopicIndex: number   – index dans topics[] pour l'adresse "from" (défaut: 1)
//     amountDataSlot  : number   – slot dans les données ABI-encodées pour le montant (défaut: 0)
//     amountTokenIndex: number   – index dans trackedTokens[] pour le symbole/decimals (défaut: 0)
//   }
//
// Pour trouver un topic0 :
//   Foundry  : cast sig-event "EventName(type1,type2,...)"
//   En ligne : https://emn178.github.io/online-tools/keccak_256.html
//   Etherscan: onglet "Events" du contrat

// ── Topics ERC-4626 standard ──────────────────────────────────────────────────
// Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
const TOPIC_ERC4626_DEPOSIT =
  "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7";

// Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
const TOPIC_ERC4626_WITHDRAW =
  "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db";

// ── Topics ERC-7540 standard (uint256 requestId) ─────────────────────────────
// DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets)
// data = [sender (address, slot 0), assets (uint256, slot 1)]
const TOPIC_ERC7540_DEPOSIT_REQUEST =
  "0xbb58420bb8ce44e11b84e214cc0de10ce5e7c24d0355b2815c3d758b514cae72";

// RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares)
// data = [sender (address, slot 0), shares (uint256, slot 1)]
const TOPIC_ERC7540_REDEEM_REQUEST =
  "0x1fdc681a13d8c5da54e301c7ce6542dcde4581e4725043fdab2db12ddc574506";

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
    trackedEventsMap: {
      [TOPIC_ERC4626_DEPOSIT]: {
        action: "Deposit",
        callerTopicIndex: 1, // topics[1] = caller
        amountDataSlot: 0,   // data[0] = assets (WBTC)
        amountTokenIndex: 0  // trackedTokens[0] = WBTC
      },
      [TOPIC_ERC4626_WITHDRAW]: {
        action: "Withdraw",
        callerTopicIndex: 1, // topics[1] = caller
        amountDataSlot: 0,   // data[0] = assets (WBTC)
        amountTokenIndex: 0  // trackedTokens[0] = WBTC
      },
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
    trackedEventsMap: {
      [TOPIC_ERC4626_DEPOSIT]: {
        action: "Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 0,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC4626_WITHDRAW]: {
        action: "Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 0,
        amountTokenIndex: 0  // USDC
      },
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1, // topics[1] = controller
        amountDataSlot: 1,   // data[0] = sender, data[1] = assets (USDC)
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1, // topics[1] = controller
        amountDataSlot: 1,   // data[0] = sender, data[1] = shares
        amountTokenIndex: 1  // gamisdUSDC
      },
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // WBTC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiWBTC
      },
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiUSDC
      },
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
        tokenAddress: "0x59b7942F7D2AFD085691ce65c152e0D38D4Eff22", // GamilvlUSD
        tokenSymbol: "gamilvlUSD",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamilvlUSD
      },
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // hemiBTC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamihemiBTC
      },
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // WETH
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiETH
      },
    }
  },
  {
    name: "Gami Spectra Metavault",
    vaultAddress: "0x776F95321a0285F8BCde149E3264D16DC08da69a",
    chainId: 8453,
    trackedTokens: [
      {
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC natif Base
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x776F95321a0285F8BCde149E3264D16DC08da69a", // gamiSpectraUSDC
        tokenSymbol: "gamiSpectraUSDC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedEventsMap: {
      // Ce vault utilise les topics ERC-7540 standard (uint256 requestId)
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiSpectraUSDC
      },
    }
  },
  {
    name: "Gami Conservative USPC",
    vaultAddress: "0xfab0f56c28e3f874b15922b213e696f37b670916",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xfab0f56c28e3f874b15922b213e696f37b670916", // gamiUSPC
        tokenSymbol: "gamiUSPC",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiUSPC
      },
    }
  },
  {
    name: "Gami MSA Def",
    vaultAddress: "0xb725f2277f3f62ad017a6dc418433b326a9f6334",
    chainId: 8453,
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiMSAUSDCdef
      },
    }
  },
  {
    name: "Gami MSA Dyn",
    vaultAddress: "0xf56bfe07b8d6e6d74258cdb6969a633629b06b08",
    chainId: 8453,
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
    trackedEventsMap: {
      [TOPIC_ERC7540_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_ERC7540_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 1,
        amountDataSlot: 1,
        amountTokenIndex: 1  // gamiMSAUSDCdyn
      },
    }
  },
];
