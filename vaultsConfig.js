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

// ── Topics Midas (DepositVault / RedemptionVault) ────────────────────────────
// ⚠️ Midas normalise TOUS les montants des events à 18 décimales (base18),
// quelle que soit la décimale du token sous-jacent (USDC 6 → émis en 18).
// → dans trackedTokens, USDC doit être déclaré avec tokenDecimals: 18.

// DepositInstant(address indexed user, address indexed tokenIn, uint256 amountUsd,
//   uint256 amountToken, uint256 fee, uint256 minted, bytes32 referrerId)
// topics[1]=user, topics[2]=tokenIn | data = [amountUsd(0), amountToken(1), fee(2), minted(3), referrerId(4)]
const TOPIC_MIDAS_DEPOSIT_INSTANT =
  "0xdd6865ec496cf9bdd5cb1661ab84cf4e86edc877208a54cbf642f69d744530c5";

// DepositRequest(uint256 indexed requestId, address indexed user, address indexed tokenIn,
//   uint256 amountToken, uint256 amountUsd, uint256 fee, uint256 tokenOutRate, bytes32 referrerId)
// topics[1]=requestId, topics[2]=user, topics[3]=tokenIn | data = [amountToken(0), amountUsd(1), fee(2), tokenOutRate(3), referrerId(4)]
const TOPIC_MIDAS_DEPOSIT_REQUEST =
  "0x3704c9b13a68ac43d7f8a85f2700f0b4f89a11ed9e2bcac5324f0d228d409009";

// RedeemInstant(address indexed user, address indexed tokenOut, uint256 amount,
//   uint256 feeAmount, uint256 amountTokenOut)
// topics[1]=user, topics[2]=tokenOut | data = [amount(0)=mToken, feeAmount(1), amountTokenOut(2)]
const TOPIC_MIDAS_REDEEM_INSTANT =
  "0x1af12536d161c2c30ad907b0abe442f94c4a7824f2463585b3fc893275247cce";

// RedeemRequest(uint256 indexed requestId, address indexed user, address indexed tokenOut,
//   uint256 amountMTokenIn, uint256 feeAmount)
// topics[1]=requestId, topics[2]=user, topics[3]=tokenOut | data = [amountMTokenIn(0), feeAmount(1)]
const TOPIC_MIDAS_REDEEM_REQUEST =
  "0x55ba94d231fa70a45e82b0a1c6a60ef72e41bb2455385128ee5cf8d98c0c1c0e";

export const VAULTS = [

// Upshift Vaults
  
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
  
// Gami Lagoon Vaults
  
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
        tokenAddress: "0xfab0f56c28e3f874b15922b213e696f37b670916", // gamicUSPC
        tokenSymbol: "gamicUSPC",
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
    name: "Gami Leveraged USPC",
    vaultAddress: "0x09252d2c4afca9b1479efdd39faa53de9ff23114",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x09252d2c4afca9b1479efdd39faa53de9ff23114", // gamilUSPC
        tokenSymbol: "gamilUSPC",
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
    name: "Gami Avalanche USDC",
    vaultAddress: "0xb3a2bcb30c1460d88db18b42a29fae2399952874",
    chainId: 43114,
    trackedTokens: [
      {
        tokenAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0xB3A2BCB30c1460d88db18B42a29fae2399952874", // gamiaUSDC
        tokenSymbol: "gamiaUSDC",
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
    name: "Gami Hemi USDC",
    vaultAddress: "0x1e32c96757c07775ca4fc796c4f4311722eaf35e",
    chainId: 43111,
    trackedTokens: [
      {
        tokenAddress: "0xad11a8beb98bbf61dbb1aa0f6d6f2ecd87b35afa", // USDC
        tokenSymbol: "USDC.e",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x1e32c96757c07775ca4fc796c4f4311722eaf35e", // gamihemiUSDC
        tokenSymbol: "gamihemiUSDC",
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
    name: "Gami xBTCY",
    vaultAddress: "0x57e6824a8b15b709cefb4ccef644ba1349057e77",
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
        tokenSymbol: "cbBTC",
        tokenDecimals: 8,
        minAmount: 0
      },
      {
        tokenAddress: "0x57e6824a8b15b709cefb4ccef644ba1349057e77", // xBTCY
        tokenSymbol: "xBTCY",
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
  
// Gami Spectra MetaVaults
  
  {
    name: "Gami Spectra USDC Metavault",
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
        tokenDecimals: 6,
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
    name: "Gami Spectra XRP Metavault",
    vaultAddress: "0x6420a613e936602ca3f1ad5680b3f4d47d473bf1",
    chainId: 14,
    trackedTokens: [
      {
        tokenAddress: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE", // FXRP
        tokenSymbol: "FXRP",
        tokenDecimals: 6,
        minAmount: 0
      },
      {
        tokenAddress: "0x6420A613e936602Ca3f1AD5680b3F4d47D473bf1", // gamiSpectraXRP
        tokenSymbol: "gamiSpectraXRP",
        tokenDecimals: 6,
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
  
// MSA Lagoon Vaults

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

// Midas Vaults — Turtle Huma PST (turtlePST)
//
// Le token turtlePST (0xc462f87f78abdd27b1e41c9ede862275d2c7f36b) n'émet que
// des events ERC20 : dépôts/rachats passent par deux contrats séparés.
// ⚠️ Montants des events normalisés en base18 par Midas → USDC déclaré en 18 dec.

  {
    name: "Gami Midas turtlePST (Deposit)",
    vaultAddress: "0x95ef0179867545bea9dbdab27955551c0802307e", // Midas DepositVault
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 18, // ⚠️ event Midas normalisé base18 (USDC réel = 6 dec)
        minAmount: 0
      },
    ],
    trackedEventsMap: {
      [TOPIC_MIDAS_DEPOSIT_INSTANT]: {
        action: "Deposit",
        callerTopicIndex: 1, // topics[1] = user
        amountDataSlot: 1,   // data[1] = amountToken (USDC, base18)
        amountTokenIndex: 0  // USDC
      },
      [TOPIC_MIDAS_DEPOSIT_REQUEST]: {
        action: "Request Deposit",
        callerTopicIndex: 2, // topics[2] = user (topics[1] = requestId)
        amountDataSlot: 0,   // data[0] = amountToken (USDC, base18)
        amountTokenIndex: 0  // USDC
      },
    }
  },
  {
    name: "Gami Midas turtlePST (Redeem)",
    vaultAddress: "0xab09be3d1e02dfe1f0dbda460ff362bf1a5792fb", // Midas RedemptionVault
    chainId: 1,
    trackedTokens: [
      {
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        tokenSymbol: "USDC",
        tokenDecimals: 18, // ⚠️ event Midas normalisé base18
        minAmount: 0
      },
      {
        tokenAddress: "0xc462f87f78abdd27b1e41c9ede862275d2c7f36b", // turtlePST
        tokenSymbol: "turtlePST",
        tokenDecimals: 18,
        minAmount: 0
      },
    ],
    trackedEventsMap: {
      [TOPIC_MIDAS_REDEEM_INSTANT]: {
        action: "Redeem",
        callerTopicIndex: 1, // topics[1] = user
        amountDataSlot: 0,   // data[0] = amount (turtlePST racheté, base18)
        amountTokenIndex: 1  // turtlePST
      },
      [TOPIC_MIDAS_REDEEM_REQUEST]: {
        action: "Request Withdraw",
        callerTopicIndex: 2, // topics[2] = user (topics[1] = requestId)
        amountDataSlot: 0,   // data[0] = amountMTokenIn (turtlePST, base18)
        amountTokenIndex: 1  // turtlePST
      },
    }
  },
];
