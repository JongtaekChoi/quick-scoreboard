import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getManagerInfo, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import GroupList from "./GroupList";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import LoginModal from "./LoginModal";
import { resolveTeamColor } from "@/lib/teamColor";

type Channel = {
  id: string;
  name: string;
  slug: string;
  edit_session_version: number;
};
type MatchGroup = {
  id: string;
  channel_id: string;
  play_date: string;
  venue: string | null;
  title: string | null;
  seq: number;
};
type Match = {
  id: string;
  match_group_id: string | null;
  seq: number;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
  status: "scheduled" | "live" | "ended";
  scheduled_start_at: string | null;
};

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { title: `리그 ${slug}` };
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("name")
    .eq("slug", slug)
    .maybeSingle<{ name: string }>();

  return {
    title: channel ? channel.name : `리그 ${slug}`,
    description: channel ? `${channel.name} 경기목록` : "리그 경기목록",
  };
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ acc?: string; pw?: string }>;
}) {
  const { slug } = await params;
  const { acc, pw } = await searchParams;

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="min-h-screen p-4 md:p-6">
        <section className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">리그 경기목록</h1>
          <p className="text-sm text-amber-700">
            Supabase 환경변수가 없어서 데이터 연결을 건너뛰었습니다.
          </p>
          <p className="text-xs text-gray-600">
            NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 설정
            후 다시 확인해 주세요.
          </p>
        </section>
      </main>
    );
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,name,slug,edit_session_version")
    .eq("slug", slug)
    .maybeSingle<Channel>();

  if (!channel) {
    return (
      <main className="min-h-screen p-4 md:p-6">
        <section className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">리그를 찾을 수 없음</h1>
          <p className="text-sm text-gray-600">유효한 링크인지 확인해 주세요.</p>
        </section>
      </main>
    );
  }

  const isAdmin = await isAdminAuthorized();
  const accountSession = await getAccountInfo(channel.slug);
  const managerInfo = await getManagerInfo(channel.slug);
  const managerTeamId = managerInfo?.teamId ?? null;
  const isChannelAdmin = accountSession?.role === "admin";
  const channelUrl = `https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}`;

  await autoStartDueMatches(supabase);

  const { data: groups } = await supabase
    .from("match_groups")
    .select("id,channel_id,play_date,venue,title,seq")
    .eq("channel_id", channel.id)
    .order("play_date", { ascending: false })
    .order("seq", { ascending: true })
    .returns<MatchGroup[]>();

  const groupIds = (groups ?? []).map((g) => g.id);

  const { data: matches } = groupIds.length
    ? await supabase
        .from("matches")
        .select(
          "id,match_group_id,seq,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at",
        )
        .in("match_group_id", groupIds)
        .order("seq", { ascending: true })
        .returns<Match[]>()
    : { data: [] as Match[] };

  const teamIds = Array.from(
    new Set(
      (matches ?? [])
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const { data: teams } = teamIds.length
    ? await supabase
        .from("teams")
        .select("id,name,color_hex")
        .in("id", teamIds)
        .returns<{ id: string; name: string; color_hex: string | null }[]>()
    : { data: [] as { id: string; name: string; color_hex: string | null }[] };

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const teamColorById = Object.fromEntries(
    (teams ?? []).map((t) => [t.id, resolveTeamColor({ teamId: t.id, teamName: t.name, colorHex: t.color_hex })]),
  );
  const normalizedMatches = (matches ?? []).map((m) => ({
    ...m,
    team_a_name: m.team_a_id ? (teamNameById.get(m.team_a_id) ?? m.team_a_name) : m.team_a_name,
    team_b_name: m.team_b_id ? (teamNameById.get(m.team_b_id) ?? m.team_b_name) : m.team_b_name,
  }));

  const matchesByGroup = new Map<string, Match[]>();
  for (const m of normalizedMatches) {
    if (!m.match_group_id) continue;
    const arr = matchesByGroup.get(m.match_group_id) ?? [];
    arr.push(m);
    matchesByGroup.set(m.match_group_id, arr);
  }
  const matchesByGroupObj = Object.fromEntries(matchesByGroup.entries());

  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6 page-enter">
      <section className="max-w-4xl mx-auto space-y-4">
        <header className="sticky top-0 z-20 space-y-3 rounded-2xl border bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{channel.name}</h1>
            <div className="flex items-center gap-2">
              {!accountSession ? (
                <LoginModal slug={channel.slug} accError={acc === "password"} />
              ) : null}
              {accountSession ? (
                <AccountBadge
                  loginId={accountSession.loginId}
                  role={accountSession.role}
                  slug={channel.slug}
                  accountHref={`/c/${encodeURIComponent(channel.slug)}/account`}
                />
              ) : null}
              <ShareButton
                url={channelUrl}
                title={`${channel.name} 경기목록`}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-600">경기목록 (날짜 기준)</p>
            <Link className="rounded-full border px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50" href={`/c/${encodeURIComponent(channel.slug)}/stats`}>
              통계 보기
            </Link>
            <Link className="rounded-full border px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50" href={`/c/${encodeURIComponent(channel.slug)}/calendar`}>
              달력 보기
            </Link>
            {channel.slug === "sample" ? (
              <Link className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100" href="/c/sample/guide">
                샘플 사용 가이드
              </Link>
            ) : null}
          </div>
          {channel.slug === "sample" ? (
            <section className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              처음 사용하면 <Link className="underline font-medium" href="/c/sample/guide">샘플 사용 가이드</Link>를 먼저 확인해 주세요.
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {accountSession?.mustChangePassword ? (
              <span className="text-amber-700">초기 비밀번호 변경이 필요합니다.</span>
            ) : null}
            {acc === "1" ? (
              <span className="text-green-700">로그인되었습니다.</span>
            ) : null}
            {pw === "1" ? (
              <span className="text-green-700">비밀번호가 변경되었습니다.</span>
            ) : null}
            {isAdmin || isChannelAdmin || managerTeamId ? (
              <Link
                className="underline"
                href={managerTeamId ? `/admin/channel/${channel.id}/manager-entries` : `/admin/channel/${channel.id}?from=channel`}
              >
                {managerTeamId ? '내 팀 엔트리 관리' : '운영 관리 열기'}
              </Link>
            ) : null}
          </div>
        </header>

        {(groups ?? []).length === 0 ? (
          <section className="rounded-2xl border bg-white p-4 text-sm text-gray-500 shadow-sm">
            표시할 경기그룹이 없습니다.
          </section>
        ) : (
          <GroupList
            groups={groups ?? []}
            matchesByGroup={matchesByGroupObj}
            teamColorById={teamColorById}
            channelId={channel.id}
            showManagerEntryButton={!!managerTeamId}
          />
        )}
      </section>

    </main>
  );
}
