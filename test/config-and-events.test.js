import { test } from "node:test";
import assert from "node:assert/strict";
import { VAULTS, TOPICS, validateVaultEntries, expandVault, loadVaultEntries } from "../vaultsConfig.js";
import { processLog, formatUnits, formatTelegramMessage } from "../alerts/events.js";

const pad = (hex) => hex.replace("0x", "").padStart(64, "0");
const USER = "0x1111111111111111111111111111111111111111";

test("vaults.json is valid", () => {
  assert.deepEqual(validateVaultEntries(loadVaultEntries()), []);
  assert.ok(VAULTS.length > 0);
});

test("validation: detects duplicate, unknown chain, unknown type, missing share", () => {
  const ok = { name: "A", address: "0x" + "a".repeat(40), chainId: 1, type: "erc7540", asset: { symbol: "USDC", decimals: 6 }, share: { symbol: "x", decimals: 18 } };
  assert.deepEqual(validateVaultEntries([ok]), []);
  assert.match(validateVaultEntries([ok, { ...ok, address: ok.address.toUpperCase().replace("0X", "0x") }]).join(), /duplicate/);
  assert.match(validateVaultEntries([{ ...ok, chainId: 12345 }]).join(), /chainId/);
  assert.match(validateVaultEntries([{ ...ok, type: "foo" }]).join(), /type/);
  assert.match(validateVaultEntries([{ ...ok, share: undefined }]).join(), /share/);
  assert.match(validateVaultEntries([{ ...ok, asset: { symbol: "USDC", decimals: 6.5 } }]).join(), /decimals/);
  // midas-deposit doesn't need a share
  assert.deepEqual(validateVaultEntries([{ ...ok, type: "midas-deposit", share: undefined }]), []);
});

test("expandVault: Midas forces decimals to 18 (base18 events)", () => {
  const v = expandVault({ name: "M", address: "0x" + "b".repeat(40), chainId: 1, type: "midas-redeem",
    asset: { symbol: "USDC", decimals: 6 }, share: { address: "0x" + "c".repeat(40), symbol: "mT", decimals: 18 } });
  assert.deepEqual(v.trackedTokens.map((t) => t.tokenDecimals), [18, 18]);
  assert.equal(v.trackedTokens[1].tokenAddress, "0x" + "c".repeat(40));
});

test("formatUnits: exact, no precision loss", () => {
  assert.equal(formatUnits(123456789n, 8), "1.23456789");
  assert.equal(formatUnits(1_000_000n, 6), "1");
  assert.equal(formatUnits(10n ** 30n + 1n, 18), "1000000000000");
  assert.equal(formatUnits(0n, 18), "0");
});

test("processLog: ERC-7540 RedeemRequest → amount in shares (slot 1, token index 1)", () => {
  const vault = VAULTS.find((v) => v.name === "Gami WBTC");
  const log = {
    address: vault.vaultAddress,
    topics: [TOPICS.ERC7540_REDEEM_REQUEST, "0x" + pad(USER), "0x" + pad(USER), "0x" + pad("0x5")],
    data: "0x" + pad(USER) + pad((25n * 10n ** 17n).toString(16)),
    blockNumber: "0x10",
    logIndex: "0x2",
    transactionHash: "0xabc"
  };
  const ev = processLog({ vault, log, chainId: 1, blockTimestamp: "0x65000000" });
  assert.equal(ev.type, "Request Withdraw");
  assert.equal(ev.amount, "2.5");
  assert.equal(ev.symbol, "gamiWBTC");
  assert.equal(ev.from, USER);
  assert.equal(ev.blockNumber, 16);
  assert.match(formatTelegramMessage(ev), /🟠 Request Withdraw<\/b> on <b>Gami WBTC/);
});

test("processLog: Midas DepositRequest → user in topics[2], USDC base18", () => {
  const vault = VAULTS.find((v) => v.name === "Gami Midas turtlePST (Deposit)");
  const log = {
    address: vault.vaultAddress,
    topics: [TOPICS.MIDAS_DEPOSIT_REQUEST, "0x" + pad("0x7"), "0x" + pad(USER), "0x" + pad("0xa0b8")],
    data: "0x" + pad((1500n * 10n ** 18n).toString(16)) + pad("0x0").repeat(4),
    blockNumber: "0x1", logIndex: "0x0", transactionHash: "0xdef"
  };
  const ev = processLog({ vault, log, chainId: 1 });
  assert.equal(ev.type, "Request Deposit");
  assert.equal(ev.amount, "1500");
  assert.equal(ev.symbol, "USDC");
  assert.equal(ev.from, USER);
});

test("processLog: ignores a log from another contract or an untracked topic", () => {
  const vault = VAULTS[0];
  assert.equal(processLog({ vault, log: { address: "0x" + "9".repeat(40), topics: [], data: "0x" }, chainId: 1 }), null);
  assert.equal(processLog({ vault, log: { address: vault.vaultAddress, topics: ["0x" + "0".repeat(64)], data: "0x" }, chainId: 1 }), null);
});
