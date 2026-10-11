import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { playerLabel, type PlayerNames } from '@boardgame/game-sdk/presentation';
import type { PresentationAudioPort } from '@boardgame/game-sdk/assets';
import {
  colors, names, symbols, floorPenalties, scoreEventSchema, wallColor, wallColumn,
  type AzulAction, type AzulView, type Color, type ScoreStep,
} from '../shared/index.js';
import './style.css';
import { comboPoints, comboTier, impactScore, scoreImpacts, scoreTiming, settlementFloors } from './scoring.js';
import { TileFlight } from './TileFlight.js';

function Tile({ color, ghost = false }: { color: Color; ghost?: boolean }) {
  return <span className={`az-tile az-${color}${ghost ? ' az-ghost' : ''}`} aria-hidden="true"><span>{symbols[color]}</span></span>;
}

function ComboNumber({ from, points }: { from: number; points: number }) {
  const delta = points - from;
  const rolling = delta >= 6;
  const [shown, setShown] = useState(rolling ? from + Math.ceil(delta / 3) : points);
  useLayoutEffect(() => {
    if (!rolling) return;
    const timers = [2, 3].map(part => window.setTimeout(() => {
      setShown(from + Math.ceil(delta * part / 3));
    }, (part - 1) * 30));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [from, delta, rolling]);
  return <>{shown >= 0 ? '+' : '−'}{Math.abs(shown)}</>;
}
type Beat = ScoreStep & {
  key: string;
  eventId: string;
  round: number;
  floor?: AzulView['players'][string]['floor'] | undefined;
};
export function AzulBoard({ view, busy, events = [], onAction, audio, playerNames }: {
  view: AzulView; busy: boolean; events?: unknown[]; onAction: (action: AzulAction) => void;
  audio?: PresentationAudioPort | undefined; playerNames?: PlayerNames | undefined;
}) {
  const [selection, setSelection] = useState<{ source: number; color: Color } | null>(null);
  const [row, setRow] = useState<number | null>(null);
  const [beat, setBeat] = useState<Beat | null>(null);
  const [pending, setPending] = useState<Beat[]>([]);
  const [impactProgress, setImpactProgress] = useState({ key: '', count: 0 });
  const [finishEvent, setFinishEvent] = useState<string | null>(null);
  const [resolvedRound, setResolvedRound] = useState(0);
  const expiredRound = useRef(0);
  const audioRef = useRef(audio);
  useLayoutEffect(() => { audioRef.current = audio; }, [audio]);
  const seen = useRef(new Set<string>());
  const roundViews = useRef(new Map<number, AzulView>());
  const mine = view.players[view.viewingSeatId]!;
  const myTurn = view.currentSeatId === view.viewingSeatId && view.phase === 'drafting';
  const canAct = myTurn && !busy;
  const selectedTiles = selection ? (selection.source === -1 ? view.center : view.factories[selection.source] ?? []).filter(c => c === selection.color).length : 0;
  const valid = selection && row !== null && view.legalActions.some(a => a.source === selection.source && a.color === selection.color && a.row === row);
  const legalRow = (r: number) => !!selection && view.legalActions.some(a => a.source === selection.source && a.color === selection.color && a.row === r);
  const order = [view.viewingSeatId, ...view.seats.filter(id => id !== view.viewingSeatId)];
  const seatName = (id: string) => playerLabel(id, view.seats, view.viewingSeatId, playerNames);

  useEffect(() => { setSelection(null); setRow(null); }, [view.round, view.currentSeatId, busy]);
  useLayoutEffect(() => {
    const fresh: Beat[] = [];
    let lastDraft: unknown;
    for (const raw of events) {
      if (raw && typeof raw === 'object' && 'eventId' in raw && typeof raw.eventId === 'string'
        && 'type' in raw && !seen.current.has(raw.eventId) && (raw.type === 'tiles.drafted' || raw.type === 'match.finished')) {
        seen.current.add(raw.eventId);
        if (raw.type === 'match.finished') setFinishEvent(raw.eventId);
        else {
          lastDraft = raw;
          audioRef.current?.(raw.eventId, 'tiles.drafted', 'draft');
        }
        continue;
      }
      const parsed = scoreEventSchema.safeParse(raw);
      if (!parsed.success || seen.current.has(parsed.data.eventId)) continue;
      seen.current.add(parsed.data.eventId);
      // Once recovery has shown the authoritative result, late events must not rewind it.
      if (parsed.data.round <= expiredRound.current) continue;
      setResolvedRound(old => Math.max(old, parsed.data.round));
      const before = roundViews.current.get(parsed.data.round);
      const floors = before ? settlementFloors(before, lastDraft) : {};
      parsed.data.steps.forEach((step, index) => fresh.push({
        ...step,
        key: `${parsed.data.eventId}:${index}`,
        eventId: parsed.data.eventId,
        round: parsed.data.round,
        floor: step.kind === 'floor' ? floors[step.seatId] : undefined,
      }));
    }
    if (seen.current.size > 100) seen.current = new Set([...seen.current].slice(-50));
    if (fresh.length) setPending(old => [...old, ...fresh].slice(-88));
  }, [events]);
  useLayoutEffect(() => {
    // HTTP may deliver the settled View before its live events. Preserve the old round.
    if (view.phase === 'drafting') roundViews.current.set(view.round, view);
    if (roundViews.current.size > 2) roundViews.current.delete(roundViews.current.keys().next().value!);
  }, [view]);
  const settlementRound = view.phase === 'finished' ? view.round : view.round - 1;
  const beforeSettlement = roundViews.current.get(settlementRound);
  const awaitingEvents = view.lastRound.length > 0 && settlementRound > resolvedRound && !!beforeSettlement;
  useEffect(() => {
    if (!awaitingEvents) return;
    // A lost live delivery still converges to the snapshot; never invent audio or replay it.
    const timer = window.setTimeout(() => {
      expiredRound.current = Math.max(expiredRound.current, settlementRound);
      setResolvedRound(old => Math.max(old, settlementRound));
    }, scoreTiming.eventWait);
    return () => window.clearTimeout(timer);
  }, [awaitingEvents, settlementRound]);
  useLayoutEffect(() => {
    if (beat || !pending.length) return;
    setBeat(pending[0]!);
    setPending(old => old.slice(1));
  }, [pending, beat]);
  useLayoutEffect(() => {
    if (!beat) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = scoreImpacts(beat).length;
    if (beat.kind === 'tile') audioRef.current?.(beat.eventId, 'tiles.drafted', `${beat.key}:move`);
    setImpactProgress({ key: beat.key, count: reduced ? count : 0 });
    if (reduced) audioRef.current?.(beat.eventId, beat.kind === 'floor' ? 'tiles.drafted' : 'round.scored', `${beat.key}:score`);
    const timers = reduced ? [] : Array.from({ length: count }, (_, index) => window.setTimeout(() => {
      setImpactProgress({ key: beat.key, count: index + 1 });
      audioRef.current?.(beat.eventId, beat.kind === 'floor' ? 'tiles.drafted' : 'round.scored', `${beat.key}:score:${index}`);
    }, scoreTiming.landing + index * scoreTiming.impact));
    timers.push(window.setTimeout(() => setBeat(null), reduced ? scoreTiming.reduced
      : scoreTiming.landing + count * scoreTiming.impact + scoreTiming.hold));
    return () => { timers.forEach(timer => window.clearTimeout(timer)); };
  }, [beat]);
  useEffect(() => {
    if (!finishEvent || beat || pending.length) return;
    audioRef.current?.(finishEvent, 'match.finished', 'victory');
    setFinishEvent(null);
  }, [finishEvent, beat, pending]);
  const impacts = beat ? scoreImpacts(beat) : [];
  const revealed = beat && impactProgress.key === beat.key ? impactProgress.count : 0;
  const hit = impacts[revealed - 1];
  const heldBeats: Beat[] = awaitingEvents ? view.lastRound.map((step, index) => ({
    ...step, key: `waiting:${settlementRound}:${index}`, eventId: '', round: settlementRound,
    floor: step.kind === 'floor' ? beforeSettlement?.players[step.seatId]?.floor : undefined,
  })) : [];
  const allBeats = [...(beat ? [beat, ...pending] : pending), ...heldBeats];
  const displayScore = (id: string) => beat?.seatId === id ? impactScore(beat, impacts, revealed)
    : allBeats.find(step => step.seatId === id)?.from ?? view.players[id]!.score;
  const combo = comboPoints(impacts, revealed);
  const tier = comboTier(combo);
  const floatingScore = `${combo >= 0 ? '+' : '−'}${Math.abs(combo)}`;
  function pick(source: number, color: Color) {
    if (!canAct) return;
    setSelection(old => old?.source === source && old.color === color ? null : { source, color });
    setRow(null);
  }
  function offer(tiles: Color[], source: number) {
    return colors.filter(color => tiles.includes(color)).map(color => {
      const count = tiles.filter(tile => tile === color).length;
      const selected = selection?.source === source && selection.color === color;
      return <button type="button" key={color} className={`az-offer${selected ? ' az-selected' : ''}`}
        aria-label={`${source < 0 ? '中央' : `工厂 ${source + 1}`} ${names[color]} ${count}块`}
        aria-pressed={selected} disabled={!canAct} onClick={() => pick(source, color)}>
        <Tile color={color} /><b>×{count}</b>
      </button>;
    });
  }
  return <section className="az-table" aria-label="花砖物语游戏桌" onKeyDown={event => {
    if (event.key === 'Escape') { setSelection(null); setRow(null); }
  }}>
    <header className="az-heading"><div><small>AZUL · 彩墙工坊</small><h2>花砖物语</h2></div><div className="az-round">第 <b>{view.round}</b> 轮<span>{view.bagCount} 块待抽</span></div></header>
    <div className="az-turn" role="status">{view.phase === 'finished' ? allBeats.length ? '最后一轮 · 正在结算' : '工坊完工' : myTurn ? '轮到你 · 选一组花砖，再选图案行' : `等待${seatName(view.currentSeatId)}选砖`}
      {allBeats.length > 0 && <span>{view.phase === 'finished' ? '铺墙与终局奖励' : '铺墙结算中 · 可继续查看与选砖'}</span>}</div>
    <section className="az-supply" aria-label="花砖供应区">
      <div className="az-factories">{view.factories.map((tiles, index) => <div className={`az-factory${!tiles.length ? ' az-empty' : ''}`} key={index}>
        <span className="az-factory-number">{index + 1}</span><div>{offer(tiles, index)}</div>{!tiles.length && <small>已取空</small>}
      </div>)}</div>
      <div className="az-center"><div><strong>中央</strong><small>{view.firstAvailable ? '首次拿取附带先手标记' : `下轮${seatName(view.nextStarter!)}先手`}</small></div>
        <div className="az-center-tiles">{view.firstAvailable && <span className="az-first" title="先手标记占一格地板">1</span>}{offer(view.center, -1)}{!view.center.length && <span className="az-muted">暂无花砖</span>}</div>
      </div>
    </section>
    <div className="az-players">{order.map(id => {
      const player = view.players[id]!, own = id === view.viewingSeatId;
      const active = beat?.seatId === id ? beat : null;
      const flying = active?.kind === 'tile' && (impactProgress.key !== active.key || revealed === 0);
      const hidden = allBeats.filter(step => step.seatId === id && step.kind === 'tile' && step.key !== active?.key);
      const floor = allBeats.find(step => step.seatId === id && step.kind === 'floor')?.floor ?? player.floor;
      return <section key={id} className={`az-player${own ? ' az-own' : ''}${active ? ' az-scoring' : ''}${active && revealed > 0 ? ` az-combo-${tier}` : ''}`} aria-label={`${seatName(id)}的花砖板`}>
        <header><div><strong>{own && !playerNames?.[id] ? '你的工坊' : seatName(id)}</strong>{view.currentSeatId === id && view.phase !== 'finished' && <small>正在选砖</small>}</div>
          <div className="az-score" aria-label={`${seatName(id)}得分`}><b key={active ? `${active.key}:${revealed}` : 'steady'} className={active && revealed > 0 ? 'az-score-pop' : ''}>{displayScore(id)}</b><span>分</span></div></header>
        <div className="az-mosaic"><div className="az-patterns"><small>图案行</small>{player.lines.map((line, r) => {
          const waiting = allBeats.find(step => step.seatId === id && step.kind === 'tile' && step.row === r
            && (step.key !== active?.key || flying));
          const shown = waiting ? { count: r + 1, color: waiting.color } : line;
          const canPlace = own && legalRow(r) && canAct && !waiting;
          const previewCount = own && row === r && selection ? Math.min(selectedTiles, r + 1 - line.count) : 0;
          return <button type="button" key={r} className={`az-pattern${own && row === r ? ' az-selected' : ''}`} aria-label={`${seatName(id)}图案行 ${r + 1} ${shown.count}/${r + 1}`}
            disabled={!canPlace} aria-pressed={own && row === r} onClick={() => setRow(r)}>
            <span className="az-line-number">{r + 1}</span><span className="az-line-slots">{Array.from({ length: r + 1 }, (_, index) => {
              const inFlight = flying && active.row === r && index === r;
              const filled = index >= r + 1 - shown.count && !inFlight;
              const preview = !filled && index >= r + 1 - line.count - previewCount;
              const discarded = active?.kind === 'tile' && active.row === r && !flying && !waiting && index < r;
              return <span className={`az-slot${preview ? ' az-preview' : ''}`} key={index}>
                {discarded && active.color && <span className="az-discard" aria-hidden="true"><Tile color={active.color} /></span>}
                {filled && shown.color ? <Tile color={shown.color} /> : preview && selection ? <Tile color={selection.color} ghost /> : null}
              </span>;
            })}</span><span className="az-arrow">›</span>
          </button>;
        })}</div>
        <div className="az-wall-area"><small>马赛克墙</small><div className="az-wall">{player.wall.flatMap((wallRow, r) => wallRow.map((filled, c) => {
          const color = wallColor(r, c);
          const scoring = active?.kind === 'tile' && active.row === r && active.col === c;
          const linked = active && hit?.cells.some(cell => cell.row === r && cell.col === c);
          const future = hidden.some(step => step.row === r && step.col === c);
          const preview = own && row === r && selection && wallColumn(r, selection.color) === c;
          const visible = filled && !future && !(scoring && flying);
          return <div key={`${r}:${c}:${scoring ? active.key : ''}`} className={`az-wall-cell${linked ? ' az-linked' : ''}${scoring && !flying ? ' az-landing' : ''}${preview ? ' az-destination' : ''}`}
            style={{ '--link-delay': `${(hit?.cells.findIndex(cell => cell.row === r && cell.col === c) ?? 0) * 20}ms` } as CSSProperties}
            aria-label={`${names[color]} 第${r + 1}行第${c + 1}列 ${visible ? '已铺' : '空位'}`}>
            <Tile color={color} ghost={!visible} />
            {linked && <span className="az-link-flash" key={`${active.key}:${revealed}:glow`} />}
            {scoring && !flying && <span className="az-score-burst" key={`${active.key}:${revealed}`}><i>✦</i><i>✧</i><i>◆</i><i>✦</i></span>}
          </div>;
        }))}</div>
          {active && revealed > 0 && <span key={`${active.key}:${revealed}`} className={`az-score-float az-combo-${tier}${active.kind === 'floor' ? ' az-penalty' : ''}`}
            aria-hidden="true" style={{ '--float-life': `${revealed === impacts.length ? scoreTiming.impact + scoreTiming.hold : scoreTiming.impact}ms` } as CSSProperties}>
            <ComboNumber from={comboPoints(impacts, revealed - 1)} points={combo} />
          </span>}
        </div></div>
        {flying && active.color && <TileFlight key={active.key} row={active.row} col={active.col} color={active.color} />}
        <div className="az-floor"><span>地板</span>{floorPenalties.map((penalty, index) => <span className="az-floor-slot" key={index}>
          {floor[index] === 'first' ? <span className="az-first">1</span> : floor[index] ? <Tile color={floor[index] as Color} /> : null}<small>−{penalty}</small>
        </span>)}{own && <button type="button" disabled={!canAct || !legalRow(-1)} aria-pressed={row === -1} onClick={() => setRow(-1)}>全部放地板</button>}</div>
        <span className="az-score-announcement" aria-live="polite">{active && revealed > 0
          ? `${hit?.label} ${floatingScore}，当前 ${displayScore(id)} 分${active.kind === 'floor' ? `，实际扣除 ${active.from - active.total} 分` : ''}` : ''}</span>
      </section>;
    })}</div>
    {view.phase === 'drafting' && <section className="az-confirm" aria-label="确认选砖">
      <div>{selection ? <><strong>{names[selection.color]} ×{selectedTiles}</strong><span>{row === null ? '选择高亮图案行' : row < 0 ? '全部进入地板' : `放入第 ${row + 1} 行 · 溢出 ${Math.max(0, selectedTiles - (row + 1 - mine.lines[row]!.count))} 块`}</span>
        {selection.source === -1 && view.firstAvailable && <small>同时领取先手标记 · 占一格地板</small>}</> : <span>{myTurn ? '点击工厂或中央的一组花砖' : '观察对手的图案行，计划下一次选砖'}</span>}</div>
      <button type="button" className="az-cancel" disabled={!selection || busy} onClick={() => { setSelection(null); setRow(null); }}>取消选择</button>
      <button type="button" className="az-submit" disabled={!valid || !canAct} onClick={() => {
        if (selection && row !== null && valid) onAction({ type: 'draft', ...selection, row });
      }}>{busy ? '正在放砖…' : '确认选砖'}</button>
    </section>}
    {view.outcome.status === 'finished' && !allBeats.length && <section className="az-finale" aria-label="花砖物语结算">
      <small>最后一砖 · 工坊完工</small><h3>{view.outcome.winners.map(seatName).join('、')}获胜</h3>
      <div>{view.seats.map(id => <span key={id}>{seatName(id)} <b>{view.players[id]!.score}</b> 分</span>)}</div>
    </section>}
    {view.lastRound.length > 0 && <details className="az-breakdown"><summary>最近一轮得分明细</summary>{order.map(id => <div key={id}><strong>{seatName(id)}</strong>{view.lastRound.filter(step => step.seatId === id).map((step, index) => <span key={index}>{step.label} {step.points > 0 ? '+' : ''}{step.points} → {step.total}分</span>)}</div>)}</details>}
    <p className="az-legend">横行 +2 · 竖列 +7 · 同色五砖 +10 · 任意完整横行触发终局</p>
  </section>;
}
