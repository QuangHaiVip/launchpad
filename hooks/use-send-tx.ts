"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { networkPassphrase } from "@/lib/stellar";
import { invokeContract, addrArg, i128Arg, readContract } from "@/lib/soroban";
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
  qc.invalidateQueries({ queryKey: ["sale"] });
  qc.invalidateQueries({ queryKey: ["pledged"] });
  qc.invalidateQueries({ queryKey: ["events"] });
}

export function usePledge(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (xlm: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "pledge",
        args: [addrArg(address), i128Arg(xlm)],
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
    mutationFn: async () => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "claim",
        args: [addrArg(address)],
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
    mutationFn: async () => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "refund",
        args: [addrArg(address)],
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
    mutationFn: async () => {
      if (!address) throw new Error("connect a wallet first");
      const id = ensureId();
      return invokeContract({
        contractId: id,
        method: "finalize",
        args: [],
        source: address,
        signXdr: signer(address),
      });
    },
    onSuccess: () => invalidate(qc),
  });
}

export type SaleState = {
  totalRaised: bigint;
  softCap: bigint;
  hardCap: bigint;
  deadline: bigint;
  status: number;
};

export function useSaleState() {
  return useQuery<SaleState>({
    queryKey: ["sale", PAD_ID],
    queryFn: async () => {
      if (!PAD_ID) throw new Error("not configured");
      const tup = await readContract<[bigint, bigint, bigint, bigint, number]>({
        contractId: PAD_ID,
        method: "sale_state",
        args: [],
      });
      return {
        totalRaised: tup[0],
        softCap: tup[1],
        hardCap: tup[2],
        deadline: tup[3],
        status: Number(tup[4]),
      };
    },
    enabled: !!PAD_ID,
    refetchInterval: 8_000,
  });
}

export function usePledgedOf(address: string | null) {
  return useQuery<bigint>({
    queryKey: ["pledged", PAD_ID, address],
    queryFn: async () => {
      if (!PAD_ID || !address) return 0n;
      return readContract<bigint>({
        contractId: PAD_ID,
        method: "pledged_of",
        args: [addrArg(address)],
        source: address,
      });
    },
    enabled: !!PAD_ID && !!address,
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
