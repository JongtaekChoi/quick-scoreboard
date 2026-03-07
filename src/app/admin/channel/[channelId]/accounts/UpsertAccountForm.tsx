"use client";

import { useState } from "react";

interface Props {
  upsertAccount(formData: FormData): void;
  channel: { id: string };
  teams: { id: string; name: string }[] | null;
}
export default function UpsertAccountForm({
  upsertAccount,
  channel,
  teams = [],
}: Props): React.ReactElement {
  const [selectedRole, setSelectedRole] = useState<string>("manager");

  return (
    <form action={upsertAccount} className="grid md:grid-cols-5 gap-2">
      <input type="hidden" name="channelId" value={channel.id} />
      <select
        className="rounded border px-2 py-1.5 text-sm"
        name="role"
        required
        onChange={(v) => {
          setSelectedRole(v.target.value);
        }}
        value={selectedRole}
      >
        <option value="manager">팀관리자(manager)</option>
        <option value="admin">어드민(admin)</option>
      </select>
      <input
        className="rounded border px-2 py-1.5 text-sm"
        name="login_id"
        placeholder="로그인 ID"
        required
      />
      <input
        className="rounded border px-2 py-1.5 text-sm"
        name="password"
        type="password"
        placeholder="비밀번호"
        required
      />
      {selectedRole === "manager" ? (
        <select
          className="rounded border px-2 py-1.5 text-sm"
          name="team_id"
          defaultValue=""
          required
        >
          <option value="">팀을 선택하세요</option>
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : null}
      <button className="rounded border px-3 py-2 text-sm" type="submit">
        저장
      </button>
    </form>
  );
}
