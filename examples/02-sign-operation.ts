// 02 — Sign and submit a LIVE Earn / move operation, refusing anything you did not expect.
//
// Every live Earn tool (earn_hlp_deposit, stake_hype, earn_usdc_deposit, move_funds, …) returns:
//   { operation_id, summary, signatures_needed: [ { step, signer: "owner" | "trading_key", … } ], expires_at }
// You sign EVERY step, in order, and POST /operations/submit within 5 minutes.
//
//   · owner steps: `payload_b64` is base64 of the exact JSON request to the wallet provider. Decode it, check it against
//     YOUR OWN records (never against the server's answer), then sign the raw bytes with your OWNER P-256 key.
//   · trading_key steps: sign `typed_data` (EIP-712) with your trading key, as you sign orders.
//
// This file is a reference signer: adapt `MINE` to your agent and keep the checks. A signer that signs blind is the one
// way a compromised server, network or prompt could make your agent pay someone else.
//
//   VD_API_KEY=… OWNER_KEY_PEM=… TRADING_KEY=0x… npx tsx 02-sign-operation.ts
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { call } from "./client.js";

/** What YOU know about your own agent. Fill it from your own storage, never from an API answer. */
type Mine = {
  /** The Privy wallet id you saved when you created the trading wallet (POST /trading/wallet). */
  privyWalletId: string;
  /** Your trading wallet address (lowercase): the same address on Hyperliquid and on Base. */
  tradingWallet: string;
  /** Addresses your money may go to besides your trading wallet — e.g. YOUR deposit wallet's Polymarket deposit
   *  address, which you look up yourself: POST https://bridge.polymarket.com/deposit { "address": "<deposit wallet>" }. */
  ownDestinations: string[];
};

type Step =
  | { step: number; signer: "owner"; description: string; payload_b64: string; verify: string[] }
  | { step: number; signer: "trading_key"; description: string; typed_data: Record<string, unknown> };

// Hyperliquid actions an Earn / move operation may ask your OWNER to sign. Anything else is refused.
const HL_PRIMARY_TYPES = new Set([
  "HyperliquidTransaction:CDeposit",
  "HyperliquidTransaction:CWithdraw",
  "HyperliquidTransaction:TokenDelegate",
  "HyperliquidTransaction:SendAsset",
  "HyperliquidTransaction:UsdClassTransfer",
  "HyperliquidTransaction:SendToEvmWithData",
]);

// Base contracts an operation may call, and how to read the recipient out of each call.
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const EARN_USDC_VAULT = "0x24ef51c6fa5892454482ec2ed2922f928c0560c3";
const CCTP_TOKEN_MESSENGER_V2 = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d";
const ERC20 = parseAbi(["function approve(address spender, uint256 amount)", "function transfer(address to, uint256 amount)"]);
const VAULT = parseAbi(["function deposit(uint256 assets, address onBehalf)", "function withdraw(uint256 assets, address receiver, address owner)"]);
const CCTP = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

function refuse(why: string): never {
  throw new Error(`REFUSED TO SIGN: ${why}`);
}

/** Checks an owner payload against YOUR records. Throws if anything is unexpected. */
export function checkOwnerPayload(bytes: Buffer, mine: Mine): void {
  const req = JSON.parse(bytes.toString("utf8")) as {
    method?: string;
    url?: string;
    body?: { method?: string; caip2?: string; params?: { typed_data?: { primary_type?: string; message?: Record<string, unknown> }; transaction?: { to?: string; data?: string; value?: string } } };
  };
  if (req.method !== "POST") refuse(`method ${req.method}`);
  if (req.url !== `https://api.privy.io/v1/wallets/${mine.privyWalletId}/rpc`) refuse(`url ${req.url} is not YOUR wallet`);
  const own = new Set([mine.tradingWallet, ...mine.ownDestinations].map((a) => a.toLowerCase()));

  if (req.body?.method === "eth_signTypedData_v4") {
    const td = req.body.params?.typed_data;
    if (!td?.primary_type || !HL_PRIMARY_TYPES.has(td.primary_type)) refuse(`typed data ${td?.primary_type}`);
    const m = td.message ?? {};
    if (td.primary_type === "HyperliquidTransaction:SendAsset" && !own.has(String(m.destination).toLowerCase())) refuse(`sendAsset to ${m.destination}`);
    if (td.primary_type === "HyperliquidTransaction:SendToEvmWithData" && String(m.destinationRecipient).toLowerCase() !== mine.tradingWallet.toLowerCase()) {
      refuse(`sendToEvmWithData to ${m.destinationRecipient}`);
    }
    return; // cDeposit / cWithdraw / tokenDelegate / usdClassTransfer stay inside your own account.
  }

  if (req.body?.method === "eth_sendTransaction") {
    if (req.body.caip2 !== "eip155:8453") refuse(`chain ${req.body.caip2} (expected Base)`);
    const tx = req.body.params?.transaction ?? {};
    if ((tx.value ?? "0x0") !== "0x0") refuse("the transaction sends ETH");
    const to = String(tx.to).toLowerCase();
    const data = String(tx.data) as Hex;
    const me = getAddress(mine.tradingWallet);
    if (to === BASE_USDC) {
      const d = decodeFunctionData({ abi: ERC20, data });
      if (d.functionName === "approve") {
        const spender = String(d.args[0]).toLowerCase();
        if (spender !== EARN_USDC_VAULT && spender !== CCTP_TOKEN_MESSENGER_V2) refuse(`approve to ${spender}`);
        return;
      }
      if (!own.has(String(d.args[0]).toLowerCase())) refuse(`USDC transfer to ${d.args[0]}`);
      return;
    }
    if (to === EARN_USDC_VAULT) {
      const d = decodeFunctionData({ abi: VAULT, data });
      const parties = d.functionName === "deposit" ? [d.args[1]] : [d.args[1], d.args[2]];
      if (!parties.every((a) => getAddress(String(a)) === me)) refuse(`vault ${d.functionName} not in your name`);
      return;
    }
    if (to === CCTP_TOKEN_MESSENGER_V2) {
      const d = decodeFunctionData({ abi: CCTP, data });
      // The hook's 20-byte recipient (after Circle's 24-byte marker and 8 bytes of version/length) must be YOU.
      const hook = String(d.args[7]).toLowerCase();
      if (!hook.includes(mine.tradingWallet.toLowerCase().slice(2))) refuse("CCTP burn whose hook is not your trading wallet");
      return;
    }
    refuse(`call to unknown contract ${to}`);
  }
  refuse(`rpc method ${req.body?.method}`);
}

/** Signs every step of a prepared operation, in order. */
export async function signOperation(steps: Step[], mine: Mine, ownerKeyPem: string, tradingKey: Hex): Promise<string[]> {
  const owner = createPrivateKey(ownerKeyPem);
  const trader = privateKeyToAccount(tradingKey);
  const out: string[] = [];
  for (const s of steps.sort((a, b) => a.step - b.step)) {
    if (s.signer === "owner") {
      const bytes = Buffer.from(s.payload_b64, "base64");
      checkOwnerPayload(bytes, mine);
      out.push(sign("sha256", bytes, owner).toString("base64")); // ECDSA P-256 over SHA-256, DER, base64
    } else {
      const td = s.typed_data as Parameters<typeof trader.signTypedData>[0];
      out.push(await trader.signTypedData(td));
    }
  }
  return out;
}

async function main() {
  const apiKey = process.env.VD_API_KEY;
  const ownerKeyPem = process.env.OWNER_KEY_PEM;
  const tradingKey = process.env.TRADING_KEY as Hex | undefined;
  if (!apiKey || !ownerKeyPem || !tradingKey) throw new Error("Set VD_API_KEY, OWNER_KEY_PEM and TRADING_KEY.");

  // Fill this from YOUR storage (what you saved when you created the trading wallet).
  const mine: Mine = {
    privyWalletId: process.env.PRIVY_WALLET_ID ?? "",
    tradingWallet: (process.env.TRADING_WALLET ?? "").toLowerCase(),
    ownDestinations: [],
  };

  // Example: withdraw your whole HLP position back to your trading wallet (an exit: works even while paused).
  const op = await call<{ operation_id: string; summary: unknown; signatures_needed: Step[] }>("POST", "/earn/hlp/withdraw", { all: true }, apiKey);
  console.log("Prepared:", op.summary);
  const signatures = await signOperation(op.signatures_needed, mine, ownerKeyPem, tradingKey);

  // owner_public_key lets the server verify every owner signature BEFORE sending anything (required with Base steps).
  const ownerPublicKey = createPublicKey(createPrivateKey(ownerKeyPem)).export({ type: "spki", format: "pem" }).toString();
  const result = await call("POST", "/operations/submit", { operation_id: op.operation_id, signatures, owner_public_key: ownerPublicKey }, apiKey);
  console.log("Result:", result); // status: done | partial | failed | uncertain (uncertain = check balances before retrying)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
