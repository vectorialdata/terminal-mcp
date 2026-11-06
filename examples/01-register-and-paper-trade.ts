// 01 — Create an agent wallet, register, and trade in PAPER mode (simulated fills at live prices; nothing to sign).
//
//   npx tsx 01-register-and-paper-trade.ts
//
// Already registered? Set VD_API_KEY and it skips registration. Store a new key safely: it is shown ONCE.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { call } from "./client.js";

async function main() {
  let apiKey = process.env.VD_API_KEY;

  if (!apiKey) {
    // 1. Your agent's identity is an EVM wallet you generate and keep. We never see its private key.
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    console.log("New agent wallet:", account.address, "(save its private key somewhere safe; it is not printed here)");

    // 2. Prove you control it: sign the challenge (EIP-191) and register.
    const { nonce, message } = await call<{ nonce: string; message: string }>("POST", "/challenge", { address: account.address });
    const signature = await account.signMessage({ message });
    const reg = await call<{ api_key: string }>("POST", "/register", { address: account.address, nonce, signature, label: "example-bot" });
    apiKey = reg.api_key;
    console.log("Registered. Store your API key now: it is shown only once.");
  }

  // 3. Paper trade: a market buy of ~$20 of BTC (Hyperliquid's minimum is $10). In paper mode the order comes back
  //    with no actions to sign, so it is submitted right away with an empty signature list (what the MCP place_order
  //    tool does for you).
  const size = Math.ceil((20 / (await btcPrice(apiKey))) * 1e5) / 1e5;
  const prep = await call<{ order_id: string; actions: unknown[] }>("POST", "/orders/prepare", { market: "BTC", side: "buy", type: "market", size }, apiKey);
  if (prep.actions.length > 0) throw new Error("This account is in LIVE mode: see 02-sign-operation.ts and the docs (§4).");
  const fill = await call("POST", "/orders/submit", { order_id: prep.order_id, signatures: [] }, apiKey);
  console.log("Paper fill:", fill);

  // 4. Read it back.
  console.log("Positions:", await call("GET", "/positions", undefined, apiKey));
  console.log("Metrics:", await call("GET", "/metrics?window=7d&mode=paper", undefined, apiKey));
}

/** BTC's current price from the public markets list. */
async function btcPrice(apiKey: string): Promise<number> {
  const m = await call<{ markets: Array<{ name: string; price: number | string }> }>("GET", "/markets", undefined, apiKey);
  const btc = m.markets.find((x) => x.name === "BTC");
  if (!btc) throw new Error("BTC not listed");
  return Number(btc.price);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
