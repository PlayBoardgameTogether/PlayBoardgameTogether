import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ApiError} from '@boardgame/client-sdk';
import type {LobbyQuery,LobbyRoom} from '@boardgame/protocol';
import { formatFriendId } from '@boardgame/protocol';
import {api,command,navigate} from '../platform.js';
import {loadGames,type AvailableGame} from './game-catalog.js';

const statusNames={waiting:'等待开局',in_game:'进行中',finished:'已结束',closed:'已关闭'};
export function Lobby({gameId,showHeading=true}:{gameId?:string;showHeading?:boolean}) {
  const [games,setGames]=useState<AvailableGame[]>([]);
  const [query,setQuery]=useState<LobbyQuery>({status:'waiting',gameId});
  const [rooms,setRooms]=useState<LobbyRoom[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [needsLogin,setNeedsLogin]=useState(false);
  const [selected,setSelected]=useState<LobbyRoom>();
  const [refresh,setRefresh]=useState(0);
  const generation=useRef(0);
  const joinLock=useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const joinButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected && !busy) passwordInput.current?.focus();
  }, [selected?.id, busy]);
  useEffect(()=>{
    let disposed=false;
    void loadGames().then(items=>{if(!disposed)setGames(items);}).catch(()=>undefined);
    return()=>{disposed=true;};
  },[]);
  useEffect(()=>{
    const token=++generation.current;
    setBusy(true);setError('');setNeedsLogin(false);setRooms([]);setCursor(null);setSelected(undefined);
    void api.lobby(query).then(page=>{if(token===generation.current){setRooms(page.items);setCursor(page.nextCursor);}})
      .catch(cause=>{
        if(token!==generation.current)return;
        if(cause instanceof ApiError&&cause.code==='UNAUTHENTICATED')setNeedsLogin(true);
        else setError(cause instanceof Error?cause.message:'大厅加载失败');
      })
      .finally(()=>{if(token===generation.current)setBusy(false);});
    return()=>{generation.current++;};
  },[query,refresh]);
  async function more() {
    if(!cursor||busy)return;
    const token=generation.current;
    setBusy(true);
    try {const page=await api.lobby({...query,cursor});if(token===generation.current){setRooms(old=>[...old,...page.items]);setCursor(page.nextCursor);}}
    catch(cause){if(token===generation.current)setError(cause instanceof Error?cause.message:'加载失败');}
    finally{if(token===generation.current)setBusy(false);}
  }
  async function join(room:LobbyRoom,password?:string) {
    if(room.isMember){navigate(`/rooms/${room.id}`);return;}
    if(joinLock.current)return;
    joinLock.current=true;
    const token=generation.current;
    setBusy(true);setError('');
    try {await api.joinPublicRoom(room.id,{requestId:command(),...(password?{password}:{})});if(token===generation.current)navigate(`/rooms/${room.id}`);}
    catch(cause){if(token===generation.current)setError(cause instanceof Error?cause.message:'加入失败');}
    finally{joinLock.current=false;if(token===generation.current)setBusy(false);}
  }
  function submitPassword(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(selected)void join(selected,String(new FormData(event.currentTarget).get('password')));
  }
  return <section className="room-list">{showHeading&&<><h2>公开房间</h2><p className="muted">挑选感兴趣的房间加入，私密房间请使用邀请码。</p></>}
    {!needsLogin&&<div className="lobby-filters">
      {!gameId&&<label>全部游戏<select value={query.gameId??''} onChange={event=>setQuery(old=>({...old,gameId:event.target.value||undefined}))}><option value="">全部游戏</option>{games.filter(game=>!game.developmentOnly).map(game=><option key={`${game.id}@${game.version}`} value={game.id}>{game.name}</option>)}</select></label>}
      <label>房间类型<select value={query.roomType??''} onChange={event=>setQuery(old=>({...old,roomType:(event.target.value||undefined) as LobbyQuery['roomType']}))}><option value="">全部类型</option><option value="open">公开无密码</option><option value="password">公开密码房</option></select></label>
      <label>房间状态<select value={query.status??''} onChange={event=>setQuery(old=>({...old,status:(event.target.value||undefined) as LobbyQuery['status']}))}><option value="">全部状态</option>{Object.entries(statusNames).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
      <button className="secondary" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>刷新列表</button>
    </div>}
    {needsLogin&&<p className="panel">登录后查看并加入公开房间。 <a href="/login">前往登录 →</a></p>}
    {error&&!selected&&<p className="error-notice" role="alert">{error}</p>}
    {rooms.map(room => <div className="lobby-room-entry" key={room.id}><article className="room-row">
      <span>
        <strong>{room.name}</strong>
        <small>房主：{room.hostDisplayName} · {formatFriendId(room.hostFriendId)}</small>
        <small>{games.find(game => game.id === room.gameId)?.name ?? room.gameId} · {room.occupiedCount}/{room.seatCount} 人 · {room.hasPassword ? '密码房' : '无密码'} · {statusNames[room.status]}</small>
        {room.status === 'waiting' && room.occupiedCount < room.seatCount && (
          <small className="discovery-room-openings">还有 {room.seatCount - room.occupiedCount} 个空位</small>
        )}
      </span>
      <button disabled={busy || (!room.isMember && (room.status !== 'waiting' || room.occupiedCount >= room.seatCount))}
        onClick={event => {
          if (room.hasPassword && !room.isMember) {
            joinButton.current = event.currentTarget;
            setError('');
            setSelected(room);
          } else void join(room);
        }}>
        {room.isMember ? '进入房间' : room.status !== 'waiting' ? '进行中' : room.occupiedCount >= room.seatCount ? '已满员' : '加入'}
      </button>
    </article>
      {selected?.id === room.id && <form className="panel form-stack lobby-password-form" aria-label={`加入 ${room.name}`} onSubmit={submitPassword}>
        <h3>加入 {room.name}</h3>
        <fieldset className="room-create-fields form-stack" disabled={busy}>
          <label>房间密码<input ref={passwordInput} name="password" type="password" maxLength={128} required autoComplete="off" aria-describedby={error ? 'lobby-join-error' : undefined} /></label>
          <button>{busy ? '加入中…' : '确认加入'}</button>
          <button type="button" className="secondary" onClick={() => {
            setSelected(undefined);
            setError('');
            joinButton.current?.focus();
          }}>取消</button>
        </fieldset>
        {error && <p className="error-notice" id="lobby-join-error" role="alert">{error}</p>}
      </form>}
    </div>)}
    {!busy&&!error&&!needsLogin&&!rooms.length&&<p className="muted">暂无符合条件的房间，换个筛选或自己开一桌吧。</p>}
    {busy&&<p role="status">正在加载…</p>}
    {cursor&&<button className="secondary" disabled={busy} onClick={()=>void more()}>加载更多</button>}
  </section>;
}
