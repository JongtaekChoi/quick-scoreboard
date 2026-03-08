import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { hashAccountPassword } from "@/lib/passwordHash";
import {
  createAccountSession,
  destroyChannelSession,
} from "@/lib/channelSession";

type Channel = { id: string; slug: string; edit_session_version: number };
type ChannelAccount = {
  id: string;
  role: "admin" | "manager" | "player";
  login_id: string;
  password_hash: string;
  team_id: string | null;
  session_version: number;
  is_active: boolean;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const form = await req.formData();
  const loginId = String(form.get("login_id") || "").trim();
  const password = String(form.get("password") || "").trim();
  const action = String(form.get("action") || "login");
  const redirectTo = String(form.get("redirect_to") || "").trim();

  const safeRedirect = (fallback: string) => {
    if (redirectTo && redirectTo.startsWith("/")) return redirectTo;
    return fallback;
  };

  const supabase = getSupabaseServerClient();
  if (!supabase)
    return NextResponse.redirect(new URL(`/c/${slug}?acc=env`, req.url));

  if (action === "logout") {
    await destroyChannelSession(slug);
    return NextResponse.redirect(new URL(safeRedirect(`/c/${slug}`), req.url));
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,slug,edit_session_version")
    .eq("slug", slug)
    .maybeSingle<Channel>();

  if (!channel)
    return NextResponse.redirect(new URL(`/c/${slug}?acc=notfound`, req.url));

  const { data: account } = await supabase
    .from("channel_accounts")
    .select("id,role,login_id,password_hash,team_id,session_version,is_active")
    .eq("channel_id", channel.id)
    .eq("login_id", loginId)
    .maybeSingle<ChannelAccount>();

  if (
    !account ||
    !account.is_active ||
    hashAccountPassword(password) !== account.password_hash
  ) {
    const errRedirect = redirectTo && redirectTo.startsWith("/")
      ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}acc=password`
      : `/c/${slug}?acc=password`;
    return NextResponse.redirect(new URL(errRedirect, req.url));
  }

  const editVersion =
    account.role === "admin" ||
    account.role === "manager" ||
    account.role === "player"
      ? channel.edit_session_version
      : null;

  await createAccountSession(slug, {
    loginId: account.login_id,
    role: account.role,
    teamId: account.team_id,
    version: account.session_version,
    editVersion,
  });

  return NextResponse.redirect(new URL(safeRedirect(`/c/${slug}?acc=1`), req.url));
}
