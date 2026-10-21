import { useEffect, useState } from 'react';
import type { MatchView } from '@boardgame/protocol';
import { api } from '../platform.js';
import '../styles/match-results.css';

export function MatchResultPanel({ data, inRoom = false }: { data: MatchView; inRoom?: boolean }) {
  const winners = data.result?.players.filter((player) => player.winner).length ?? 0;
  return (
    <section className="match-result-panel" aria-label="本局结果">
      <div>
        {!inRoom && <h2>{winners > 1 ? '本局结果 · 共同胜出' : '本局结果'}</h2>}
        {!data.result && <p className="muted">本局未记录结果摘要，可在游戏桌面查看最终局面。</p>}
      </div>
      {data.result && (
        <ul className="match-result-players">
          {data.result.players.map((result) => {
            const player = data.players?.find((item) => item.seatId === result.seatId);
            return (
              <li key={result.seatId}>
                <span>
                  {player?.displayName ?? '玩家'}
                  {player?.seatIndex === data.seatIndex ? '（你）' : ''}
                </span>
                <strong>{result.winner ? (winners > 1 ? '共同胜出' : '胜出') : '未胜出'}</strong>
                {result.score !== undefined && <span>{result.score} 分</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="match-result-actions">
        {inRoom && (
          <a className="button-link secondary" href={`/matches/${data.matchId}`}>
            查看本局结果
          </a>
        )}
        {!inRoom && (
          <a className="button-link" href={`/rooms/${data.roomId}`}>
            返回房间再来一局
          </a>
        )}
        <a className="button-link secondary" href={`/matches/${data.matchId}/replay`}>
          查看回放
        </a>
        <a href="/profile/history">我的对局记录</a>
      </div>
    </section>
  );
}

export function CompletedMatchResult({ id, roomId }: { id: string; roomId: string }) {
  const [data, setData] = useState<MatchView>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(false);
    void api
      .matchSnapshot(id)
      .then((next) => {
        if (!active) return;
        if (next.roomId === roomId && next.status === 'finished') setData(next);
        else setError(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id, roomId, attempt]);
  return data ? (
    <MatchResultPanel data={data} inRoom />
  ) : (
    <p role="status">
      {error ? (
        <>
          本局结果暂时无法读取。
          <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
            重试读取结果
          </button>
        </>
      ) : (
        '正在读取本局结果…'
      )}
    </p>
  );
}
