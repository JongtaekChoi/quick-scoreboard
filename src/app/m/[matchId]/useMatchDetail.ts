"use client";

import { useQuery } from "@tanstack/react-query";
import type { MatchDetailPayload } from "./types";

export function useMatchDetail(matchId: string) {
  return useQuery({
    queryKey: ["match-detail", matchId],
    queryFn: async (): Promise<MatchDetailPayload> => {
      const res = await fetch(`/api/matches/${matchId}/detail`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "failed_to_fetch");
      }
      return res.json();
    },
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
