'use client'

import { useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type ChannelTeam = { channelId: string; channelName: string; teamId: string; teamName: string }

export default function ImportTeamForm({
  channelId,
  otherChannelTeams,
  importTeam,
}: {
  channelId: string
  otherChannelTeams: ChannelTeam[]
  importTeam: (formData: FormData) => Promise<void>
}) {
  const channels = Array.from(
    new Map(otherChannelTeams.map((ct) => [ct.channelId, ct.channelName])),
  )
  const [selectedChannel, setSelectedChannel] = useState('')

  const filteredTeams = otherChannelTeams.filter((ct) => ct.channelId === selectedChannel)

  if (channels.length === 0) return null

  return (
    <section className="rounded border p-4 space-y-2">
      <h2 className="text-sm font-semibold">다른 채널에서 팀 가져오기</h2>
      <p className="text-xs text-gray-500">선택한 팀과 로스터(선수 목록)가 현재 채널로 복사됩니다.</p>

      <select
        className="rounded border px-2 py-1.5 text-sm w-full"
        value={selectedChannel}
        onChange={(e) => setSelectedChannel(e.target.value)}
      >
        <option value="">채널 선택...</option>
        {channels.map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>

      {selectedChannel && filteredTeams.length === 0 && (
        <p className="text-xs text-gray-500">해당 채널에 팀이 없습니다.</p>
      )}

      {filteredTeams.length > 0 && (
        <div className="space-y-1">
          {filteredTeams.map((ct) => (
            <form key={ct.teamId} action={importTeam} className="flex items-center gap-2">
              <input type="hidden" name="channelId" value={channelId} />
              <input type="hidden" name="sourceChannelId" value={ct.channelId} />
              <input type="hidden" name="teamId" value={ct.teamId} />
              <span className="text-sm flex-1">{ct.teamName}</span>
              <PendingSubmitButton className="rounded border px-2 py-1.5 text-xs" pendingText="가져오는 중...">가져오기</PendingSubmitButton>
            </form>
          ))}
        </div>
      )}
    </section>
  )
}
