# gami-vaults-tracker-bot

Watches deposits and withdrawals on Gami vaults (all chains) and posts them to Telegram.

## Adding a vault

**From Telegram (fastest)**: in the bot's group,

```
/addvault <address> <chain> <type> <name>
/addvault 0xabc… eth 7540 Gami WBTC
/addvault 0xdef… eth midas-redeem asset=0xA0b8…eB48 Gami Midas X (Redeem)
```

The bot reads the contract on-chain and shows a preview (asset, share, decimals).
After **✅ Confirm**, it triggers the *Add vault* GitHub workflow as a direct commit
to `main`: Render redeploys and the vault is tracked ~2-3 min later. The bot
confirms in the same message (or links to the logs if something fails).

Restricted to the user IDs listed in `ADMIN_USER_IDS`; requires `GITHUB_TOKEN`
(see [`.env.example`](.env.example)). `/vaults` lists tracked vaults, `/help` shows help.

**From GitHub**: **Actions** tab → **Add vault** → **Run workflow**.
Fill in the name, address, chain and type. Symbol and decimals are read on-chain,
the config is validated, tests run, then a Pull Request is opened: merging it
redeploys the bot.

> First use: enable *Settings → Actions → General → "Allow GitHub Actions
> to create and approve pull requests"*.

**Locally**:

```bash
npm run add-vault -- --name "Gami WBTC" --address 0x… --chain 1 --type erc7540
```

| Type | For | Tracked events |
|---|---|---|
| `erc7540` | Lagoon, T3tris | Request Deposit / Request Withdraw |
| `erc4626` | Upshift | Deposit / Withdraw |
| `midas-deposit` | Midas DepositVault (`--asset-address` = payment token) | Deposit / Request Deposit |
| `midas-redeem` | Midas RedemptionVault (`--asset-address` = payment token) | Redeem / Request Withdraw |

The vault list lives in [`vaults.json`](vaults.json) (can also be edited by hand).

## Adding a chain

Add an entry to [`chains.js`](chains.js) with one or more public RPCs
(check that they accept `eth_getLogs` over the chosen range), then add it to the
choices of the `.github/workflows/add-vault.yml` workflow and to the aliases in
`lib/vaultBuilder.js`.

## Configuration

See [`.env.example`](.env.example). Only `BOT_TOKEN` and `CHAT_ID` are required:
every chain has default public RPCs, with automatic failover between them.

## Commands

```bash
npm start            # run the bot
npm test             # unit tests (no network)
npm run check-rpcs   # live-test every RPC and replay the latest events (no Telegram)
```
