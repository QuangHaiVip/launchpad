"use client";

import { useContractEvents } from "@/hooks/use-contract-events";
import type { ContractEvent } from "@/lib/events";

function shortAddr(a: string) {
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}
function fmt(n: bigint) {
  return (Number(n) / 1e7).toFixed(4).replace(/\.?0+$/, "");
}
function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function EventFeed() {
  const { data, isLoading, isError } = useContractEvents();
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-subtle">
        Activity
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-accent">on-chain</span>
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-elevated" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-3 text-sm text-danger">Failed to load events</div>
      ) : !data || data.length === 0 ? (
        <div className="mt-3 text-sm text-subtle">No activity yet.</div>
      ) : (
        <ul className="mt-3 space-y-3">
          {data.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ e }: { e: ContractEvent }) {
  return (
    <li className="border-l-2 border-accent/40 pl-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider">
            {e.kind}
          </span>
          {e.actor && (
            <>
              <span className="text-subtle"> · </span>
              <span className="font-mono text-xs">{shortAddr(e.actor)}</span>
            </>
          )}
        </div>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${e.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-subtle hover:text-accent"
        >
          {timeAgo(e.ledgerClosedAt)}
        </a>
      </div>
      <div className="mt-1 font-mono text-xs text-muted">{summarize(e)}</div>
    </li>
  );
}

function summarize(e: ContractEvent): string {
  // every event tuple now leads with campaign_id
  const [campaignId, a, b] = e.values;
  const cid = campaignId !== undefined ? `#${campaignId.toString()}` : "?";
  switch (e.kind) {
    case "create":
      return `call ${cid} opened: soft cap ${fmt(a ?? 0n)} XLM, hard cap ${fmt(b ?? 0n)} XLM`;
    case "pledge":
      return `${fmt(a ?? 0n)} XLM pledged into call ${cid}`;
    case "claim":
      return `call ${cid}: pledged ${fmt(a ?? 0n)} XLM, claimed ${b?.toString() ?? "0"} tokens`;
    case "refund":
      return `call ${cid}: ${fmt(a ?? 0n)} XLM refunded`;
    case "finalize":
      return `call ${cid} finalized: total raised ${fmt(a ?? 0n)} XLM, status ${b?.toString() ?? "?"}`;
    default:
      return e.values.map((x) => x.toString()).join(" · ");
  }
}
