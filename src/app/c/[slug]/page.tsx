import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isEditAuthorized, getManagerInfo, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import GroupList from "./GroupList";
import ShareButton from "@/components/ShareButton";

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
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
  status: "scheduled" | "live" | "ended";
  scheduled_start_at: string | null;
};

export const dynamic = "force-dynamic";

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
  searchParams: Promise<{
    date?: string;
    err?: string;
    edit?: string;
    order?: string;
    mgr?: string;
    acc?: string;
  }>;
}) {
  const { slug } = await params;
  const { date, order, acc } = await searchParams;
  const matchOrder: "asc" | "desc" = order === "desc" ? "desc" : "asc";

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
  const canEdit = await isEditAuthorized(
    channel.slug,
    channel.edit_session_version,
  );
  const managerInfo = await getManagerInfo(channel.slug);
  const managerTeamId = managerInfo?.teamId ?? null;
  const isChannelAdmin = accountSession?.role === "admin";
  const channelUrl = `https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}`;

  await autoStartDueMatches(supabase);

  let groupQuery = supabase
    .from("match_groups")
    .select("id,channel_id,play_date,venue,title,seq")
    .eq("channel_id", channel.id)
    .order("play_date", { ascending: false })
    .order("seq", { ascending: true });

  if (date) {
    groupQuery = groupQuery.eq("play_date", date);
  }

  const { data: groups } = await groupQuery.returns<MatchGroup[]>();
  const groupIds = (groups ?? []).map((g) => g.id);

  const { data: matches } = groupIds.length
    ? await supabase
        .from("matches")
        .select(
          "id,match_group_id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at",
        )
        .in("match_group_id", groupIds)
        .order("seq", { ascending: matchOrder === "asc" })
        .returns<Match[]>()
    : { data: [] as Match[] };

  const matchesByGroup = new Map<string, Match[]>();
  for (const m of matches ?? []) {
    if (!m.match_group_id) continue;
    const arr = matchesByGroup.get(m.match_group_id) ?? [];
    arr.push(m);
    matchesByGroup.set(m.match_group_id, arr);
  }
  const matchesByGroupObj = Object.fromEntries(matchesByGroup.entries());

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
      <section className="max-w-4xl mx-auto space-y-4">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-semibold">{channel.name}</h1>
            <ShareButton
              url={channelUrl}
              title={`${channel.name} 경기목록`}
              className="rounded border px-2 py-1 text-xs"
            />
          </div>
          <p className="text-sm text-gray-600">경기목록 (날짜/그룹 단위)</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {accountSession ? (
              <>
                <span className="rounded px-2 py-1 border bg-green-50 border-green-200 text-green-700">
                  {accountSession.loginId} ({accountSession.role})
                </span>
                <form
                  action={`/c/${encodeURIComponent(channel.slug)}/login`}
                  method="post"
                >
                  <input type="hidden" name="action" value="logout" />
                  <button className="underline" type="submit">
                    로그아웃
                  </button>
                </form>
              </>
            ) : (
              <form
                action={`/c/${encodeURIComponent(channel.slug)}/login`}
                method="post"
                className="flex items-center gap-2"
              >
                <input
                  className="rounded border px-2 py-1"
                  name="login_id"
                  placeholder="계정 ID"
                  required
                />
                <input
                  className="rounded border px-2 py-1"
                  type="password"
                  name="password"
                  placeholder="비밀번호"
                  required
                />
                <button className="rounded border px-2 py-1" type="submit">
                  로그인
                </button>
              </form>
            )}
            {acc === "password" ? (
              <span className="text-red-600">계정 정보가 올바르지 않습니다.</span>
            ) : null}
            {acc === "1" ? (
              <span className="text-green-700">로그인되었습니다.</span>
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
          <form className="flex flex-wrap items-center gap-2" method="get">
            <label className="text-xs text-gray-600">날짜</label>
            <input
              className="rounded border px-2 py-1.5 text-sm"
              type="date"
              name="date"
              defaultValue={date ?? ""}
            />
            <label className="text-xs text-gray-600">정렬</label>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              name="order"
              defaultValue={matchOrder}
            >
              <option value="asc">경기순 1→N</option>
              <option value="desc">경기순 N→1</option>
            </select>
            <button
              className="rounded border px-3 py-1.5 text-sm"
              type="submit"
            >
              적용
            </button>
            {date || matchOrder !== "asc" ? (
              <Link
                className="text-xs underline text-gray-600"
                href={`/c/${encodeURIComponent(channel.slug)}`}
              >
                초기화
              </Link>
            ) : null}
          </form>
        </header>

        {(groups ?? []).length === 0 ? (
          <section className="rounded border p-4 text-sm text-gray-500">
            표시할 경기그룹이 없습니다.
          </section>
        ) : (
          <GroupList
            groups={groups ?? []}
            matchesByGroup={matchesByGroupObj}
            channelId={channel.id}
            showManagerEntryButton={!!managerTeamId}
          />
        )}
      </section>
    </main>
  );
}
