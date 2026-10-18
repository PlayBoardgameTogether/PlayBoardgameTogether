import { RoomInviteForm } from './RoomInviteForm.js';

export function RoomInviteEntry() {
  return (
    <details className="lobby-invite room-disclosure">
      <summary>
        <span>邀请码加入</span>
        <small>输入邀请码直接加入房间</small>
      </summary>
      <div className="lobby-invite-body">
        <RoomInviteForm embedded />
      </div>
    </details>
  );
}
