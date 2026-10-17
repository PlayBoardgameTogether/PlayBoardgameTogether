import { RoomInviteForm } from './RoomInviteForm.js';

export function RoomInviteEntry() {
  return (
    <details className="lobby-invite room-disclosure">
      <summary>
        <span>邀请码加入</span>
        <small>朋友已经开好桌？直接输入邀请码</small>
      </summary>
      <div className="lobby-invite-body">
        <RoomInviteForm embedded />
      </div>
    </details>
  );
}
