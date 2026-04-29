"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { networkPassphrase } from "@/lib/stellar";
import {
  invokeContract,
  addrArg,
  i128Arg,
  u64Arg,
  readContract,
} from "@/lib/soroban";
import { StellarWalletsKit } from "@/lib/wallets";

const PAD_ID = process.env.NEXT_PUBLIC_MAIN_CONTRACT_ID;
const TOKEN_ID = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID;

function ensureId() {
  if (!PAD_ID) throw new Error("NEXT_PUBLIC_MAIN_CONTRACT_ID is not set");
  return PAD_ID;
}

function signer(addr: string) {
  return async (xdrText: string) => {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdrText, {
      address: addr,
      networkPassphrase,
    });
    return signedTxXdr;
  };
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["balance"] });
  qc.invalidateQueries({ queryKey: ["campaign"] });
  qc.invalidateQueries({ queryKey: ["campaigns"] });
  qc.invalidateQueries({ queryKey: ["campaign-count"] });
  qc.invalidateQueries({ queryKey: ["pledged"] });
  qc.invalidateQueries({ queryKey: ["withdrawn"] });
  qc.invalidateQueries({ queryKey: ["events"] });
}

export type CreateCampaignInput = {
  priceTokensPerXlm: bigint;
  softCap: bigint;
  hardCap: bigint;
  deadline: bigint;
};

export function useCreateCampaign(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "create_campaign",
        args: [
          addrArg(address),
          i128Arg(input.priceTokensPerXlm),
          i128Arg(input.softCap),
          i128Arg(input.hardCap),
          u64Arg(input.deadline),
        ],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export function usePledge(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { campaignId: bigint; xlm: bigint }) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "pledge",
        args: [addrArg(address), u64Arg(input.campaignId), i128Arg(input.xlm)],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useClaim(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "claim",
        args: [addrArg(address), u64Arg(campaignId)],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useRefund(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "refund",
        args: [addrArg(address), u64Arg(campaignId)],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useWithdraw(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "withdraw",
        args: [addrArg(address), u64Arg(campaignId)],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useFinalize(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "finalize",
        args: [u64Arg(campaignId)],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export type Campaign = {
  id: bigint;
  creator: string;
  priceTokensPerXlm: bigint;
  softCap: bigint;
  hardCap: bigint;
  deadline: bigint;
  totalRaised: bigint;
  status: number;
};

const STATUS_LABEL = ["Active", "Successful", "Failed"] as const;
export function statusLabel(n: number) {
  return STATUS_LABEL[n] ?? "?";
}

function normalizeStatus(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const i = STATUS_LABEL.indexOf(raw as (typeof STATUS_LABEL)[number]);
    return i >= 0 ? i : 0;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    const i = STATUS_LABEL.indexOf(raw[0] as (typeof STATUS_LABEL)[number]);
    return i >= 0 ? i : 0;
  }
  if (raw && typeof raw === "object") {
    const tag = (raw as { tag?: string }).tag;
    if (tag) {
      const i = STATUS_LABEL.indexOf(tag as (typeof STATUS_LABEL)[number]);
      if (i >= 0) return i;
    }
  }
  return 0;
}

export function useCampaignCount() {
  return useQuery<bigint>({
    queryKey: ["campaign-count", PAD_ID],
    queryFn: async () => {
      if (!PAD_ID) return 0n;
      return readContract<bigint>({
        contractId: PAD_ID,
        method: "campaign_count",
        args: [],
      });
    },
    enabled: !!PAD_ID,
    refetchInterval: 8_000,
  });
}

export function useCampaign(campaignId: bigint | null) {
  return useQuery<Campaign | null>({
    queryKey: ["campaign", PAD_ID, campaignId?.toString() ?? null],
    queryFn: async () => {
      if (!PAD_ID || campaignId === null) return null;
      const raw = await readContract<unknown>({
        contractId: PAD_ID,
        method: "campaign",
        args: [u64Arg(campaignId)],
      });
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      return {
        id: campaignId,
        creator: String(r.creator ?? ""),
        priceTokensPerXlm: BigInt((r.price_tokens_per_xlm as bigint | number) ?? 0),
        softCap: BigInt((r.soft_cap as bigint | number) ?? 0),
        hardCap: BigInt((r.hard_cap as bigint | number) ?? 0),
        deadline: BigInt((r.deadline as bigint | number) ?? 0),
        totalRaised: BigInt((r.total_raised as bigint | number) ?? 0),
        status: normalizeStatus(r.status),
      };
    },
    enabled: !!PAD_ID && campaignId !== null,
    refetchInterval: 8_000,
  });
}

export function useAllCampaigns() {
  const count = useCampaignCount();
  return useQuery<Campaign[]>({
    queryKey: ["campaigns", PAD_ID, count.data?.toString() ?? "0"],
    queryFn: async () => {
      if (!PAD_ID) return [];
      const total = Number(count.data ?? 0n);
      if (total === 0) return [];
      const ids = Array.from({ length: total }, (_, i) => BigInt(i));
      const results = await Promise.all(
        ids.map(async (cid) => {
          const raw = await readContract<unknown>({
            contractId: PAD_ID,
            method: "campaign",
            args: [u64Arg(cid)],
          }).catch(() => null);
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          return {
            id: cid,
            creator: String(r.creator ?? ""),
            priceTokensPerXlm: BigInt((r.price_tokens_per_xlm as bigint | number) ?? 0),
            softCap: BigInt((r.soft_cap as bigint | number) ?? 0),
            hardCap: BigInt((r.hard_cap as bigint | number) ?? 0),
            deadline: BigInt((r.deadline as bigint | number) ?? 0),
            totalRaised: BigInt((r.total_raised as bigint | number) ?? 0),
            status: normalizeStatus(r.status),
          } satisfies Campaign;
        }),
      );
      return results.filter((c): c is Campaign => c !== null);
    },
    enabled: !!PAD_ID && count.data !== undefined,
    refetchInterval: 8_000,
  });
}

export function usePledgedOf(address: string | null, campaignId: bigint | null) {
  return useQuery<bigint>({
    queryKey: ["pledged", PAD_ID, campaignId?.toString() ?? null, address],
    queryFn: async () => {
      if (!PAD_ID || !address || campaignId === null) return 0n;
      return readContract<bigint>({
        contractId: PAD_ID,
        method: "pledged_of",
        args: [u64Arg(campaignId), addrArg(address)],
        source: address,
      });
    },
    enabled: !!PAD_ID && !!address && campaignId !== null,
    refetchInterval: 8_000,
  });
}

export function useWasWithdrawn(campaignId: bigint | null) {
  return useQuery<boolean>({
    queryKey: ["withdrawn", PAD_ID, campaignId?.toString() ?? null],
    queryFn: async () => {
      if (!PAD_ID || campaignId === null) return false;
      return readContract<boolean>({
        contractId: PAD_ID,
        method: "was_withdrawn",
        args: [u64Arg(campaignId)],
      });
    },
    enabled: !!PAD_ID && campaignId !== null,
    refetchInterval: 8_000,
  });
}

export function useTokenBalance(address: string | null) {
  return useQuery<bigint>({
    queryKey: ["balance", "token", TOKEN_ID, address],
    queryFn: async () => {
      if (!TOKEN_ID || !address) return 0n;
      return readContract<bigint>({
        contractId: TOKEN_ID,
        method: "balance",
        args: [addrArg(address)],
        source: address,
      });
    },
    enabled: !!TOKEN_ID && !!address,
    refetchInterval: 8_000,
  });
}
