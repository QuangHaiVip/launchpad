"use client";

import { useState, type FormEvent } from "react";
import { useWallet } from "@/app/wallet-context";
import { BalanceCard } from "./balance-card";
import { EventFeed } from "./event-feed";
import {
  usePledge,
  useClaim,
  useRefund,
  useFinalize,
  useSaleState,
  usePledgedOf,
  useTokenBalance,
} from "@/hooks/use-send-tx";
import {
  toError,
  UserRejectedError,
  InsufficientBalanceError,
} from "@/lib/errors";

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  const padded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * 10_000_000n + BigInt(padded || "0");
}

function fmtXlm(stroops?: bigint) {
  if (stroops === undefined) return "—";
  return (Number(stroops) / 1e7).toFixed(2);
}

const STATUS_LABEL = ["Active", "Successful", "Failed"];

function fmtCountdown(deadline: bigint) {
  const ms = Number(deadline) * 1000 - Date.now();
  if (ms <= 0) return "Closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export function Dashboard() {
  const { address, connect } = useWallet();
  const { data: sale } = useSaleState();

  return (
    <div className="mt-6 space-y-8">
      <div className="grid gap-5 lg:grid-cols-5">
        <SaleHero className="lg:col-span-3" />
        <div className="lg:col-span-2">
          {address ? (
            <PledgeCard />
          ) : (
            <ConnectCta onConnect={connect} />
          )}
        </div>
      </div>

      {address && (
        <div className="grid gap-4 lg:grid-cols-3">
          <BalanceCard />
          <ClaimRefundPanel />
          {sale && sale.status === 0 && <FinalizePanel />}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Recent Pledges</h2>
          <span className="text-[10px] uppercase tracking-[0.18em] text-subtle">
            Live · On-chain
          </span>
        </div>
        <EventFeed />
      </div>
    </div>
  );
}

function SaleHero({ className }: { className?: string }) {
  const { data, isLoading } = useSaleState();
  if (isLoading || !data) {
    return (
      <div className={`rounded-2xl border border-border bg-surface p-7 ${className}`}>
        <div className="h-40 animate-pulse rounded bg-elevated" />
      </div>
    );
  }
  const pct =
    data.softCap > 0n
      ? Math.min(100, Number((data.totalRaised * 100n) / data.softCap))
      : 0;
  const status = STATUS_LABEL[data.status] ?? "?";

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-surface p-7 ${className}`}>
      <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-subtle">
          Public Sale
        </div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            data.status === 0
              ? "bg-accent/10 text-accent"
              : data.status === 1
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger"
          }`}
        >
          {status}
        </div>
      </div>

      <h2 className="mt-3 font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
        {fmtXlm(data.totalRaised)}
        <span className="ml-2 text-base font-normal text-muted">XLM raised</span>
      </h2>
      <div className="mt-2 text-xs text-subtle">
        {fmtCountdown(data.deadline)} left · Soft cap {fmtXlm(data.softCap)} XLM · Hard cap {fmtXlm(data.hardCap)} XLM
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

      <p className="mt-5 max-w-md text-sm text-muted">
        Pledge XLM during the open window. If the soft cap is hit, every pledger
        claims their pro-rata share of the launched SEP-41 token. If not, every
        pledge refunds in one click.
      </p>
    </div>
  );
}

function PledgeCard() {
  const { address } = useWallet();
  const { data: pledged } = usePledgedOf(address);
  const pledge = usePledge(address);
  const [amount, setAmount] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await pledge.mutateAsync(xlmToStroops(amount));
      setAmount("");
    } catch {}
  }
  const err = pledge.error ? toError(pledge.error) : null;

  return (
    <form
      onSubmit={onSubmit}
      className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-elevated p-6"
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-subtle">
        Your Pledge
      </div>
      <div className="font-mono text-2xl font-semibold sm:text-3xl">
        {fmtXlm(pledged)}
        <span className="ml-1 text-sm font-normal text-muted">XLM</span>
      </div>

      <div className="mt-2 space-y-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-subtle">
          Add To Pledge
        </label>
        <input
          type="number"
          step="0.0000001"
          min="0.0000001"
          placeholder="Pledge amount (XLM)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={`${inputCls} font-mono`}
        />
        <div className="grid grid-cols-3 gap-2">
          {["10", "50", "100"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-muted hover:border-accent hover:text-fg"
            >
              {v} XLM
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={pledge.isPending}
        className="mt-auto w-full rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-cyan-300 disabled:opacity-50"
      >
        {pledge.isPending ? "Pledging..." : "Pledge XLM"}
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

function ClaimRefundPanel() {
  const { address } = useWallet();
  const { data: sale } = useSaleState();
  const { data: tokenBal } = useTokenBalance(address);
  const claim = useClaim(address);
  const refund = useRefund(address);
  if (!sale || sale.status === 0) return null;

  const isSuccess = sale.status === 1;
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wider text-subtle">
        {isSuccess ? "Claim Tokens" : "Refund Pledge"}
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
        onClick={() => (isSuccess ? claim.mutate() : refund.mutate())}
        disabled={claim.isPending || refund.isPending}
        className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg transition-colors hover:bg-cyan-300 disabled:opacity-50"
      >
        {claim.isPending || refund.isPending
          ? "Working..."
          : isSuccess
            ? "Claim Tokens"
            : "Refund My Pledge"}
      </button>
    </div>
  );
}

function FinalizePanel() {
  const { address } = useWallet();
  const finalize = useFinalize(address);
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wider text-subtle">
        Finalize (after deadline)
      </div>
      <p className="mt-2 text-sm text-muted">
        Once the deadline passes, anyone can call finalize to lock in the
        sale's outcome based on whether the soft cap was met.
      </p>
      <button
        onClick={() => finalize.mutate()}
        disabled={finalize.isPending}
        className="mt-3 w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm font-medium text-fg transition-colors hover:border-accent disabled:opacity-50"
      >
        {finalize.isPending ? "Finalizing..." : "Finalize Sale"}
      </button>
    </div>
  );
}

function ConnectCta({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-elevated p-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-subtle">
          Connect
        </div>
        <h2 className="mt-2 text-lg font-semibold">Connect a Wallet to Pledge</h2>
        <p className="mt-2 text-sm text-muted">
          Pledge XLM during the open window. If the soft cap is met, claim
          tokens pro-rata. If not, refund.
        </p>
      </div>
      <button
        onClick={onConnect}
        className="mt-6 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-cyan-300"
      >
        Connect Wallet
      </button>
    </div>
  );
}
