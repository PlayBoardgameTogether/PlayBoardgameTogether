import './style.css';
import { playerLabel, type PlayerNames } from '@boardgame/game-sdk/presentation';
import { AssetContext, Gem, Visual, inks } from './visuals.js';
import { selectGem } from './interaction.js';
import { Activity } from './Activity.js';
import { useEffect, useState } from 'react';
import type { AssetResolverPort } from '@boardgame/game-sdk/assets';
import { cards as previewCards, nobles as previewNobles } from '../shared/catalog.js';
import {
  colors, countTokens, emptyTokens, names, paymentFor, tokenColors,
  type Card, type Color, type Noble, type SplendorAction, type SplendorView, type Token, type Tokens,
} from '../shared/index.js';

export { Gem } from './visuals.js';

function Architecture({ tier, color }: { tier: number; color: Color }) {
  return <svg className="sp-art" viewBox="0 0 180 92" aria-hidden="true">
    <path d="M0 81 28 68 49 78 67 65 112 79 151 59 180 75V92H0Z" fill={inks[color]} opacity=".15" />
    <g fill="none" stroke={inks[color]} strokeWidth="1.3">
      {tier === 1 ? <>
        <path d="M22 76V45L48 27 75 45V76M16 45H81M28 45V71M69 45V71M39 76V53H58V76M90 76V58L122 40 154 58V76M83 58H160M100 62V76M146 62V76" />
        <path d="M38 27V16H57V27M46 16V8M42 76H141M103 53H142" opacity=".5" />
      </> : tier === 2 ? <>
        <path d="M20 77V39H160V77M14 39 90 14 166 39ZM32 77V45H48V77M62 77V45H78V77M102 77V45H118V77M132 77V45H148V77M13 82H167M22 35H158" />
        <path d="M65 29H115M77 23H103M30 45H150" opacity=".5" />
      </> : <>
        <path d="M21 80V46H159V80M44 46V28H136V46M64 28C64 6 116 6 116 28M90 5V1M59 28H121M15 84H165M32 80V54H48V80M63 80V54H79V80M101 80V54H117V80M132 80V54H148V80" />
        <path d="M90 28V11M72 28C72 13 108 13 108 28M20 46H160" opacity=".5" />
      </>}
    </g>
    <path d="m155 7 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill={inks[color]} opacity=".75" />
  </svg>;
}
function Cost({ values }: { values: Partial<Tokens> }) {
  return <span className="sp-cost">{tokenColors.filter(color => (values[color] ?? 0) > 0).map(color =>
    <span key={color} title={names[color]}><Gem color={color} small /><b>{values[color]}</b><span className="sr-only">{names[color]}</span></span>)}</span>;
}
function DevelopmentCard({ card, selected, affordable, disabled, onSelect }: {
  card: Card; selected: boolean; affordable: boolean; disabled: boolean; onSelect: () => void;
}) {
  const title = ['矿场', '商会', '宫殿'][card.tier - 1]!;
  return <button className={'sp-card' + (selected ? ' sp-card--selected' : '') + (affordable ? ' sp-card--affordable' : '')} disabled={disabled}
    aria-pressed={selected} aria-label={names[card.bonus] + title + '，' + card.points + '声望，' + card.id} onClick={onSelect}>
    <Visual assetKey={card.id} className="sp-card-face"><span className="sp-card-top"><strong>{card.points}<small>声望</small></strong><Gem color={card.bonus} /></span>
    <Architecture tier={card.tier} color={card.bonus} />
    <span className="sp-card-caption">{title} <span>{names[card.bonus]} +1</span></span>
    <Cost values={card.cost} /></Visual>
    <span className="sp-art-details"><span className="sp-card-top"><strong>{card.points}<small>声望</small></strong><Gem color={card.bonus} small /></span>
      <span className="sp-card-caption">{names[card.bonus]}折扣 +1</span><Cost values={card.cost} /></span>
    <span className="sr-only">费用：<Cost values={card.cost} /></span>
    <span className={'sp-card-state' + (affordable ? ' sp-card-state--yes' : '')}>{affordable ? '可购买' : '积攒宝石或预留'}</span>
  </button>;
}
function Crest({ index }: { index: number }) {
  return <svg viewBox="0 0 60 68" className="sp-crest" aria-hidden="true">
    <path d="M9 17H51V39Q51 55 30 64Q9 55 9 39Z" fill="#d6b67d" fillOpacity=".1" stroke="#d6b67d" />
    <path d="M13 14 10 4 22 9 30 2 38 9 50 4 47 14Z" fill="#d6b67d" />
    {index % 2 === 0 ? <path d="M30 24 42 38 30 52 18 38Z" fill="#d6b67d" /> :
      <path d="M30 23V53M17 38H43M21 29 39 47M39 29 21 47" stroke="#d6b67d" strokeWidth="3" />}
  </svg>;
}
function NobleTile({ noble, index, eligible, busy, onSelect }: {
  noble: Noble; index: number; eligible: boolean; busy: boolean; onSelect: () => void;
}) {
  return <button className="sp-noble" disabled={busy || !eligible} onClick={onSelect} aria-label={'选择贵族 ' + noble.name}>
    <Visual assetKey={noble.id} className="sp-noble-face"><Crest index={index} /></Visual><span><strong>{noble.name}</strong><small>3 声望 · 永久折扣要求</small><Cost values={noble.requirement} /></span>
    {eligible && <b className="sp-arrival">选择到访</b>}
  </button>;
}
export function SplendorBoard(props: { view: SplendorView; busy: boolean; onAction: (action: SplendorAction) => void; assets?: AssetResolverPort | undefined; playerNames?: PlayerNames | undefined; events?: unknown[] }) {
  return <AssetContext.Provider value={props.assets}><SplendorTable {...props} /></AssetContext.Provider>;
}
function SplendorTable({ view, busy, onAction, events = [], playerNames }: { view: SplendorView; busy: boolean; onAction: (action: SplendorAction) => void; playerNames?: PlayerNames | undefined; events?: unknown[] }) {
  const [hint, setHint] = useState('');
  const [chosenColors, setChosenColors] = useState<Color[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goldFor, setGoldFor] = useState(emptyTokens);
  const [blindTier, setBlindTier] = useState<number | null>(null);
  const mine = view.players[view.viewingSeatId]!;
  const myTurn = view.currentSeatId === view.viewingSeatId && view.phase !== 'finished';
  const active = myTurn && view.phase === 'action' && !busy;
  const seatName = (seat: string) => playerLabel(seat, view.seats, view.viewingSeatId, playerNames, '座位');
  const selected = [...view.market.flat(), ...view.myReserved].find(card => card.id === selectedId);
  const defaultPayment = selected ? paymentFor(selected, mine.bonuses, mine.tokens) : null;
  const payment = { ...(defaultPayment ?? emptyTokens()) };
  if (selected && defaultPayment) for (const color of colors) {
    payment[color] -= goldFor[color];
    payment.gold += goldFor[color];
  }
  const paymentFits = defaultPayment !== null && payment.gold <= mine.tokens.gold;
  const canPay = selected && view.legalActions.some(action => action.type === 'buy' && action.cardId === selected.id &&
    tokenColors.every(color => action.payment[color] === payment[color]));
  const canReserve = selected && view.legalActions.some(action => action.type === 'reserve' && action.cardId === selected.id);
  const takeAction: SplendorAction = { type: 'take', colors: chosenColors };
  const canTake = view.legalActions.some(action => action.type === 'take' &&
    [...action.colors].sort().join() === [...chosenColors].sort().join());
  const canBlind = blindTier !== null && view.legalActions.some(action => action.type === 'reserve_deck' && action.tier === blindTier);
  const chooseCard = (card: Card) => {
    setSelectedId(selectedId === card.id ? null : card.id);
    setChosenColors([]); setBlindTier(null); setGoldFor(emptyTokens()); setHint('');
  };
  const clearSelection = () => {
    setSelectedId(null); setBlindTier(null); setChosenColors([]); setHint(''); setGoldFor(emptyTokens());
  };
  useEffect(clearSelection, [view.turn, view.phase, view.viewingSeatId]);
  const selectToken = (color: Token) => {
    const result = selectGem(view, chosenColors, color);
    setHint(result.error);
    if (result.error) return;
    setSelectedId(null); setBlindTier(null); setChosenColors(result.colors);
  };
  const label = !myTurn && view.phase !== 'finished' ? '等待' + seatName(view.currentSeatId) + '行动' : view.phase === 'return' ? '退回 ' + (countTokens(mine.tokens) - 10) + ' 枚代币' :
    view.phase === 'noble' ? '选择一位贵族到访' : myTurn ? '轮到你经营商会' : '等待' + seatName(view.currentSeatId) + '行动';
  return <section className="sp-table" aria-label="璀璨宝石游戏桌" onKeyDown={event => { if (event.key === 'Escape') clearSelection(); }}>
    <header className="sp-heading"><div><p>宝石商会 · 基础版</p><h2>璀璨宝石</h2></div>
      <div className="sp-round"><span>第 {Math.floor(view.turn / view.seats.length) + 1} 轮</span>
        <strong>{view.finalRound ? '最终轮' : '15 声望开启最终轮'}</strong></div></header>
    <p className={'sp-status' + (myTurn ? ' sp-status--mine' : '')} role="status">{view.phase === 'finished' ? '商会竞争已结束' : label}</p>
    <div className="sp-play-layout"><div className="sp-board-main">
    <div className="sp-resources"><section className="sp-bank" aria-label="公共宝石库存">
      <div className="sp-bank-title"><h3>宝石库存</h3><span>黄金仅通过预留获得</span></div>
      {tokenColors.map(color => <button key={color} className={'sp-token' + (chosenColors.includes(color as Color) ? ' sp-token--selected' : '')}
        aria-label={names[color] + '库存 ' + view.bank[color]} aria-pressed={chosenColors.includes(color as Color)}
        disabled={!active}
        onClick={() => selectToken(color)}>
        <Gem color={color} /><strong>{view.bank[color]}</strong><small>{names[color]}</small>{chosenColors.includes(color as Color) && <span className="sp-token-count">已选 {chosenColors.filter(item => item === color).length}</span>}</button>)}
    </section>
    <section className="sp-nobles" aria-label="贵族">
      <h3>贵族到访 <span>每回合至多一位 · 每位 3 声望</span></h3>
      <div>{view.nobles.map((noble, index) => <NobleTile key={noble.id} noble={noble} index={index} busy={busy}
        eligible={view.legalActions.some(action => action.type === 'noble' && action.nobleId === noble.id)}
        onSelect={() => onAction({ type: 'noble', nobleId: noble.id })} />)}</div>
    </section>
    </div>
    <div className="sp-take-hint">
      <span>点击三色各一枚，或连续点击同色两次（库存 ≥ 4）。</span>
      {chosenColors.length > 0 && <button className="secondary" disabled={!active} onClick={() => { setChosenColors([]); setHint(''); }}>清空宝石</button>}
    </div>
    {hint && <p className="sp-inline-error" role="alert">{hint}</p>}
    {myTurn && view.phase === 'return' && <section className="sp-decision" aria-label="退回多余代币">
      <h3>你的代币超过上限</h3><p>选择退回，直到剩下 10 枚。之后再结算贵族和回合。</p>
      <div className="sp-return">{tokenColors.map(color => <button key={color} disabled={busy || mine.tokens[color] === 0}
        onClick={() => onAction({ type: 'return', color })}>退回{names[color]} <b>{mine.tokens[color]}</b></button>)}</div>
    </section>}
    <section className="sp-market" aria-label="发展卡市场">
      {[2, 1, 0].map(tier => <div className="sp-tier" key={tier}>
        <button className="sp-deck" disabled={!active || !view.legalActions.some(action => action.type === 'reserve_deck' && action.tier === tier + 1)}
          aria-label={'盲抽' + (tier + 1) + '级牌堆，剩余' + view.deckCounts[tier] + '张'} aria-pressed={blindTier === tier + 1} onClick={() => { setBlindTier(blindTier === tier + 1 ? null : tier + 1); setSelectedId(null); setChosenColors([]); setHint(''); }}>
          <Visual assetKey={'card.back.' + (tier + 1)} className="sp-deck-face"><span>{['I', 'II', 'III'][tier]}</span></Visual><strong>{['矿场', '商会', '宫殿'][tier]}</strong>
          <small>剩余 {view.deckCounts[tier]} 张</small><small>点击盲抽预留</small></button>
        <div className="sp-card-row">{view.market[tier]!.map(card => <DevelopmentCard key={card.id} card={card} selected={selectedId === card.id}
          affordable={view.legalActions.some(action => action.type === 'buy' && action.cardId === card.id)}
          disabled={busy} onSelect={() => chooseCard(card)} />)}
          {!view.market[tier]!.length && <p>此等级牌堆已耗尽</p>}</div>
      </div>)}
    </section>
    {(selected || active && (chosenColors.length > 0 || blindTier !== null)) && <section className="sp-decision" aria-label="确认本回合操作">
      {selected ? <>
        <h3>{names[selected.bonus]}{['矿场','商会','宫殿'][selected.tier - 1]} · {selected.points} 声望</h3>
        <div className="sp-selected-detail"><Visual assetKey={selected.id} className="sp-detail-face"><Architecture tier={selected.tier} color={selected.bonus} /></Visual><Cost values={selected.cost} /></div>
        <p>永久折扣 +1 {names[selected.bonus]}。{paymentFits ? '预计支付：' : defaultPayment ? '黄金替代超出库存，请调整支付。' : '还缺 ' + Math.max(0, colors.reduce((sum, color) => sum + Math.max(0, selected.cost[color] - mine.bonuses[color] - mine.tokens[color]), 0) - mine.tokens.gold) + ' 枚宝石。'}{paymentFits && <Cost values={payment} />}</p>
        {defaultPayment && mine.tokens.gold > defaultPayment.gold && <details><summary>调整黄金替代</summary>
          <p>可主动使用黄金，保留同色宝石。</p>
          {colors.filter(color => defaultPayment[color] > 0).map(color => <label className="sp-payment" key={color}>{names[color]}
            <select aria-label={'黄金替代' + names[color]} value={goldFor[color]}
              onChange={event => setGoldFor({ ...goldFor, [color]: Number(event.target.value) })}>
              {Array.from({ length: defaultPayment[color] + 1 }, (_, amount) => <option key={amount} value={amount}>{amount} 枚</option>)}
            </select></label>)}
        </details>}
        {!active && <p>现在可查看卡牌，轮到你时再购买或预留。</p>}
        <div className="sp-confirm-actions"><button disabled={!active || !canPay} onClick={() => onAction({ type: 'buy', cardId: selected.id, payment })}>确认购买</button>
          <button className="secondary" disabled={!active || !canReserve} onClick={() => onAction({ type: 'reserve', cardId: selected.id })}>确认预留</button>
          <button className="secondary" onClick={() => setSelectedId(null)}>取消选择</button></div>
        {!canReserve && !view.myReserved.some(card => card.id === selected.id) && <p>预留已达三张上限，需先购买自己的预留卡。</p>}
      </> : blindTier !== null ? <>
        <h3>盲抽 {blindTier} 级牌堆</h3><p>获得一张仅自己可见的预留卡{view.bank.gold ? '和一枚黄金' : '；黄金库存已空'}。</p>
        <button disabled={!canBlind} onClick={() => onAction({ type: 'reserve_deck', tier: blindTier })}>确认盲抽预留</button>
        <button className="secondary" onClick={() => setBlindTier(null)}>取消选择</button>
      </> : <>
        <h3>拿取宝石 <span>{chosenColors.length} 枚</span></h3>
        <div className="sp-selected-gems">{chosenColors.map((color, index) => <button className="secondary" key={color + index} onClick={() => { setChosenColors(chosenColors.filter((_, i) => i !== index)); setHint(''); }} aria-label={'取消已选' + names[color]}><Gem color={color} small />{names[color]} ×</button>)}</div>
        <p>{canTake ? '确认后结束本次主行动。' : '请选择三种不同颜色，或再点一次同色；不足三种时选择全部有库存的颜色。'}</p>
        <button disabled={!canTake} onClick={() => onAction(takeAction)}>确认拿取</button>
        <button className="secondary" onClick={() => { setChosenColors([]); setHint(''); }}>取消选择</button>
      </>}
    </section>}
    {active && view.legalActions.some(action => action.type === 'pass') &&
      <button onClick={() => onAction({ type: 'pass' })}>无可用行动，跳过回合</button>}
    </div><aside className="sp-board-side" aria-label="商会与动态">
    <section className="sp-reserved" aria-label="我的预留卡">
      <h3>我的预留卡 <span>{mine.reservedCount} / 3 · 仅你可见</span></h3>
      {view.myReserved.length ? <div className="sp-card-row">{view.myReserved.map(card =>
        <DevelopmentCard key={card.id} card={card} selected={selectedId === card.id}
          affordable={view.legalActions.some(action => action.type === 'buy' && action.cardId === card.id)}
          disabled={busy} onSelect={() => chooseCard(card)} />)}</div> : <p>预留喜欢的卡，或盲抽一张，同时获得一枚黄金。</p>}
    </section>
    <section className="sp-players" aria-label="玩家商会">
      {[view.viewingSeatId, ...view.seats.filter(seat => seat !== view.viewingSeatId)].map(seat => {
        const player = view.players[seat]!;
        return <article key={seat} className={'sp-player' + (seat === view.currentSeatId ? ' sp-player--current' : '')}>
          <header><h3>{seatName(seat)}的商会</h3><strong>{player.score}<small> / 15 声望</small></strong></header>
          <p>{seat === view.currentSeatId && view.phase !== 'finished' ? '正在行动 · ' : ''}{player.purchased.length} 张发展卡 · {player.reservedCount} 张预留 · {player.nobles.length} 位贵族</p>
          <div className="sp-ledger">{tokenColors.map(color => <div key={color}><Gem color={color} small />
            <b>{player.tokens[color]}</b><small>代币</small>{color !== 'gold' && <><b>+{player.bonuses[color]}</b><small>折扣</small></>}</div>)}</div>
          <p>代币合计 {countTokens(player.tokens)} / 10{player.nobles.length > 0 ? ' · ' + player.nobles.map(noble => noble.name).join('、') : ''}</p>
          {player.purchased.length > 0 && <details><summary>查看已购发展卡</summary><ul>{player.purchased.map(card =>
            <li key={card.id}>{names[card.bonus]}折扣 +1 · {card.points} 声望 · <Cost values={card.cost} /></li>)}</ul></details>}
        </article>;
      })}
    </section>
    <Activity events={events} view={view} playerNames={playerNames} />
    </aside></div>
    {view.outcome.status === 'finished' && <section className="sp-result" aria-live="polite">
      <h3>最终结算</h3><p>{view.outcome.winners.map(seatName).join('、')}获胜{view.outcome.winners.length > 1 ? ' · 共享胜利' : ''}</p>
      <p>按声望排名，同分时购买发展卡更少者胜。</p>
      {view.seats.map(seat => <p key={seat}>{seatName(seat)}：{view.players[seat]!.score} 声望 · {view.players[seat]!.purchased.length} 张发展卡</p>)}
      {view.outcome.reason === 'stalemate' && <p>全员无可用行动，僵局结算。</p>}
    </section>}
  </section>;
}

export function SplendorAssetPreview({ assets }: { assets: AssetResolverPort }) {
  return <AssetContext.Provider value={assets}><section className="sp-table" aria-label="璀璨宝石图包预览">
    <h2>璀璨宝石 · 固定素材预览</h2><p>展示全部卡面与贵族，按钮仅演示。缺图时保留原创图形与规则文字。</p>
    <div className="sp-preview-tokens">{tokenColors.map(color => <span key={color}><Gem color={color} />{names[color]}</span>)}</div>
    {[1, 2, 3].map(tier => <section key={tier}><h3>{tier} 级发展卡</h3>
      <div className="sp-card-row">{previewCards.filter(card => card.tier === tier).map(card => <DevelopmentCard
        key={card.id} card={card} selected={false} affordable={false} disabled={false} onSelect={() => undefined} />)}</div>
      <div className="sp-preview-back"><Visual assetKey={'card.back.' + tier} className="sp-deck-face">{tier} 级牌背</Visual></div>
    </section>)}
    <section className="sp-nobles"><h3>全部贵族</h3><div>{previewNobles.map((noble, index) => <NobleTile
      key={noble.id} noble={noble} index={index} eligible={false} busy={false} onSelect={() => undefined} />)}</div></section>
  </section></AssetContext.Provider>;
}
