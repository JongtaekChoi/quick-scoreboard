"use client";

import { useQuery } from "@tanstack/react-query";
import type { MatchDetailPayload } from "./types";

export function useMatchDetail(matchId: string) {
  return useQuery({
    queryKey: ["match-detail", matchId],
    queryFn: async (): Promise<MatchDetailPayload> => {
      const res = await fetch(`/api/matches/${matchId}/detail`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "failed_to_fetch");
      }
      return res.json();
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
