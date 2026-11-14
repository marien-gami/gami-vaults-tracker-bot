# gami-vaults-tracker-bot

Surveille les dépôts et retraits sur les vaults Gami (toutes chains) et les poste sur Telegram.

## Ajouter un vault

**Depuis Telegram (le plus rapide)** : dans le groupe du bot,

```
/addvault <adresse> <chain> <type> <nom>
/addvault 0xabc… eth 7540 Gami WBTC
/addvault 0xdef… eth midas-redeem asset=0xA0b8…eB48 Gami Midas X (Redeem)
```

Le bot lit le contrat on-chain et affiche un aperçu (asset, share, décimales).
Après **✅ Confirmer**, il déclenche le workflow GitHub *Add vault* en commit direct
sur `main` : Render redéploie et le vault est suivi ~2-3 min plus tard. Le bot
confirme dans le même message (ou donne le lien des logs en cas d'échec).

Réservé aux user IDs listés dans `ADMIN_USER_IDS` ; nécessite `GITHUB_TOKEN`
(voir [`.env.example`](.env.example)). `/vaults` liste les vaults suivis, `/help` l'aide.

**Depuis GitHub** : onglet **Actions** → **Add vault** → **Run workflow**.
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
