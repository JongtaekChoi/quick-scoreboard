import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getManagerInfo, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import GroupList from "./GroupList";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import LoginModal from "./LoginModal";
import { resolveTeamColor } from "@/lib/teamColor";
import UserGNB from "@/components/UserGNB";

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

export const revalidate = 180;

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
  searchParams: Promise<{ acc?: string; pw?: string; mgr?: string; next?: string }>;
}) {
  const { slug } = await params;
  const { acc, pw, mgr, next } = await searchParams;

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

  const [isAdmin, accountSession, managerInfo] = await Promise.all([
    isAdminAuthorized(),
    getAccountInfo(channel.slug),
    getManagerInfo(channel.slug),
  ]);
  const managerTeamId = managerInfo?.teamId ?? null;
  const isChannelAdmin = accountSession?.role === "admin";
  const channelUrl = `https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}`;
  const supportOpenChatUrl = process.env.NEXT_PUBLIC_SUPPORT_OPENCHAT_URL?.trim() || '';

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
    <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0 page-enter">
      <section className="max-w-4xl mx-auto space-y-4">
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="matches"
          subtitle="경기목록 (날짜 기준)"
          isLoggedIn={!!accountSession}
          rightActions={(
            <>
              {!accountSession ? (
                <LoginModal slug={channel.slug} accError={acc === "password"} redirectTo={`/c/${encodeURIComponent(channel.slug)}`} triggerClassName="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white" />
              ) : null}
              {accountSession ? (
                <AccountBadge
                  loginId={accountSession.loginId}
                  role={accountSession.role}
                  slug={channel.slug}
                  accountHref={`/c/${encodeURIComponent(channel.slug)}/account`}
                />
              ) : null}
              {channel.slug === "sample" ? (
                <Link className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800" href="/c/sample/guide">
                  샘플 가이드
                </Link>
              ) : null}
              <ShareButton
                url={channelUrl}
                title={`${channel.name} 경기목록`}
              />
            </>
          )}
        />

        {channel.slug === "sample" ? (
          <section className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
            처음 사용하면 <Link className="underline font-medium" href="/c/sample/guide">샘플 사용 가이드</Link>를 먼저 확인해 주세요.
          </section>
        ) : null}

        {(accountSession?.mustChangePassword || acc === "1" || pw === "1" || mgr === "expired" || isAdmin || isChannelAdmin || managerTeamId || supportOpenChatUrl) ? (
          <div className="rounded-xl bg-white px-3 py-2.5 flex flex-wrap items-center gap-2 text-xs shadow-sm">
            {accountSession?.mustChangePassword ? (
              <span className="text-amber-700">초기 비밀번호 변경이 필요합니다.</span>
            ) : null}
            {acc === "1" ? (
              <span className="text-green-700">로그인되었습니다.</span>
            ) : null}
            {pw === "1" ? (
              <span className="text-green-700">비밀번호가 변경되었습니다.</span>
            ) : null}
            {mgr === "expired" ? (
              <span className="text-amber-700 inline-flex items-center gap-2">
                매니저 세션이 만료되었거나 권한이 변경되어 접근이 차단되었습니다.
                {next ? (
                  <Link className="underline" href={next}>확인</Link>
                ) : null}
              </span>
            ) : null}
            {isAdmin || isChannelAdmin || managerTeamId ? (
              <Link
                className="rounded-md bg-gray-900 px-2 py-0.5 text-white"
                href={managerTeamId ? `/admin/channel/${channel.id}/manager-entries` : `/admin/channel/${channel.id}?from=channel`}
              >
                {managerTeamId ? '내 팀 엔트리 관리' : '운영 관리 열기'}
              </Link>
            ) : null}
            {supportOpenChatUrl ? (
              <a
                className="ml-auto text-[11px] text-gray-400 underline underline-offset-2 hover:text-gray-600"
                href={supportOpenChatUrl}
                target="_blank"
                rel="noreferrer"
              >
                문의하기
              </a>
            ) : null}
          </div>
        ) : null}

        {(groups ?? []).length === 0 ? (
          <section className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm">
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
