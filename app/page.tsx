import { WalletButton } from "@/components/wallet-button";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-5 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between gap-4 border-b border-fg/30 py-4 text-[11px] uppercase tracking-[0.25em] text-muted">
          <span className="font-mono">Vol. 08 / Token Sale</span>
          <span className="hidden sm:inline">Stellar Testnet · Pro-rata · No admin</span>
          <WalletButton />
        </div>

        <header className="grid grid-cols-12 gap-6 pb-12 pt-10 sm:pt-16">
          <div className="col-span-12 lg:col-span-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
              The Launchpad Edition
            </p>
            <h1 className="mt-4 font-serif text-5xl font-bold leading-[0.95] tracking-tight text-fg sm:text-6xl lg:text-7xl">
              Soft cap, hard cap, deadline.
            </h1>
            <p className="mt-6 max-w-prose font-serif text-xl italic leading-snug text-muted sm:text-2xl">
              Buyers pledge XLM, claim tokens on success, refund on failure. The contract decides; no admin steps in.
            </p>
          </div>
          <aside className="col-span-12 border-l border-fg/20 pl-6 lg:col-span-4 lg:pt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-subtle">
              The mechanic
            </p>
            <p className="dropcap mt-3 font-serif text-base leading-relaxed text-fg">
              A campaign opens with four numbers carved into the contract: soft cap, hard cap, deadline, and a price in tokens-per-XLM. Pledges accumulate until the deadline. If the soft cap is met, claimants receive their pro-rata share via inter-contract mint. If it isn't, every pledger self-refunds. There is no admin path between those two outcomes.
            </p>
          </aside>
        </header>

        <hr className="border-t border-fg/30" />

        <section className="py-10 sm:py-14">
          <Dashboard />
        </section>

        <footer className="border-t border-fg/30 py-8 text-center font-serif text-sm italic text-muted">
          Set in Fraunces and Inter · Hosted on Stellar Testnet · Trustless to the last byte
        </footer>
      </div>
    </main>
  );
}
