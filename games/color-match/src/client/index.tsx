import { useEffect, useRef, useState } from 'react';
import './style.css';
import type { AssetResolverPort } from '@boardgame/game-sdk/assets';
export { ColorAssetPreview } from './preview.js';
export { colorMatchTutorial } from './tutorial.js';
import { publicEventSchema, viewSchema, type ColorAction, type ColorView, type Card } from '../shared/index.js';

const colorNames = { red: '红', blue: '蓝', yellow: '黄', green: '绿' };
function label(card: Card) { return `${colorNames[card.color]} ${card.number}`; }
export function parseColorView(value: unknown): ColorView { return viewSchema.parse(value); }

function AssetImage({src,label,className}:{src:string|undefined;label:string;className?:string}){
  const[failed,setFailed]=useState(false);
  return src&&!failed?<img className={className??'game-asset-image'} src={src} alt={label} onError={()=>setFailed(true)}/>:null;
}
export function ColorBoard({ view, busy, events, onAction, assets }: {
  view: ColorView;
  busy: boolean;
  events: unknown[];
  onAction: (action: ColorAction) => void;
  assets?: AssetResolverPort | undefined;
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const playersSection = useRef<HTMLElement>(null);
  const selected = selectedCardId && view.legalCardIds.includes(selectedCardId) ? selectedCardId : null;
  const mine = view.currentPlayerId === view.viewingSeatId;
  const finished = view.phase === 'finished';
  const choosingTarget = mine && view.phase === 'choose_target';
  useEffect(() => {
    if (!choosingTarget || busy) return;
    // Move to the next interaction, without choosing or submitting a target.
    playersSection.current?.querySelector<HTMLButtonElement>('.color-target-button:not(:disabled)')?.focus();
  }, [choosingTarget, busy]);
  useEffect(() => {
    if (finished || !mine || busy && view.legalCardIds.length === 0) setSelectedCardId(null);
    if (view.phase !== 'choose_target' || !mine) setTargetId(null);
  }, [finished, mine, view.phase, view.legalCardIds, busy]);
  return <div className="color-board">
    <AssetImage key={assets?.resolveImage('board.table')??'table'} src={assets?.resolveImage('board.table')} label="桌面背景" className="game-table-image"/>
    {finished && <section className="panel color-result" aria-label="结束页面">
      <p className="eyebrow">游戏结束</p><h2>对局结束</h2>
      <p>{view.winners.length > 1 ? `平局：座位 ${view.winners.map(id => view.seats.indexOf(id) + 1).join('、')}` :
        `座位 ${view.seats.indexOf(view.winners[0]!) + 1} 获胜`}</p>
      <p className="muted">最终公共牌和每位玩家的手牌数量保留在下方。</p>
    </section>}
    <section className="panel" aria-label="公共牌区域">
      <p className="eyebrow">公共牌</p>
      <div className={`color-card color-card--${view.topCard.color}`}><AssetImage key={assets?.resolveImage(`card.${view.topCard.color}.${view.topCard.number}`)??'top'} src={assets?.resolveImage(`card.${view.topCard.color}.${view.topCard.number}`)} label=""/><span>{label(view.topCard)}</span></div>
      <p>牌堆剩余 {view.deckCount} 张</p>
      <strong>{finished ? (view.winners.includes(view.viewingSeatId) ? (view.winners.length > 1 ? '平局，你是获胜者之一' : '你赢了！') : `座位 ${view.winners.map(id => view.seats.indexOf(id) + 1).join('、')} 获胜`) : mine ? (view.phase === 'choose_target' ? '请选择一名目标玩家' : '轮到你行动') : `等待座位 ${view.seats.indexOf(view.currentPlayerId ?? '') + 1} 行动`}</strong>
    </section>
    <section className="panel" aria-label="玩家列表" ref={playersSection}>
      <h2>玩家</h2>
      {choosingTarget && <p role="status">数字 5 已打出，请选择一名对手，再确认目标。</p>}
      <div className="color-players">{view.seats.map((seatId, index) => <div key={seatId} className={seatId === view.currentPlayerId ? 'color-player--active' : ''}>
        <strong>座位 {index + 1}{seatId === view.viewingSeatId ? ' · 你' : ''}</strong>
        <span>{view.handCounts[seatId]} 张手牌</span>
        {seatId!==view.viewingSeatId&&<div className="card-backs" aria-label={`${view.handCounts[seatId]} 张隐藏手牌`}>{Array.from({length:Math.min(view.handCounts[seatId]??0,8)},(_,index)=><span className="card-back" key={index}><AssetImage key={assets?.resolveImage('card.back.default')??'back'} src={assets?.resolveImage('card.back.default')} label="牌背"/><span>牌背</span></span>)}</div>}
        {view.targetSeatIds.includes(seatId) && <button className="color-target-button" disabled={busy} aria-pressed={targetId === seatId} onClick={() => setTargetId(seatId)}>指定摸牌</button>}
      </div>)}</div>
      {targetId && view.targetSeatIds.includes(targetId) && <div className="game-action-bar"><p>目标：座位 {view.seats.indexOf(targetId) + 1}</p><button disabled={busy} onClick={() => onAction({ type: 'choose_target', targetSeatId: targetId })}>确认目标</button><button className="secondary" disabled={busy} onClick={() => setTargetId(null)}>取消目标</button></div>}
    </section>
    <section className="panel color-hand" aria-label="我的手牌">
      <h2>我的手牌</h2>
      <p className="muted">匹配公共牌的颜色或数字即可出牌。数字 5 可指定一名对手摸牌。</p>
      <div className="color-hand-cards">{view.myHand.map(card => {
        const legal = view.legalCardIds.includes(card.id);
        return <button key={card.id} className={`color-card color-card--${card.color}${legal ? ' color-card--legal' : ''}${selected === card.id ? ' color-card--selected' : ''}`}
          disabled={!legal || busy} title={legal ? '出牌' : '当前不可出牌'}
          aria-pressed={selected === card.id}
          onClick={() => setSelectedCardId(current => current === card.id ? null : card.id)}><AssetImage key={assets?.resolveImage(`card.${card.color}.${card.number}`)??card.id} src={assets?.resolveImage(`card.${card.color}.${card.number}`)} label=""/><span>{label(card)}</span><small>{selected === card.id ? '已选中' : legal ? '可出' : '不可出'}</small></button>;
      })}</div>
      <div className="game-action-bar">
      {selected && <><p>已选：{label(view.myHand.find(card => card.id === selected)!)}</p><button disabled={busy} onClick={() => onAction({ type: 'play_card', cardId: selected })}>出牌</button><button className="secondary" disabled={busy} onClick={() => setSelectedCardId(null)}>取消选择</button></>}
      {view.canDraw && <button disabled={busy} onClick={() => { setSelectedCardId(null); onAction({ type: 'draw_card' }); }}><AssetImage key={assets?.resolveImage('icon.draw')??'draw'} src={assets?.resolveImage('icon.draw')} label="" className="game-icon"/>摸牌或跳过并结束回合</button>}
      </div>
    </section>
    <section className="panel color-events" aria-label="行动记录"><h2>最近行动</h2>
      {events.length === 0 ? <p className="muted">等待本场行动。</p> :
        <ol>{events.slice(-8).map(raw => {
          const event = publicEventSchema.parse(raw);
          const seat = view.seats.indexOf(event.seatId) + 1;
          let description = '';
          if (event.type === 'card.played' && event.card) description = `座位 ${seat} 打出 ${label(event.card)}`;
          if (event.type === 'card.draw') description = event.count ? `座位 ${seat} 摸了 ${event.count} 张牌` : `座位 ${seat} 无牌可摸，跳过`;
          if (event.type === 'target.chosen') description = `座位 ${seat} 指定座位 ${view.seats.indexOf(event.targetSeatId ?? '') + 1}`;
          if (event.type === 'game.win') description = `座位 ${seat} 获胜`;
          return <li key={event.eventId}>{description}</li>;
        })}</ol>}
    </section>
  </div>;
}
