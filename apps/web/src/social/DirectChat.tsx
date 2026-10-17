import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { SocialMessage, SocialPerson } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';
import { ChatText, ExpressionPicker } from './ChatExpressions.js';
import { PersonAvatar } from './PersonAvatar.js';

type ChatMessage = SocialMessage & { sender?: SocialPerson };

export function DirectChat({
  person,
  refresh,
  visible = true,
  compact = false,
  publicChat = false,
  onPerson,
}: {
  person?: SocialPerson;
  refresh: () => Promise<void>;
  visible?: boolean;
  compact?: boolean;
  publicChat?: boolean;
  onPerson?: (person: SocialPerson) => void;
}) {
  const peerId = person?.id ?? '';
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const olderAnchor = useRef<
    | { height: number; top: number; element: Element | undefined; offset: number | undefined }
    | undefined
  >(undefined);
  const focusAfterSend = useRef(false);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<{ requestId: string; text: string } | undefined>(undefined);
  const mounted = useRef(false);
  const sending = useRef(false);
  const loadedOlder = useRef(false);
  const sequence = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const lastRead = useRef('');
  const latest = useRef<SocialMessage | undefined>(undefined);
  const readLock = useRef(false);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const input = useRef<HTMLTextAreaElement>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const historyList = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    if (compact && visible) input.current?.focus();
  }, [compact, visible]);
  useEffect(() => {
    const list = historyList.current;
    if (visible && list && followLatest.current) list.scrollTop = list.scrollHeight;
  }, [messages, visible]);
  useLayoutEffect(() => {
    const list = historyList.current;
    const anchor = olderAnchor.current;
    if (list && anchor) {
      list.scrollTop =
        anchor.element?.isConnected && anchor.offset !== undefined
          ? list.scrollTop +
            anchor.element.getBoundingClientRect().top -
            list.getBoundingClientRect().top -
            anchor.offset
          : anchor.top + list.scrollHeight - anchor.height;
      olderAnchor.current = undefined;
    }
  }, [messages]);
  useEffect(() => {
    if (!busy && focusAfterSend.current && visible) {
      focusAfterSend.current = false;
      input.current?.focus({ preventScroll: true });
    }
  }, [busy, visible]);
  function jumpToLatest() {
    followLatest.current = true;
    setFollowing(true);
    setHasNew(false);
    const list = historyList.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
      list.focus({ preventScroll: true });
    }
  }
  function merge(items: ChatMessage[], advance = true) {
    if (
      advance &&
      !followLatest.current &&
      items.some(
        (item) => !latest.current || BigInt(item.sequence) > BigInt(latest.current.sequence),
      )
    )
      setHasNew(true);
    if (advance)
      for (const item of items)
        if (!latest.current || BigInt(item.sequence) > BigInt(latest.current.sequence))
          latest.current = item;
    setMessages((previous) => {
      const known = new Map(previous.map((item) => [item.id, item]));
      for (const item of items) known.set(item.id, item);
      return [...known.values()].sort((a, b) =>
        BigInt(a.sequence) < BigInt(b.sequence)
          ? -1
          : BigInt(a.sequence) > BigInt(b.sequence)
            ? 1
            : 0,
      );
    });
  }
  async function load(before?: string) {
    if (request.current || !visibleNow.current) return;
    const version = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    if (before) {
      setMoreBusy(true);
      followLatest.current = false;
    }
    try {
      const after = !before ? latest.current?.id : undefined;
      const page = publicChat
        ? await api.publicMessages(before, controller.signal, after)
        : await api.directMessages(peerId, before, controller.signal, after);
      if (!mounted.current || sequence.current !== version) return;
      if (before && historyList.current) {
        const list = historyList.current;
        const top = list.getBoundingClientRect().top;
        const element = [...list.children].find(
          (item) => item.getBoundingClientRect().bottom > top,
        );
        olderAnchor.current = {
          height: list.scrollHeight,
          top: list.scrollTop,
          element,
          offset: element ? element.getBoundingClientRect().top - top : undefined,
        };
      }
      merge(page.items, !before);
      if (before) loadedOlder.current = true;
      if (before || (!after && !loadedOlder.current)) setCursor(page.nextCursor);
      // Fetch every missing segment after an offline period. The server returns
      // ascending batches after our watermark, never just the newest 30.
      let nextAfter = after ? page.nextCursor : null;
      while (nextAfter && mounted.current && !controller.signal.aborted) {
        const catchup = publicChat
          ? await api.publicMessages(undefined, controller.signal, nextAfter)
          : await api.directMessages(peerId, undefined, controller.signal, nextAfter);
        if (!mounted.current || sequence.current !== version) return;
        merge(catchup.items);
        nextAfter = catchup.nextCursor;
      }
      setLoadError('');
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
      else if (cause instanceof ApiError && cause.code === 'FORBIDDEN') {
        setMessages([]);
        void refresh();
      }
      setLoadError(cause instanceof ApiError ? cause.message : '聊天同步失败，请检查网络或重试。');
    } finally {
      if (request.current === controller) request.current = undefined;
      if (mounted.current) {
        setMoreBusy(false);
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      if (visible && document.visibilityState === 'visible') void load();
    };
    sync();
    const timer = window.setInterval(sync, 5000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      mounted.current = false;
      sequence.current++;
      request.current?.abort();
      request.current = undefined;
      clearInterval(timer);
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [peerId, publicChat, visible]);
  useEffect(() => {
    const last = messages.at(-1);
    if (
      publicChat ||
      !visible ||
      !following ||
      !last ||
      last.id !== latest.current?.id ||
      last.id === lastRead.current ||
      readLock.current ||
      document.visibilityState !== 'visible'
    )
      return;
    readLock.current = true;
    void api
      .readDirectMessages(peerId, { requestId: crypto.randomUUID(), messageId: last.id })
      .then(() => {
        lastRead.current = last.id;
        if (mounted.current) void refresh();
      })
      .catch(() => undefined)
      .finally(() => {
        readLock.current = false;
      });
  }, [messages, peerId, publicChat, refresh, visible, following]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || (!text.trim() && !pending.current)) return;
    sending.current = true;
    setBusy(true);
    setError('');
    pending.current ??= { requestId: crypto.randomUUID(), text: text.trim() };
    try {
      const message = publicChat
        ? await api.sendPublicMessage(pending.current)
        : await api.sendDirectMessage(peerId, pending.current);
      pending.current = undefined;
      if (mounted.current) {
        setRetry(false);
        setText('');
        followLatest.current = true;
        setFollowing(true);
        setHasNew(false);
        focusAfterSend.current = true;
        merge([message], false);
        void load();
      }
    } catch (cause) {
      if (cause instanceof ApiError && !cause.retryable) pending.current = undefined;
      if (mounted.current) {
        setRetry(!!pending.current);
        setError(cause instanceof ApiError ? cause.message : '发送结果未知，请点击重试发送。');
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className={`panel direct-chat ${publicChat ? 'public-chat' : ''}`}
      aria-label={publicChat ? '公共聊天' : `与 ${person?.displayName} 的私聊`}
    >
      {!compact && <h1>{publicChat ? '公共聊天' : `与 ${person?.displayName} 私聊`}</h1>}
      <p className="muted">
        {publicChat ? '所有登录玩家可见 · 点击头像认识桌友' : '仅你们双方可见'}
      </p>
      {loadError && (
        <p role="alert" className="error-notice">
          {loadError}
          <button className="secondary" onClick={() => void load()}>
            重新同步
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
      {loading && <p role="status">正在加载聊天记录…</p>}
      {cursor && (
        <button className="secondary" disabled={moreBusy} onClick={() => void load(cursor)}>
          加载更早消息
        </button>
      )}
      <ol
        ref={historyList}
        className="chat-history"
        tabIndex={0}
        aria-label="聊天记录"
        onScroll={(event) => {
          const list = event.currentTarget;
          const nearLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          followLatest.current = nearLatest;
          setFollowing(nearLatest);
          if (nearLatest) setHasNew(false);
        }}
      >
        {messages.map((message) => (
          <li
            className={!publicChat && message.senderId !== peerId ? 'chat-message--mine' : ''}
            key={message.id}
          >
            {publicChat && message.sender && (
              <button
                className="secondary public-chat-person"
                type="button"
                onClick={() => onPerson?.(message.sender!)}
                aria-label={`查看 ${message.sender.displayName} 的名片`}
              >
                <PersonAvatar person={message.sender} />
                <strong>{message.sender.displayName}</strong>
              </button>
            )}
            <small>
              {!publicChat && `${message.senderId === peerId ? person?.displayName : '我'} · `}
              {new Date(message.createdAt).toLocaleString('zh-CN')}
            </small>
            <p>
              <ChatText text={message.text} />
            </p>
          </li>
        ))}
      </ol>
      {!following && messages.length > 0 && (
        <button type="button" className="secondary chat-jump-latest" onClick={jumpToLatest}>
          {hasNew ? '有新消息，回到最新' : '回到最新消息'}
        </button>
      )}
      {!loading && !loadError && messages.length === 0 && (
        <p className="muted">还没有消息，打个招呼吧。</p>
      )}
      <form className="form-stack" onSubmit={send}>
        <label htmlFor={inputId}>{publicChat ? '公共消息' : '私聊消息'}</label>
        <textarea
          id={inputId}
          ref={input}
          required
          maxLength={2000}
          rows={3}
          placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
          value={text}
          readOnly={retry}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            if (error && !retry) setError('');
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (!busy && (text.trim() || pending.current)) {
                void send(event);
              }
            }
          }}
        />
        <div className="chat-compose-actions">
          <ExpressionPicker
            disabled={busy || retry}
            insert={(value) => {
              const element = input.current;
              const start = element?.selectionStart ?? text.length;
              const end = element?.selectionEnd ?? start;
              if (text.length - (end - start) + value.length > 2000) return;
              setText(text.slice(0, start) + value + text.slice(end));
              if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
              focusFrame.current = requestAnimationFrame(() => {
                if (element?.isConnected && visibleNow.current) {
                  element.focus();
                  element.setSelectionRange(start + value.length, start + value.length);
                }
              });
            }}
          />
          <button disabled={busy || !text.trim()}>
            {busy ? '发送中…' : retry ? '重试发送' : '发送消息'}
          </button>
        </div>
      </form>
    </section>
  );
}
