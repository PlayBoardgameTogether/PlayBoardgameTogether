import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { api, navigate } from '../platform.js';
import { mergeRoomSnapshot } from '../pages/roomSnapshot.js';
import { reconnectBackoff } from '../network/scheduling.js';
import { z } from 'zod';
import { roomSnapshotSchema, type RoomSnapshot, type SessionPublic } from '@boardgame/protocol';
const roomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('room.snapshot'),
    roomId: z.string().uuid(),
    snapshot: roomSnapshotSchema,
  }),
  z.object({
    type: z.literal('room.presence'),
    roomId: z.string().uuid(),
    presenceSeq: z.number().int().nonnegative(),
    onlineAccountIds: z.string().uuid().array(),
  }),
  z.object({ type: z.literal('room.closed'), roomId: z.string().uuid() }),
  z.object({ type: z.literal('subscription.revoked'), roomId: z.string().uuid() }),
]);
export function useRoomSession(id: string, onStarted: (id: string) => void, onClosed: () => void) {
  const [room, setRoom] = useState<RoomSnapshot>();
  const [me, setMe] = useState<SessionPublic>();
  const [error, setError] = useState('');
  const [online, setOnline] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const active = useRef(false);
  const callbacks = useRef({ onStarted, onClosed });
  callbacks.current = { onStarted, onClosed };
  useEffect(() => {
    active.current = true;
    let disposed = false;
    let closed = false;
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    const backoff = reconnectBackoff(10000);
    const controller = new AbortController();
    let connecting = false;
    let presenceSeq = -1;
    let latest: RoomSnapshot | undefined;
    function update(next: RoomSnapshot) {
      if (disposed) return;
      const merged = mergeRoomSnapshot(latest, next);
      if (merged.status === 'closed') {
        closed = true;
        socket?.close();
        callbacks.current.onClosed();
        return;
      }
      const started =
        latest?.status === 'waiting' && merged.status === 'in_game' && merged.activeMatchId;
      latest = merged;
      setRoom((current) => mergeRoomSnapshot(current, merged));
      if (started) callbacks.current.onStarted(started);
    }
    async function connect() {
      if (disposed || closed || connecting) return;
      connecting = true;
      try {
        const [account, snapshot] = await Promise.all([
          api.me(controller.signal),
          api.room(id, controller.signal),
        ]);
        if (disposed || closed) return;
        setMe(account);
        update(snapshot);
        if (closed) return;
      } catch (cause) {
        if (disposed) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
          closed = true;
          navigate('/login');
          return;
        }
        setError(cause instanceof Error ? cause.message : '无法读取该房间。');
        schedule();
        return;
      } finally {
        connecting = false;
      }
      const url = new URL('/api/v1/ws/session', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const current = new WebSocket(url);
      socket = current;
      presenceSeq = -1;
      current.onopen = () =>
        current.send(JSON.stringify({ protocolVersion: 1, type: 'room.subscribe', roomId: id }));
      current.onmessage = (event) => {
        if (disposed || socket !== current) return;
        try {
          const raw: unknown = JSON.parse(String(event.data));
          const parsed = roomMessageSchema.safeParse(raw);
          if (!parsed.success || parsed.data.roomId !== id) return;
          const message = parsed.data;
          switch (message.type) {
            case 'room.snapshot':
              update(message.snapshot);
              setConnected(true);
              setError('');
              backoff.reset();
              break;
            case 'room.presence':
              if (message.presenceSeq > presenceSeq) {
                presenceSeq = message.presenceSeq;
                setOnline(message.onlineAccountIds);
              }
              break;
            case 'room.closed':
              closed = true;
              setConnected(false);
              current.close();
              callbacks.current.onClosed();
              break;
            case 'subscription.revoked':
              closed = true;
              setConnected(false);
              setError('已失去房间访问权限。');
              current.close();
              break;
          }
        } catch {
          setError('实时消息无法读取，请刷新页面。');
        }
      };
      current.onclose = (event) => {
        if (disposed || socket !== current) return;
        setConnected(false);
        setOnline([]);
        if (closed) return;
        if (event.code === 4001) {
          closed = true;
          navigate('/login');
          return;
        }
        schedule();
      };
    }
    function schedule() {
      if (disposed || closed) return;
      if (retry !== undefined) clearTimeout(retry);
      retry = window.setTimeout(() => {
        void connect();
      }, backoff.next());
    }
    void connect();
    return () => {
      active.current = false;
      disposed = true;
      controller.abort();
      if (retry !== undefined) clearTimeout(retry);
      socket?.close();
    };
  }, [id]);
  return { room, setRoom, me, error, setError, online, connected, setConnected, active };
}
