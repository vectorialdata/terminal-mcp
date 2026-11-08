# Vectorial Data Terminal — MCP server for AI agents

[![mcptry](https://mcptry.com/badge/com.vectorialdata/terminal)](https://mcptry.com/servers/com.vectorialdata/terminal)

Let Claude, ChatGPT, Cursor or your own bot trade **Hyperliquid perps** and **Polymarket prediction markets**, and
**earn yield** (HYPE staking, HLP, USDC lending), from wallets **your agent owns**, inside limits our server enforces,
with a kill switch.

- **Hosted MCP server:** `https://terminal.vectorialdata.com/api/mcp` (Streamable HTTP)
- **REST API:** `https://terminal.vectorialdata.com/api/agent/v1` · [OpenAPI](https://terminal.vectorialdata.com/api/agent/v1/openapi.json)
- **Full manual (for machines and people):** [`/api/agent/v1/docs`](https://terminal.vectorialdata.com/api/agent/v1/docs)
- **Overview:** [terminal.vectorialdata.com/agents](https://terminal.vectorialdata.com/agents)
- **Official MCP Registry:** `com.vectorialdata/terminal`

This repository holds **documentation and signing examples**. The server itself is hosted by Vectorial Data; you
don't run anything to use it.

## Connect

**Claude (app, web, phone) or ChatGPT, with sign-in:** add a custom connector with the URL
`https://terminal.vectorialdata.com/api/mcp` and sign in with your Vectorial Data Terminal account (OAuth). It starts in
paper mode; with the `live` permission the app can only *propose* real orders, and you approve each one in the Terminal.

**Cursor:** install it from the plugin in this repository (`.cursor-plugin/` + `.mcp.json`), or add the URL above as a
remote MCP server. Market data works right away; you sign in when a tool needs your account.

**Autonomous agents, with an API key:**

```bash
claude mcp add --transport http vectorialdata https://terminal.vectorialdata.com/api/mcp \
  --header "Authorization: Bearer vd_agt_…"
```

Any MCP client:

```json
{
  "mcpServers": {
    "vectorialdata": {
      "type": "http",
      "url": "https://terminal.vectorialdata.com/api/mcp",
      "headers": { "Authorization": "Bearer vd_agt_…" }
    }
  }
}
```

No key yet? The public tools work without it: `get_docs`, `list_markets`, `get_registration_challenge`,
`register_agent` (returns your key), `list_prediction_markets`, `get_prediction_book`. See
[`examples/01-register-and-paper-trade.ts`](examples/01-register-and-paper-trade.ts).

## What an agent can do

| | Paper (free, nothing to sign) | Live (real funds) |
|---|---|---|
| Hyperliquid perps: market/limit orders, TP/SL, close, cancel | ✓ | ✓ |
| Polymarket prediction markets: buy, sell, collect winnings | — | ✓ |
| Earn: HLP, HYPE staking (buy, stake, delegate, unstake, sell), USDC lending on Base | — | ✓ |
| Move money between perps, predictions and Earn (any direction) | — | ✓ |
| Copy a human strategy | — | ✓ |
| Metrics tear-sheet, decision log, webhooks, SSE stream | ✓ | ✓ |

68 tools, each with described arguments and MCP annotations (read-only / destructive / idempotent).

## The safety model

- **Self-custodial.** Your agent owns its keys: an EVM wallet (its identity), and for live trading a **trading wallet**
  whose OWNER is a P-256 key your bot holds, plus a **trading key** that owner authorizes on Hyperliquid. Every live
  order and every money movement is signed by your keys. The MCP server never sees a private key and cannot move funds
  by itself: live tools return what to sign, and you sign **outside** the MCP boundary.
- **Limits enforced by the server, not the model.** Per-order and account-wide exposure caps (perps + predictions +
  Earn), a daily-loss breaker, asset and venue allowlists. Tightening is instant; loosening waits 24 hours unless your
  wallet signs it.
- **Kill switch.** `kill_switch` pauses everything new at once; exits and moving money home keep working.
- **Fees are the same a person pays** on the Terminal: 0.25% per perps trade (settled automatically), Polymarket's
  builder fee inside the fill, 0.55% to enter HLP, 0.25% to stake HYPE, 20% of the yield on USDC lending. Leaving
  Earn is free. Paper mode is free.

## Signing, in one picture

Live tools answer with steps to sign. Each step names its signer:

- `"signer": "owner"` → decode `payload_b64` (base64 of the exact JSON request to the wallet provider), check every
  line in `verify` against **your own records**, then sign the bytes with your OWNER P-256 key (ECDSA over SHA-256,
  DER, base64).
- `"signer": "trading_key"` → sign `typed_data` (EIP-712) with your trading key.

Then submit the signatures in order. See [`examples/02-sign-operation.ts`](examples/02-sign-operation.ts) for a
complete signer that refuses anything it did not expect.

**Never sign a payload you have not decoded and checked.** A signer that signs blind is the one way a compromised
server, network or prompt could make your agent pay someone else.

## Examples

- [`01-register-and-paper-trade.ts`](examples/01-register-and-paper-trade.ts) — create a wallet, register, place a
  paper order, read positions and metrics.
- [`02-sign-operation.ts`](examples/02-sign-operation.ts) — sign and submit any live Earn / move operation (owner and
  trading-key steps), checking each payload before signing.

```bash
cd examples
npm install
npx tsx 01-register-and-paper-trade.ts
```

Requires Node 20+.

## Jurisdiction

The operator of an agent (the person or entity that controls its keys and funds it) is responsible for being allowed
to trade derivatives and prediction markets where they are. Requests from OFAC-sanctioned jurisdictions are refused.
Polymarket does not allow trading from some countries, including the United States. Earn asks for a one-time
eligibility certification by the operator.

## Security

Found something? Write to the contact in
[terminal.vectorialdata.com/.well-known/security.txt](https://terminal.vectorialdata.com/.well-known/security.txt).
Please don't open public issues for vulnerabilities.

## License

The examples and documentation in this repository are MIT-licensed. The hosted service has its own terms.
