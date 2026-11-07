import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { PageFeedback } from '@boardgame/ui';
import { gamePresentationInputSchema, publicImageUrlSchema } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';
import { loadGames, type AvailableGame } from './game-catalog.js';
import { defaultGameArt } from './catalog-art.js';
import { GameArtwork } from './GameArtwork.js';
import { AdminLayout } from './admin/AdminLayout.js';

const fields = [
  { key: 'iconUrl', label: '游戏图标地址', hint: '方形游戏头像，用于大厅主图与详情标题图标；保留完整构图。' },
  { key: 'coverUrl', label: '大厅封面地址', hint: '未设置头像时使用的兼容封面；不会替代详情背景。' },
  { key: 'backgroundUrl', label: '详情背景地址', hint: '建议使用宽幅横图，图片会在标题旁或上方独立展示。' },
] as const;
type ImageDraft = { iconUrl: string; coverUrl: string; backgroundUrl: string };
const emptyDraft: ImageDraft = { iconUrl: '', coverUrl: '', backgroundUrl: '' };

export function GamePresentationAdminPage() {
  return (
    <AdminLayout
      path="/admin/games"
      title="游戏展示"
      description="设置游戏图标、大厅封面与详情背景。"
    >
      <GamePresentationEditor />
    </AdminLayout>
  );
}

function GamePresentationEditor() {
  const [games, setGames] = useState<AvailableGame[]>();
  const [choice, setChoice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<ImageDraft>(emptyDraft);
  const active = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    let disposed = false;
    active.current = true; setLoadError('');
    void loadGames().then(items => {
        if (disposed) return;
        const selected = items.find(item => `${item.id}@${item.version}` === choice) ?? items[0];
        setGames(items);
        setChoice(selected ? `${selected.id}@${selected.version}` : '');
        setDraft({
          iconUrl: selected?.presentation?.iconUrl ?? '',
          coverUrl: selected?.presentation?.coverUrl ?? '',
          backgroundUrl: selected?.presentation?.backgroundUrl ?? '',
        });
        setError('');
        setNotice('');
    }).catch(cause => {
      if (disposed) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
      else setLoadError('无法加载游戏展示配置，请重试。');
    });
    return () => { disposed = true; active.current = false; };
  }, [attempt]);
  const game = games?.find(item => `${item.id}@${item.version}` === choice);
  useEffect(() => {
    setDraft({
      iconUrl: game?.presentation?.iconUrl ?? '',
      coverUrl: game?.presentation?.coverUrl ?? '',
      backgroundUrl: game?.presentation?.backgroundUrl ?? '',
    });
    setError(''); setNotice('');
  }, [choice]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || lock.current) return;
    const result = gamePresentationInputSchema.safeParse({
      expectedRevision: game.presentation?.revision ?? 0,
      iconUrl: draft.iconUrl.trim() || null,
      coverUrl: draft.coverUrl.trim() || null,
      backgroundUrl: draft.backgroundUrl.trim() || null,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? '请检查图片地址。'); return; }
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api.saveGamePresentation(game.id, game.version, result.data);
      if (!active.current) return;
      setGames(items => items?.map(item => item.id === game.id && item.version === game.version ? { ...item, presentation: saved } : item));
      setNotice('展示图片已保存，大厅与游戏页面刷新后生效。');
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (loadError) return <PageFeedback title="展示配置不可用" retry={() => setAttempt(value => value + 1)}>{loadError}</PageFeedback>;
  if (!games) return <PageFeedback title="正在加载展示配置…" loading />;
  const defaults = defaultGameArt(game?.id ?? '', game?.version ?? '');
  return <>
    <div className="presentation-editor">
      <form className="panel form-stack" onSubmit={save}>
        <label>配置游戏<select disabled={busy} value={choice} onChange={event => setChoice(event.target.value)}>
          {games.map(item => <option key={`${item.id}@${item.version}`} value={`${item.id}@${item.version}`}>{item.name} · {item.version}</option>)}
        </select></label>
        <p className="muted">使用公开 HTTPS 图片地址，或 /game-art/ 下的图片路径。留空使用内置图片，图片地址不包含查询参数、凭据或片段。</p>
        {fields.map(field => <label key={field.key}>{field.label}
          <input disabled={busy} value={draft[field.key]} maxLength={2048} placeholder={defaults[field.key] ?? 'https://…'} onChange={event => setDraft(previous => ({ ...previous, [field.key]: event.target.value }))} />
          <small className="muted">{field.hint}</small>
        </label>)}
        {error && <p role="alert" className="error-notice">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="presentation-editor-actions"><button disabled={busy || !game}>{busy ? '保存中…' : '保存展示图片'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(emptyDraft); setNotice('已选择内置图片，保存后生效。'); }}>使用内置图片</button>
        </div>
        {error && <button type="button" className="secondary" disabled={busy} onClick={() => setAttempt(value => value + 1)}>重新加载配置</button>}
      </form>
      <section className="presentation-previews" aria-label="展示预览"><h2>图片预览</h2>
        {fields.map(field => {
          const candidate = draft[field.key].trim();
          const src = candidate ? (publicImageUrlSchema.safeParse(candidate).success ? candidate : null) : defaults[field.key];
          return <figure key={field.key}><GameArtwork src={src} name={game?.name ?? '游戏'} className={field.key === 'iconUrl' ? 'presentation-icon-preview' : 'game-cover'} /><figcaption>{field.label.replace('地址', '')}</figcaption></figure>;
        })}
      </section>
    </div>
  </>;
}
