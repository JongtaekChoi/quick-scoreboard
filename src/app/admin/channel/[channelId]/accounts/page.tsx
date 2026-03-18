import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { getAccountInfo } from "@/lib/channelSession";
import { hashAccountPassword } from "@/lib/passwordHash";
import UpsertAccountForm from "./UpsertAccountForm";
import PendingSubmitButton from "@/components/PendingSubmitButton";

type Channel = { id: string; name: string; slug: string };
type Team = { id: string; name: string };
const ACCOUNTS_FEEDBACK_COOKIE = "qsb_accounts_feedback";

async function setAccountsFeedback(code: string, detail?: string) {
  const store = await cookies();
  store.set(ACCOUNTS_FEEDBACK_COOKIE, detail ? `${code}:${encodeURIComponent(detail)}` : code, {
    path: "/",
    maxAge: 10,
    sameSite: "lax",
  });
}

type AccountRow = {
  id: string;
  role: "admin" | "manager" | "player";
  login_id: string;
  team_id: string | null;
  player_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
  updated_at: string;
};

async function canManageAccounts(channelId: string) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { allowed: false, channel: null as Channel | null };

  const { data: channel } = await supabase
    .from("channels")
    .select("id,name,slug")
    .eq("id", channelId)
    .maybeSingle<Channel>();

  if (!channel) return { allowed: false, channel: null as Channel | null };
  const admin = await isAdminAuthorized();
  if (admin) return { allowed: true, channel };

  const account = await getAccountInfo(channel.slug);
  return { allowed: account?.role === "admin", channel };
}

async function upsertAccount(formData: FormData) {
  "use server";
  const channelId = String(formData.get("channelId") || "");
  const role = String(formData.get("role") || "") as
    | "admin"
    | "manager"
    | "player";
  const loginId = String(formData.get("login_id") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const teamIdRaw = String(formData.get("team_id") || "").trim();
  const teamId = teamIdRaw || null;

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  if (!channelId || !loginId || !password) return;
  if (!["admin", "manager", "player"].includes(role)) return;
  if ((role === "manager" || role === "player") && !teamId) return;
  if (role === "admin" && teamId) {
    await setAccountsFeedback("team_role");
    return;
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await supabase.from("channel_accounts").upsert(
    {
      channel_id: channelId,
      role,
      login_id: loginId,
      password_hash: hashAccountPassword(password),
      team_id: role === "admin" ? null : teamId,
      player_id: null,
      must_change_password: true,
      is_active: true,
    },
    { onConflict: "channel_id,login_id" },
  );

  redirect(`/admin/channel/${channelId}/accounts?saved=1`);
}

async function createPlayerAccounts(formData: FormData) {
  "use server";
  const channelId = String(formData.get("channelId") || "");

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const { data: players, error: playersError } = await supabase
    .from("team_players")
    .select("id,team_id,player_name,is_active")
    .eq("channel_id", channelId)
    .eq("is_active", true)
    .returns<{ id: string; team_id: string; player_name: string; is_active: boolean }[]>();

  if (playersError) {
    const detail = encodeURIComponent(`${playersError.code ?? 'unknown'}:${playersError.message ?? 'query failed'}`);
    await setAccountsFeedback("players_query_failed", detail);
    return;
  }

  const list = (players ?? []).filter((p) => p.player_name?.trim());
  if (list.length === 0) {
    await setAccountsFeedback("no_players");
    return;
  }

  const names = list.map((p) => p.player_name.trim());
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) {
    await setAccountsFeedback("dup_login");
    return;
  }

  const { data: conflicted, error: conflictedError } = await supabase
    .from("channel_accounts")
    .select("login_id,role")
    .eq("channel_id", channelId)
    .in("login_id", names)
    .neq("role", "player")
    .returns<{ login_id: string; role: string }[]>();

  if (conflictedError) {
    const detail = encodeURIComponent(`${conflictedError.code ?? 'unknown'}:${conflictedError.message ?? 'reserved check failed'}`);
    await setAccountsFeedback("reserved_check_failed", detail);
    return;
  }
  if ((conflicted ?? []).length > 0) {
    await setAccountsFeedback("reserved_login");
    return;
  }

  const rows = list.map((p) => ({
    channel_id: channelId,
    role: "player" as const,
    login_id: p.player_name.trim(),
    password_hash: hashAccountPassword("1234"),
    team_id: p.team_id,
    player_id: p.id,
    must_change_password: true,
    is_active: true,
  }));

  const { error: upsertError } = await supabase
    .from("channel_accounts")
    .upsert(rows, { onConflict: "channel_id,login_id" });

  if (upsertError) {
    const detail = encodeURIComponent(`${upsertError.code ?? 'unknown'}:${upsertError.message ?? 'bulk create failed'}`);
    await setAccountsFeedback("bulk_create_failed", detail);
    return;
  }

  redirect(`/admin/channel/${channelId}/accounts?saved=1`);
}

async function updateAccount(formData: FormData) {
  "use server";
  const channelId = String(formData.get("channelId") || "");
  const accountId = String(formData.get("accountId") || "");
  const role = String(formData.get("role") || "") as "admin" | "manager" | "player";
  const teamIdRaw = String(formData.get("team_id") || "").trim();
  const teamId = teamIdRaw || null;
  const isActive = String(formData.get("is_active") || "") === "1";
  const newPassword = String(formData.get("newPassword") || "").trim();

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  if (!accountId) return;
  if (!["admin", "manager", "player"].includes(role)) return;
  if ((role === "manager" || role === "player") && !teamId) {
    await setAccountsFeedback("team_role");
    return;
  }
  if (role === "admin" && teamId) {
    await setAccountsFeedback("team_role");
    return;
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const updatePayload: {
    role: "admin" | "manager" | "player";
    team_id: string | null;
    is_active: boolean;
    password_hash?: string;
    must_change_password?: boolean;
  } = {
    role,
    team_id: role === "admin" ? null : teamId,
    is_active: isActive,
  };

  if (newPassword) {
    updatePayload.password_hash = hashAccountPassword(newPassword);
    updatePayload.must_change_password = true;
  }

  await supabase
    .from("channel_accounts")
    .update(updatePayload)
    .eq("id", accountId)
    .eq("channel_id", channelId);

  redirect(`/admin/channel/${channelId}/accounts?saved=1`);
}

export default async function AdminAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ saved?: string; err?: string; reset?: string; detail?: string; modal?: string; edit?: string }>;
}) {
  const { channelId } = await params;
  const { saved, err, reset, detail, modal, edit } = await searchParams;
  const store = await cookies();
  const rawFeedback = err ? (detail ? `${err}:${encodeURIComponent(detail)}` : err) : (store.get(ACCOUNTS_FEEDBACK_COOKIE)?.value ?? null);
  const [feedbackErr, feedbackDetailEncoded] = rawFeedback ? rawFeedback.split(":", 2) : [null, null];
  const feedbackDetail = feedbackDetailEncoded ? decodeURIComponent(feedbackDetailEncoded) : null;
  if (rawFeedback) store.delete(ACCOUNTS_FEEDBACK_COOKIE);

  const supabase = getSupabaseServerClient();
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>;

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  const channel = manage.channel;
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>;

  const [{ data: accounts }, { data: teams }] = await Promise.all([
    supabase
      .from("channel_accounts")
      .select("id,role,login_id,team_id,player_id,must_change_password,is_active,updated_at")
      .eq("channel_id", channel.id)
      .order("role", { ascending: true })
      .order("login_id", { ascending: true })
      .returns<AccountRow[]>(),
    supabase
      .from("channel_teams_view")
      .select("id,name")
      .eq("channel_id", channel.id)
      .order("name", { ascending: true })
      .returns<Team[]>(),
  ]);

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/c/${channel.slug}`}>
              리그 경기목록
            </Link>
            <span>›</span>
            <Link
              className="underline"
              href={`/admin/channel/${channel.id}?from=channel`}
            >
              경기그룹 관리
            </Link>
            <span>›</span>
            <span>계정 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">계정 관리</h1>
          <p className="text-sm text-gray-600">
            {channel.name} · 권한 계정(admin/manager/player) 관리
          </p>
          {saved === "1" ? (
            <p className="text-xs text-green-700">계정이 저장되었습니다.</p>
          ) : null}
          {reset === "1" ? (
            <p className="text-xs text-green-700">비밀번호가 변경되었습니다.</p>
          ) : null}
          {feedbackErr === "last_admin" ? (
            <p className="text-xs text-red-600">
              활성 어드민 계정은 최소 1개 이상 유지되어야 합니다.
            </p>
          ) : null}
          {feedbackErr === "team_role" ? (
            <p className="text-xs text-red-600">
              팀 지정은 팀관리자(manager) 또는 팀원(player) 계정에만 가능합니다.
            </p>
          ) : null}
          {feedbackErr === "dup_login" ? (
            <p className="text-xs text-red-600">
              동일 선수명이 있어 일괄 계정 생성을 중단했습니다. 로그인 ID 중복을 먼저 정리해 주세요.
            </p>
          ) : null}
          {feedbackErr === "reserved_login" ? (
            <p className="text-xs text-red-600">
              기존 관리자/팀장 계정과 동일한 로그인 ID가 있어 일괄 생성을 중단했습니다.
            </p>
          ) : null}
          {feedbackErr === "no_players" ? (
            <p className="text-xs text-red-600">
              활성 선수 데이터가 없어 계정을 생성하지 못했습니다. 팀 멤버 관리에서 선수 등록/활성화를 먼저 해주세요.
            </p>
          ) : null}
          {feedbackErr === "players_query_failed" || feedbackErr === "reserved_check_failed" || feedbackErr === "bulk_create_failed" ? (
            <p className="text-xs text-red-600">
              일괄 생성 중 DB 오류가 발생했습니다. {feedbackDetail ? `(${feedbackDetail})` : "잠시 후 다시 시도해 주세요."}
            </p>
          ) : null}
        </header>

        <section className="rounded border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">계정 관리</h2>
            <Link
              href={`/admin/channel/${channel.id}/accounts?modal=create`}
              className="rounded border px-3 py-1.5 text-xs"
            >
              + 계정 추가
            </Link>
          </div>
          <form action={createPlayerAccounts}>
            <input type="hidden" name="channelId" value={channel.id} />
            <PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="생성중...">
              선수 계정 일괄 생성 (ID=선수명, PW=1234)
            </PendingSubmitButton>
          </form>
          <p className="text-[11px] text-gray-500">
            계정을 클릭하면 편집 화면이 열립니다.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">계정 목록</h2>
          {(accounts ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">등록된 계정이 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {(accounts ?? []).map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/channel/${channel.id}/accounts?modal=edit&edit=${a.id}`}
                    className="rounded border px-3 py-2 flex items-center justify-between gap-2 text-sm hover:bg-gray-50"
                  >
                    <div>
                      <span className="font-medium">{a.login_id}</span>
                      <span className="ml-2 text-xs text-gray-600">[{a.role}]</span>
                      {a.team_id ? (
                        <span className="ml-2 text-xs text-gray-500">
                          팀: {teamNameById.get(a.team_id) ?? a.team_id}
                        </span>
                      ) : null}
                      {a.must_change_password ? (
                        <span className="ml-2 text-xs text-amber-700">(비번변경필요)</span>
                      ) : null}
                      {!a.is_active ? (
                        <span className="ml-2 text-xs text-gray-400">(비활성)</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-gray-500">편집</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {modal === "create" ? (
          <div className="fixed inset-0 z-50 bg-black/30 p-4 flex items-center justify-center">
            <div className="w-full max-w-2xl rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">계정 추가</h3>
                <Link className="text-xs underline" href={`/admin/channel/${channel.id}/accounts`}>닫기</Link>
              </div>
              <UpsertAccountForm upsertAccount={upsertAccount} teams={teams} channel={channel} />
              <p className="text-[11px] text-gray-500">※ 팀 지정은 manager/player 역할에서만 가능합니다.</p>
            </div>
          </div>
        ) : null}

        {modal === "edit" && edit ? (
          (() => {
            const target = (accounts ?? []).find((a) => a.id === edit);
            if (!target) return null;
            return (
              <div className="fixed inset-0 z-50 bg-black/30 p-4 flex items-center justify-center">
                <div className="w-full max-w-2xl rounded-xl border bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">계정 편집 · {target.login_id}</h3>
                    <Link className="text-xs underline" href={`/admin/channel/${channel.id}/accounts`}>닫기</Link>
                  </div>
                  <form action={updateAccount} className="grid md:grid-cols-2 gap-2">
                    <input type="hidden" name="channelId" value={channel.id} />
                    <input type="hidden" name="accountId" value={target.id} />
                    <label className="text-xs text-gray-600">권한
                      <select className="mt-1 w-full rounded border px-2 py-1.5 text-sm" name="role" defaultValue={target.role}>
                        <option value="player">팀원(player)</option>
                        <option value="manager">팀관리자(manager)</option>
                        <option value="admin">어드민(admin)</option>
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">팀
                      <select className="mt-1 w-full rounded border px-2 py-1.5 text-sm" name="team_id" defaultValue={target.team_id ?? ""}>
                        <option value="">(팀 없음)</option>
                        {(teams ?? []).map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">새 비밀번호(선택)
                      <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" type="password" name="newPassword" placeholder="입력 시 비밀번호 갱신" />
                    </label>
                    <label className="text-xs text-gray-600">활성 여부
                      <select className="mt-1 w-full rounded border px-2 py-1.5 text-sm" name="is_active" defaultValue={target.is_active ? "1" : "0"}>
                        <option value="1">활성</option>
                        <option value="0">비활성</option>
                      </select>
                    </label>
                    <div className="md:col-span-2 flex justify-end gap-2">
                      <Link className="rounded border px-3 py-2 text-sm" href={`/admin/channel/${channel.id}/accounts`}>취소</Link>
                      <PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="저장중...">저장</PendingSubmitButton>
                    </div>
                  </form>
                </div>
              </div>
            );
          })()
        ) : null}
      </section>
    </main>
  );
}
