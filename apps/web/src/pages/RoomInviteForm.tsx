import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, command, navigate } from '../platform.js';

const joinedRoomSchema = z.object({ id: z.string() });

export function RoomInviteForm({ embedded = false }: { embedded?: boolean } = {}) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setJoining(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const room = joinedRoomSchema.parse(await api.joinRoom({
        requestId: command(), inviteCode: String(fields.get('invite')),
        ...(fields.get('password') ? { password: String(fields.get('password')) } : {}),
      }));
      if (active.current) navigate(`/rooms/${room.id}`);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '加入失败');
    } finally {
      locked.current = false;
      if (active.current) setJoining(false);
    }
  }

  const formBody = (
    <>
      {!embedded && <h3>邀请码加入</h3>}
      <p className="muted invite-form-lead">朋友发来了邀请？输入邀请码进入对应房间。</p>
      <form className="form-stack" onSubmit={join}>
        <label>12 位邀请码<input name="invite" placeholder="ABCD-EFGH-JK23" required /></label>
        <label>邀请码房间密码（如有）<input name="password" type="password" maxLength={128} autoComplete="off" /></label>
        {error && <p className="error-notice" role="alert">{error}</p>}
        <button disabled={joining}>{joining ? '加入中…' : '加入私人房间'}</button>
      </form>
    </>
  );

  if (embedded) {
    return <div className="room-invite-embedded">{formBody}</div>;
  }

  return <section className="panel">{formBody}</section>;
}
