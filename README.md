# gami-vaults-tracker-bot

Surveille les dépôts et retraits sur les vaults Gami (toutes chains) et les poste sur Telegram.

## Ajouter un vault

**Depuis GitHub (recommandé)** : onglet **Actions** → **Add vault** → **Run workflow**.
Renseigner le nom, l'adresse, la chain et le type. Le symbole et les décimales sont lus
on-chain, la config est validée, les tests tournent, puis une Pull Request est ouverte :
la merger redéploie le bot.

> Première utilisation : activer *Settings → Actions → General → "Allow GitHub Actions
> to create and approve pull requests"*.

**En local** :

```bash
npm run add-vault -- --name "Gami WBTC" --address 0x… --chain 1 --type erc7540
```

| Type | Pour | Events suivis |
|---|---|---|
| `erc7540` | Lagoon, T3tris | Request Deposit / Request Withdraw |
| `erc4626` | Upshift | Deposit / Withdraw |
| `midas-deposit` | Midas DepositVault (`--asset-address` = token de paiement) | Deposit / Request Deposit |
| `midas-redeem` | Midas RedemptionVault (`--asset-address` = token de paiement) | Redeem / Request Withdraw |

La liste des vaults vit dans [`vaults.json`](vaults.json) (modifiable à la main aussi).

## Ajouter une chain

Ajouter une entrée dans [`chains.js`](chains.js) avec un ou plusieurs RPC publics
(vérifier qu'ils acceptent `eth_getLogs` sur la plage choisie), puis l'ajouter aux
choix du workflow `.github/workflows/add-vault.yml`.

## Configuration

Voir [`.env.example`](.env.example). Seuls `BOT_TOKEN` et `CHAT_ID` sont obligatoires :
chaque chain a des RPC publics par défaut, avec repli automatique de l'un à l'autre.

## Commandes

```bash
npm start            # lance le bot
npm test             # tests unitaires (sans réseau)
npm run check-rpcs   # teste chaque RPC en live et rejoue les derniers events (sans Telegram)
```
