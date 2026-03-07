import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { getAccountInfo } from "@/lib/channelSession";
import { hashAccountPassword } from "@/lib/passwordHash";
import UpsertAccountForm from "./UpsertAccountForm";

type Channel = { id: string; name: string; slug: string };
type Team = { id: string; name: string };
type AccountRow = {
  id: string;
  role: "admin" | "manager";
  login_id: string;
  team_id: string | null;
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
    | "manager";
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
  if (!["admin", "manager"].includes(role)) return;
  if (role === "manager" && !teamId) return;
  if (role !== "manager" && teamId) {
    redirect(`/admin/channel/${channelId}/accounts?err=team_role`);
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await supabase.from("channel_accounts").upsert(
    {
      channel_id: channelId,
      role,
      login_id: loginId,
      password_hash: hashAccountPassword(password),
      team_id: role === "manager" ? teamId : null,
      is_active: true,
    },
    { onConflict: "channel_id,login_id" },
  );

  redirect(`/admin/channel/${channelId}/accounts?saved=1`);
}

async function toggleAccountActive(formData: FormData) {
  "use server";
  const channelId = String(formData.get("channelId") || "");
  const accountId = String(formData.get("accountId") || "");
  const next = String(formData.get("next") || "") === "1";

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  const supabase = getSupabaseServerClient();
  if (!supabase || !accountId) return;

  if (!next) {
    const { data: current } = await supabase
      .from("channel_accounts")
      .select("id,role,is_active")
      .eq("id", accountId)
      .maybeSingle<{
        id: string;
        role: "admin" | "manager";
        is_active: boolean;
      }>();

    if (current?.role === "admin" && current.is_active) {
      const { count } = await supabase
        .from("channel_accounts")
        .select("*", { count: "exact", head: true })
        .eq("channel_id", channelId)
        .eq("role", "admin")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        redirect(`/admin/channel/${channelId}/accounts?err=last_admin`);
      }
    }
  }

  await supabase
    .from("channel_accounts")
    .update({ is_active: next })
    .eq("id", accountId);
  redirect(`/admin/channel/${channelId}/accounts`);
}

async function resetPassword(formData: FormData) {
  "use server";
  const channelId = String(formData.get("channelId") || "");
  const accountId = String(formData.get("accountId") || "");
  const newPassword = String(formData.get("newPassword") || "").trim();

  const manage = await canManageAccounts(channelId);
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`);
    redirect("/admin/login");
  }

  if (!accountId || !newPassword) return;

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await supabase
    .from("channel_accounts")
    .update({ password_hash: hashAccountPassword(newPassword) })
    .eq("id", accountId)
    .eq("channel_id", channelId);

  redirect(`/admin/channel/${channelId}/accounts?reset=1`);
}

export default async function AdminAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ saved?: string; err?: string; reset?: string }>;
}) {
  const { channelId } = await params;
  const { saved, err, reset } = await searchParams;

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
      .select("id,role,login_id,team_id,is_active,updated_at")
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
            {channel.name} · 권한 계정(admin/manager) 관리
          </p>
          {saved === "1" ? (
            <p className="text-xs text-green-700">계정이 저장되었습니다.</p>
          ) : null}
          {reset === "1" ? (
            <p className="text-xs text-green-700">
              비밀번호가 변경되었습니다.
            </p>
          ) : null}
          {err === "last_admin" ? (
            <p className="text-xs text-red-600">
              활성 어드민 계정은 최소 1개 이상 유지되어야 합니다.
            </p>
          ) : null}
          {err === "team_role" ? (
            <p className="text-xs text-red-600">
              팀 지정은 팀관리자(manager) 계정에만 가능합니다.
            </p>
          ) : null}
        </header>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold">계정 추가/수정</h2>
          <p className="text-xs text-gray-500">
            동일 로그인 ID가 있으면 비밀번호/권한/팀이 갱신됩니다.
          </p>
          <UpsertAccountForm
            upsertAccount={upsertAccount}
            teams={teams}
            channel={channel}
          />
          <p className="text-[11px] text-gray-500">
            ※ 팀 지정은 팀관리자(manager) 역할에서만 가능합니다.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">계정 목록</h2>
          {(accounts ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">등록된 계정이 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {(accounts ?? []).map((a) => (
                <li
                  key={a.id}
                  className="rounded border px-3 py-2 flex items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{a.login_id}</span>
                    <span className="ml-2 text-xs text-gray-600">
                      [{a.role}]
                    </span>
                    {a.team_id ? (
                      <span className="ml-2 text-xs text-gray-500">
                        팀: {teamNameById.get(a.team_id) ?? a.team_id}
                      </span>
                    ) : null}
                    {!a.is_active ? (
                      <span className="ml-2 text-xs text-gray-400">
                        (비활성)
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <form
                      action={resetPassword}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="hidden"
                        name="channelId"
                        value={channel.id}
                      />
                      <input type="hidden" name="accountId" value={a.id} />
                      <input
                        type="password"
                        name="newPassword"
                        placeholder="새 비밀번호"
                        required
                        className="border rounded px-2 py-0.5 text-xs w-28"
                      />
                      <button
                        className="text-xs underline whitespace-nowrap"
                        type="submit"
                      >
                        리셋
                      </button>
                    </form>
                    <form action={toggleAccountActive}>
                      <input
                        type="hidden"
                        name="channelId"
                        value={channel.id}
                      />
                      <input type="hidden" name="accountId" value={a.id} />
                      <input
                        type="hidden"
                        name="next"
                        value={a.is_active ? "0" : "1"}
                      />
                      <button className="text-xs underline" type="submit">
                        {a.is_active ? "비활성화" : "활성화"}
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
