"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useWallet } from "@/app/wallet-context";
import { BalanceCard } from "./balance-card";
import { EventFeed } from "./event-feed";
import {
  useAllCampaigns,
  useCampaign,
  useCreateCampaign,
  usePledge,
  useClaim,
  useRefund,
  useFinalize,
  usePledgedOf,
  useTokenBalance,
  statusLabel,
  type Campaign,
} from "@/hooks/use-send-tx";
import {
  toError,
  UserRejectedError,
  InsufficientBalanceError,
} from "@/lib/errors";

const inputCls =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  const padded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * 10_000_000n + BigInt(padded || "0");
}

function fmtXlm(stroops?: bigint) {
  if (stroops === undefined) return "—";
  return (Number(stroops) / 1e7).toFixed(2);
}

function fmtCountdown(deadline: bigint) {
  const ms = Number(deadline) * 1000 - Date.now();
  if (ms <= 0) return "Closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function shorten(addr: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Dashboard() {
  const { address, connect } = useWallet();
  const { data: campaigns, isLoading } = useAllCampaigns();
  const [selectedId, setSelectedId] = useState<bigint | null>(null);

  // Auto-select the highest id once campaigns load
  useEffect(() => {
    if (selectedId !== null) return;
    if (campaigns && campaigns.length > 0) {
      setSelectedId(campaigns[campaigns.length - 1].id);
    }
  }, [campaigns, selectedId]);

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId],
  );

  return (
    <div className="space-y-10">
      <CreateCampaignPanel
        address={address}
        onConnect={connect}
        connectedFallback={!address}
      />

      {isLoading && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted">
          Loading campaigns…
        </div>
      )}

      {!isLoading && campaigns && campaigns.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-10 text-center font-serif text-lg italic text-muted">
          No campaigns yet. Use the panel above to open the first one.
        </div>
      )}

      {!isLoading && campaigns && campaigns.length > 0 && (
        <CampaignList
          campaigns={campaigns}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {selected && <SelectedCampaign campaign={selected} />}

      <div>
        <div className="mb-3 flex items-baseline justify-between border-b border-fg/30 pb-2">
          <h2 className="font-serif text-xl font-bold tracking-tight">Recent on-chain activity</h2>
          <span className="text-[10px] uppercase tracking-[0.18em] text-subtle">Live</span>
        </div>
        <EventFeed />
      </div>
    </div>
  );
}

function CreateCampaignPanel({
  address,
  onConnect,
  connectedFallback,
}: {
  address: string | null;
  onConnect: () => void;
  connectedFallback: boolean;
}) {
  const [open, setOpen] = useState(false);
  const create = useCreateCampaign(address);

  const [price, setPrice] = useState("100");
  const [softCap, setSoftCap] = useState("50");
  const [hardCap, setHardCap] = useState("200");
  const [days, setDays] = useState("7");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86_400);
    try {
      await create.mutateAsync({
        priceTokensPerXlm: BigInt(Number(price)),
        softCap: xlmToStroops(softCap),
        hardCap: xlmToStroops(hardCap),
        deadline,
      });
      setOpen(false);
    } catch {}
  }

  const err = create.error ? toError(create.error) : null;

  return (
    <section className="rounded-[1rem] border border-fg/30 bg-surface">
      <div className="flex items-center justify-between border-b border-fg/20 px-6 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
            Admin desk
          </div>
          <h2 className="mt-1 font-serif text-2xl font-bold tracking-tight">
            Open a fundraising call
          </h2>
        </div>
        {connectedFallback ? (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm hover:bg-accent/90"
          >
            Connect to create
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-fg/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-fg hover:border-accent hover:text-accent"
          >
            {open ? "Cancel" : "New campaign"}
          </button>
        )}
      </div>
      {open && address && (
        <form onSubmit={onSubmit} className="grid gap-4 px-6 py-6 sm:grid-cols-2">
          <Field label="Tokens per XLM" hint="Mint this many SEP-41 base units per pledged XLM">
            <input
              type="number"
              min="1"
              step="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} font-mono`}
              required
            />
          </Field>
          <Field label="Soft cap (XLM)" hint="Min raise to mark the sale successful">
            <input
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={softCap}
              onChange={(e) => setSoftCap(e.target.value)}
              className={`${inputCls} font-mono`}
              required
            />
          </Field>
          <Field label="Hard cap (XLM)" hint="Pledges stop accepting at this total">
            <input
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={hardCap}
              onChange={(e) => setHardCap(e.target.value)}
              className={`${inputCls} font-mono`}
              required
            />
          </Field>
          <Field label="Window (days)" hint="Sale closes this many days from now">
            <input
              type="number"
              min="1"
              step="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`${inputCls} font-mono`}
              required
            />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between gap-4 pt-2">
            <p className="text-xs text-muted">
              You sign once, the contract assigns an id, and the campaign opens
              for pledges immediately. The campaign creator field is set to
              your connected wallet.
            </p>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-fg px-5 py-2 text-sm font-semibold text-bg shadow-sm hover:bg-fg/90 disabled:opacity-50"
            >
              {create.isPending ? "Opening…" : "Open the call"}
            </button>
          </div>
          {err && (
            <div className="sm:col-span-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              {err instanceof UserRejectedError
                ? "You rejected the request in your wallet."
                : err instanceof InsufficientBalanceError
                  ? "Not enough XLM in your account."
                  : `Failed: ${err.message}`}
            </div>
          )}
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function CampaignList({
  campaigns,
  selectedId,
  onSelect,
}: {
  campaigns: Campaign[];
  selectedId: bigint | null;
  onSelect: (id: bigint) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between border-b border-fg/30 pb-2">
        <h2 className="font-serif text-xl font-bold tracking-tight">
          Open calls
        </h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-subtle">
          {campaigns.length} on chain
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => {
          const pct =
            c.softCap > 0n
              ? Math.min(100, Number((c.totalRaised * 100n) / c.softCap))
              : 0;
          const isActive = c.id === selectedId;
          return (
            <button
              key={c.id.toString()}
              type="button"
              onClick={() => onSelect(c.id)}
              className={`text-left rounded-md border p-4 transition-colors ${
                isActive
                  ? "border-accent bg-elevated"
                  : "border-border bg-surface hover:border-fg/50"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  Call #{c.id.toString()}
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="mt-2 font-serif text-2xl font-bold leading-tight">
                {fmtXlm(c.totalRaised)}{" "}
                <span className="text-sm font-normal text-muted">XLM</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                soft {fmtXlm(c.softCap)} · hard {fmtXlm(c.hardCap)}
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-elevated">
                <div
                  className="h-1.5 rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-subtle">
                <span>by {shorten(c.creator)}</span>
                <span>{fmtCountdown(c.deadline)} left</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: number }) {
  const label = statusLabel(status);
  const cls =
    status === 0
      ? "bg-accent/10 text-accent"
      : status === 1
        ? "bg-success/10 text-success"
        : "bg-danger/10 text-danger";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function SelectedCampaign({ campaign }: { campaign: Campaign }) {
  const { address, connect } = useWallet();
  return (
    <section className="grid gap-5 lg:grid-cols-5">
      <CampaignHero campaign={campaign} className="lg:col-span-3" />
      <div className="lg:col-span-2">
        {address ? (
          <PledgeCard campaign={campaign} />
        ) : (
          <ConnectCta onConnect={connect} />
        )}
      </div>
      {address && (
        <div className="lg:col-span-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <BalanceCard />
          <ClaimRefundPanel campaign={campaign} />
          {campaign.status === 0 && <FinalizePanel campaign={campaign} />}
        </div>
      )}
    </section>
  );
}

function CampaignHero({
  campaign,
  className,
}: {
  campaign: Campaign;
  className?: string;
}) {
  const pct =
    campaign.softCap > 0n
      ? Math.min(100, Number((campaign.totalRaised * 100n) / campaign.softCap))
      : 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-surface p-7 ${className}`}
    >
      <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
          Call #{campaign.id.toString()} · by {shorten(campaign.creator)}
        </div>
        <StatusPill status={campaign.status} />
      </div>

      <h2 className="mt-3 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
        {fmtXlm(campaign.totalRaised)}
        <span className="ml-2 font-sans text-base font-normal text-muted">
          XLM raised
        </span>
      </h2>
      <div className="mt-2 text-xs text-muted">
        {fmtCountdown(campaign.deadline)} left · Soft cap{" "}
        {fmtXlm(campaign.softCap)} · Hard cap {fmtXlm(campaign.hardCap)} · Price{" "}
        {campaign.priceTokensPerXlm.toString()} tok/XLM
      </div>

      <div className="mt-5">
        <div className="h-2 w-full rounded bg-elevated">
          <div
            className="h-2 rounded bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-subtle">{pct}% of soft cap</div>
      </div>
    </div>
  );
}

function PledgeCard({ campaign }: { campaign: Campaign }) {
  const { address } = useWallet();
  const { data: pledged } = usePledgedOf(address, campaign.id);
  const pledge = usePledge(address);
  const [amount, setAmount] = useState("");

  const isOpen = campaign.status === 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await pledge.mutateAsync({
        campaignId: campaign.id,
        xlm: xlmToStroops(amount),
      });
      setAmount("");
    } catch {}
  }
  const err = pledge.error ? toError(pledge.error) : null;

  return (
    <form
      onSubmit={onSubmit}
      className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-elevated p-6"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
        Your pledge
      </div>
      <div className="font-mono text-2xl font-semibold sm:text-3xl">
        {fmtXlm(pledged)}
        <span className="ml-1 text-sm font-normal text-muted">XLM</span>
      </div>

      <div className="mt-2 space-y-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
          Add to pledge
        </label>
        <input
          type="number"
          step="0.0000001"
          min="0.0000001"
          placeholder="Amount in XLM"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          disabled={!isOpen}
          className={`${inputCls} font-mono`}
        />
        <div className="grid grid-cols-3 gap-2">
          {["10", "50", "100"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              disabled={!isOpen}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-50"
            >
              {v} XLM
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={pledge.isPending || !isOpen}
        className="mt-auto w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {!isOpen
          ? "Sale closed"
          : pledge.isPending
            ? "Pledging…"
            : "Pledge XLM"}
      </button>
      {err && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
          {err instanceof UserRejectedError
            ? "You rejected the request in your wallet."
            : err instanceof InsufficientBalanceError
              ? "Not enough XLM in your account."
              : `Failed: ${err.message}`}
        </div>
      )}
    </form>
  );
}

function ClaimRefundPanel({ campaign }: { campaign: Campaign }) {
  const { address } = useWallet();
  const { data: tokenBal } = useTokenBalance(address);
  const claim = useClaim(address);
  const refund = useRefund(address);
  if (campaign.status === 0) return null;

  const isSuccess = campaign.status === 1;
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="font-mono text-xs uppercase tracking-wider text-subtle">
        {isSuccess ? "Claim tokens" : "Refund pledge"}
      </div>
      <p className="mt-2 text-sm text-muted">
        {isSuccess
          ? "Sale hit its soft cap. Claim your pro-rata share of the launched token."
          : "Sale missed its soft cap. Refund your pledged XLM."}
      </p>
      {isSuccess && (
        <div className="mt-2 text-sm">
          Token balance:{" "}
          <span className="font-mono">{tokenBal?.toString() ?? "—"}</span>
        </div>
      )}
      <button
        onClick={() =>
          isSuccess ? claim.mutate(campaign.id) : refund.mutate(campaign.id)
        }
        disabled={claim.isPending || refund.isPending}
        className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {claim.isPending || refund.isPending
          ? "Working…"
          : isSuccess
            ? "Claim tokens"
            : "Refund my pledge"}
      </button>
    </div>
  );
}

function FinalizePanel({ campaign }: { campaign: Campaign }) {
  const { address } = useWallet();
  const finalize = useFinalize(address);
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="font-mono text-xs uppercase tracking-wider text-subtle">
        Finalize (after deadline)
      </div>
      <p className="mt-2 text-sm text-muted">
        Once the deadline passes, anyone can call finalize to lock in the
        sale&apos;s outcome based on whether the soft cap was met.
      </p>
      <button
        onClick={() => finalize.mutate(campaign.id)}
        disabled={finalize.isPending}
        className="mt-3 w-full rounded-md border border-fg/40 bg-elevated px-3 py-2 text-sm font-semibold text-fg transition-colors hover:border-accent disabled:opacity-50"
      >
        {finalize.isPending ? "Finalizing…" : "Finalize sale"}
      </button>
    </div>
  );
}

function ConnectCta({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-elevated p-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
          Connect
        </div>
        <h2 className="mt-2 font-serif text-xl font-bold">
          Connect a wallet to pledge
        </h2>
        <p className="mt-2 text-sm text-muted">
          Pledge XLM during the open window. If the soft cap is met, claim
          tokens pro-rata. If not, refund.
        </p>
      </div>
      <button
        onClick={onConnect}
        className="mt-6 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
      >
        Connect wallet
      </button>
    </div>
  );
}
