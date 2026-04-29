# Launchpad

> Soft cap, hard cap, deadline. Buyers pledge XLM, claim tokens on success, refund on failure. The contract decides; no admin steps in.

A SEP-41 token sale on Stellar Testnet. Buyers pledge XLM during a fixed window. If the soft cap is met by the deadline, the sale is marked `Successful` and buyers can claim their pro-rata share of the launched token. If the soft cap is missed, buyers self-refund.

[![CI](https://github.com/QuangHaiVip/launchpad/actions/workflows/ci.yml/badge.svg)](https://github.com/QuangHaiVip/launchpad/actions)
![Network](https://img.shields.io/badge/network-Stellar%20Testnet-2563eb)
![SEP-41](https://img.shields.io/badge/SEP--41-LPT-15803d)

## How It Works

The launchpad is a **multi-campaign registry**. Its `__constructor(token)` only wires up the SEP-41 token whose mint admin gets transferred to the launchpad on deploy. Anyone can then open as many fundraising calls as they want by signing `create_campaign(...)`. Each call gets a sequential `u64` id and lives in its own persistent storage row.

```
  creator ─── create_campaign(price, soft, hard, deadline) ──► Launchpad
                                                                  │
                                                              id  │
                                                                  ▼
                                                       Campaign(id) row stored
                                                                  │
   buyers ─── pledge(buyer, id, amount) ──────────────────────────┤
                                                                  │
                                                       after deadline
                                                                  ▼
                                                      ┌─finalize(id)─┐
                                              Successful           Failed
                                                  │                   │
                                          claim(buyer, id)    refund(buyer, id)
                                                  │                   │
                                                  ▼                   ▼
                                   Token.mint(buyer, share)    pledge returned
```

After the deadline, anyone can call `finalize(id)` to lock the outcome of that specific call. In `Successful` state, each buyer calls `claim(buyer, id)` once and the launchpad mints `pledged * price_tokens_per_xlm / 10_000_000` tokens to the buyer via inter-contract call. In `Failed` state, buyers self-refund.

The launchpad is an accounting + minting contract; XLM movement happens via Horizon payments alongside the calls. All campaigns share the same SEP-41 token.

## Deployed Contracts

| Contract | Address |
|---|---|
| Launchpad | [`CA5FQOS2...UQEV`](https://stellar.expert/explorer/testnet/contract/CA5FQOS2CJDVAMDB6MTSKREELLK3ZQZULG3LPFUPX5DE5645O3ZMUQEV) |
| LPT token | [`CAD6I6ZE...WKIZ`](https://stellar.expert/explorer/testnet/contract/CAD6I6ZEECDOFJNKUS5KGDXFXAY3I5PT5GBLEVAM7RKTNZG4NBQQWKIZ) |
| Live demo | _(Vercel URL goes here)_ |
| Demo video | _(1-min walkthrough)_ |

## What You Get

- **Multi-campaign registry.** A single contract instance holds many fundraising calls, indexed by `u64` campaign id.
- **Self-service campaign creation.** Anyone signs `create_campaign(...)` to open a new call; the contract validates caps + deadline and stores the campaign struct.
- **Hard-capped fundraising.** Soft cap, hard cap, and deadline enforced on-chain per campaign. No off-chain trust required.
- **Pro-rata token distribution.** On success, claims compute `pledged * price / 1 XLM` and mint via inter-contract call to the shared SEP-41.
- **Automatic refund path.** On failure, buyers self-refund their pledge. No admin involvement.
- **Live sale tracker.** Real-time progress bar against soft cap per campaign, deadline countdown, status badge driven by contract events.

## Run It

```bash
git clone https://github.com/QuangHaiVip/launchpad.git
cd launchpad
npm install
cp .env.example .env.local
./scripts/deploy.sh alice
npm run dev
```

The deploy script:

1. Builds both wasms (launchpad + LPT token).
2. Deploys the LPT with the deployer as initial admin.
3. Deploys the launchpad with `__constructor(token)` only — no campaigns yet.
4. Transfers the LPT admin role to the launchpad.

Open the dApp, connect a wallet, and use the **Admin desk** panel to open the first campaign. Anyone with a connected wallet can create campaigns; the creator field is set to the signer.

## CI / CD

GitHub Actions handles CI: `cargo test` on the contract crates and typecheck + `next build` on the frontend, on every push and PR. CD splits in two: Vercel auto-deploys the frontend whenever `main` moves (config: `vercel.json`), and contract deploy is run by hand with `scripts/deploy.sh` so the Stellar signing key stays out of CI secrets. Full step-by-step: [`deployment.md`](./deployment.md).

## Stack

- Next.js 15 + React 19 + Tailwind v4
- @stellar/stellar-sdk + @creit.tech/stellar-wallets-kit
- soroban-sdk 22 (Rust); two crates (launchpad + LPT)
- @tanstack/react-query

## Tests

18 cargo tests. 12 in `contract/main` covering campaign creation, sequential id assignment, invalid params rejection, pledge against unknown campaign, hard cap, soft cap, claim, refund, double-claim, and full multi-campaign isolation. 6 in `contract/receipt` covering mint, metadata, and admin transfer.

```bash
cd contract && cargo test
```

## Screenshots

`docs/screenshots/mobile.png`

## Notes

- The launchpad's `__constructor(token)` takes only the LPT address. The deploy script transfers LPT admin to the launchpad post-deploy.
- Campaigns are sealed once created — `create_campaign` validates `hard_cap >= soft_cap > 0`, `price > 0`, and `deadline > now`. Storage is keyed by `Campaign(id)` (persistent) and `Pledged(id, addr)` so campaigns are fully isolated.
- "Price" is expressed as `tokens minted per 1 XLM pledged`. With LPT decimals = 0 and price = 100, 1 XLM gets you 100 LPT.
- Hard cap is enforced strictly per pledge per campaign, so a call can stop accepting pledges before the deadline if its cap is reached.
- Refunds are self-service; there is no claim-on-behalf flow.
- All campaigns share the same SEP-41 token. If you want different tokens per campaign, deploy a fresh launchpad instance with a different LPT.
