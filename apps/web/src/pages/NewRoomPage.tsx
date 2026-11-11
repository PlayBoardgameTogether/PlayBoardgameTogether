import { useEffect, useState } from 'react';
import { api, navigate } from '../platform.js';
import { RoomCreateForm } from './RoomCreateForm.js';
import { gamePath } from './game-catalog.js';

export function NewRoomPage({ selectedGame }: { selectedGame?: { id: string; version: string } }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .me()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active)
          navigate(
            '/login',
            {
              roomCreationPath: selectedGame ? `${gamePath(selectedGame)}/new` : '/rooms/new',
            },
            true,
          );
      });
    return () => {
      active = false;
    };
  }, [selectedGame?.id, selectedGame?.version]);
  if (!ready) return <p>正在验证会话…</p>;
  return (
    <div className="new-room-page">
      <p>
        <a href={selectedGame ? gamePath(selectedGame) : '/'}>
          {selectedGame ? '← 返回游戏详情' : '← 返回游戏大厅'}
        </a>
      </p>
      <section className="room-create-shell">
        <p className="eyebrow">开始一局游戏</p>
        <h1>创建房间</h1>
        <p className="muted">选好游戏和人数，创建后邀请朋友一起入座。</p>
        <RoomCreateForm {...(selectedGame ? { selectedGame } : {})} />
      </section>
    </div>
  );
}
