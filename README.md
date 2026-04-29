# Launchpad

> Soft cap, hard cap, deadline. Buyers pledge XLM, claim tokens on success, refund on failure. The contract decides; no admin steps in.

A SEP-41 token sale on Stellar Testnet. Buyers pledge XLM during a fixed window. If the soft cap is met by the deadline, the sale is marked `Successful` and buyers can claim their pro-rata share of the launched token. If the soft cap is missed, buyers self-refund.

[![CI](https://github.com/QuangHaiVip/launchpad/actions/workflows/ci.yml/badge.svg)](https://github.com/QuangHaiVip/launchpad/actions)
![Network](https://img.shields.io/badge/network-Stellar%20Testnet-2563eb)
![SEP-41](https://img.shields.io/badge/SEP--41-LPT-15803d)

## How It Works

The launchpad is constructed with `(creator, token_addr, price_tokens_per_xlm, soft_cap, hard_cap, deadline)`. The token contract (a SEP-41 deployed alongside) hands its admin role to the launchpad so only the launchpad can mint.

```
   Buyers ─── pledge(amount) ───► Launchpad ─── records ─── Pledge(addr) += amount
                                       │
                                       │  after deadline
                                       ▼
                              ┌─────finalize()─────┐
                       Successful                Failed
                       │                              │
                  claim() per buyer            refund() per buyer
                       │                              │
                       ▼                              ▼
            Token.mint(buyer, share)            full pledge returned
```

After the deadline, anyone can call `finalize()` to lock the outcome. In `Successful` state, each buyer calls `claim()` once and the launchpad mints `pledged * price_tokens_per_xlm / 10_000_000` tokens to the buyer via inter-contract call. In `Failed` state, buyers self-refund.

The launchpad is an accounting + minting contract; XLM movement happens via Horizon payments alongside the calls.

## Deployed Contracts

| Contract | Address |
|---|---|
| Launchpad | [`CCYA6OCX...BQ4E`](https://stellar.expert/explorer/testnet/contract/CCYA6OCXY5DMSMBMX3S6GJ23S37TDJYJ4ZIML3F6YSFN2UYB2EZYBQ4E) |
| LPT token | [`CBEDWKGY...AIKN`](https://stellar.expert/explorer/testnet/contract/CBEDWKGYIZUP7BS3AXXXBL3GKNB4SWR3MWZG3D7CN7E7VZQV7NGKAIKN) |
| Live demo | _(Vercel URL goes here)_ |
| Demo video | _(1-min walkthrough)_ |

## What You Get

- **Hard-capped fundraising.** Soft cap, hard cap, and deadline enforced on-chain. No off-chain trust required.
- **Pro-rata token distribution.** On success, claims compute `pledged * price / 1 XLM` and mint via inter-contract call.
- **Automatic refund path.** On failure, buyers self-refund their pledge. No admin involvement.
- **Live sale tracker.** Real-time progress bar against soft cap, deadline countdown, status badge driven by contract events.

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
3. Deploys the launchpad with sample parameters (soft 10 XLM, hard 100 XLM, 1 day deadline, 100 LPT per XLM).
4. Transfers the LPT admin role to the launchpad.

## CI / CD

GitHub Actions handles CI: `cargo test` on the contract crates and typecheck + `next build` on the frontend, on every push and PR. CD splits in two: Vercel auto-deploys the frontend whenever `main` moves (config: `vercel.json`), and contract deploy is run by hand with `scripts/deploy.sh` so the Stellar signing key stays out of CI secrets. Full step-by-step: [`deployment.md`](./deployment.md).

## Stack

- Next.js 15 + React 19 + Tailwind v4
- @stellar/stellar-sdk + @creit.tech/stellar-wallets-kit
- soroban-sdk 22 (Rust); two crates (launchpad + LPT)
- @tanstack/react-query

## Tests

14 cargo tests. 8 in `contract/main` covering pledge, hard cap, soft cap, claim, refund, double-claim, and the state machine. 6 in `contract/receipt` covering mint, metadata, and admin transfer.

```bash
cd contract && cargo test
```

## Screenshots

`docs/screenshots/mobile.png`

## Notes

- The launchpad's `__constructor` takes the LPT address; the deploy script sets up the linkage by calling `set_admin` post-deploy.
- "Price" is expressed as `tokens minted per 1 XLM pledged`. With LPT decimals = 0 and price = 100, 1 XLM gets you 100 LPT. Adjust constants for production sales.
- Hard cap is enforced strictly per pledge, so the sale can stop accepting pledges before the deadline if the cap is reached.
- Refunds are self-service; there is no claim-on-behalf flow.
