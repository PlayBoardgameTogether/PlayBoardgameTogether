import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { PageFeedback } from '@boardgame/ui';
import { z } from 'zod';
import { api, navigate } from '../platform.js';
import { GameCatalog } from './GameCatalog.js';
import { LobbyHeading } from './LobbyHeading.js';

const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  gameId: z.string(),
  gameVersion: z.string(),
  seatCount: z.number(),
  roomRevision: z.number(),
});
const roomsSchema = z.object({ items: z.array(roomSchema), nextCursor: z.string().nullable() });
const meSchema = z.object({ account: z.object({ id: z.string(), displayName: z.string() }) });
type Room = z.infer<typeof roomSchema>;
const statusNames: Record<string, string> = {
  waiting: '等待开局',
  in_game: '进行中',
  finished: '已结束',
  closed: '已关闭',
};

export function DashboardPage() {
  const [me, setMe] = useState<z.infer<typeof meSchema>>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const moreLock = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let disposed = false;
    active.current = true;
    setLoadError('');
    void Promise.all([api.me(), api.rooms()])
      .then(([rawAccount, rawPage]) => {
        if (disposed) return;
        const account = meSchema.parse(rawAccount);
        const page = roomsSchema.parse(rawPage);
        setMe(account);
        setRooms(page.items);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (disposed) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
        else setLoadError('无法加载你的房间，请检查连接后重试。');
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [attempt]);

  async function more() {
    if (!cursor || moreLock.current) return;
    moreLock.current = true;
    setLoadingMore(true);
    setError('');
    try {
      const page = roomsSchema.parse(await api.rooms(cursor));
      if (active.current) {
        setRooms((current) => [
          ...new Map([...current, ...page.items].map((room) => [room.id, room])).values(),
        ]);
        setCursor(page.nextCursor);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '加载失败');
    } finally {
      moreLock.current = false;
      if (active.current) setLoadingMore(false);
    }
  }

  if (loadError)
    return (
      <PageFeedback title="房间加载失败" retry={() => setAttempt((value) => value + 1)}>
        <p>{loadError}</p>
      </PageFeedback>
    );
  if (!me) return <PageFeedback title="正在进入大厅…" loading />;
  return (
    <>
      <LobbyHeading displayName={me.account.displayName} />
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      <div className="lobby-content">
        <GameCatalog />
        <section
          className={`panel discovery-resume continue-games${rooms.some((room) => room.status !== 'closed') ? '' : ' continue-games--empty'}`}
        >
          <h2>继续游戏</h2>
          {rooms.filter((room) => room.status !== 'closed').length === 0 ? (
            <p className="muted">暂无进行中的房间，去大厅挑一桌或新建房间吧。</p>
          ) : (
            rooms
              .filter((room) => room.status !== 'closed')
              .map((room) => (
                <button
                  className="room-row"
                  key={room.id}
                  onClick={() => navigate(`/rooms/${room.id}`)}
                >
                  <span>
                    <strong>{room.name}</strong>
                    <small>
                      {room.seatCount} 人 · {statusNames[room.status]}
                    </small>
                  </span>
                  <span>进入房间 →</span>
                </button>
              ))
          )}
          {cursor && (
            <button className="secondary" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? '正在加载…' : '加载更多'}
            </button>
          )}
        </section>
      </div>
    </>
  );
}
