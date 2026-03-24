import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase";
import MatchDetailClient from "./MatchDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { title: `경기 ${matchId}` };
  }

  const { data: match } = await supabase
    .from("matches")
    .select("seq,team_a_name,team_b_name")
    .eq("id", matchId)
    .maybeSingle<{ seq: number; team_a_name: string; team_b_name: string }>();

  if (!match) {
    return { title: `경기 ${matchId}` };
  }

  return {
    title: `${match.seq}경기 ${match.team_a_name} vs ${match.team_b_name}`,
    description: `${match.team_a_name} vs ${match.team_b_name} 경기 상세`,
  };
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <MatchDetailClient matchId={matchId} />;
}
