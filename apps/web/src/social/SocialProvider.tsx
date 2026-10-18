import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { AccountPublic, SocialOverview } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';
import { startAdaptivePolling, type AdaptivePolling } from '../network/polling.js';

interface SocialState {
  account: AccountPublic | undefined;
  data: SocialOverview | undefined;
  error: string;
  guest: boolean;
  refresh: () => Promise<void>;
  chatId: string | undefined;
  minimized: boolean;
  chatTab: 'public' | 'friends';
  setChatTab: (value: 'public' | 'friends') => void;
  openChat: (id: string) => void;
  closeChat: () => void;
  setMinimized: (value: boolean) => void;
  clearSession: () => void;
}
const SocialContext = createContext<SocialState | undefined>(undefined);

export function SocialProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [account, setAccount] = useState<AccountPublic>();
  const [data, setData] = useState<SocialOverview>();
  const [error, setError] = useState('');
  const [guest, setGuest] = useState(false);
  const [chatId, setChatId] = useState<string>();
  const [minimized, setMinimized] = useState(true);
  const [chatTab, setChatTab] = useState<'public' | 'friends'>('public');
  const active = useRef(false);
  const authenticated = useRef(false);
  const signedOut = useRef(false);
  const sequence = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const overviewVersion = useRef<string | undefined>(undefined);
  const polling = useRef<AdaptivePolling | undefined>(undefined);
  const clearSession = useCallback(() => {
    sequence.current++;
    request.current?.abort();
    request.current = undefined;
    authenticated.current = false;
    overviewVersion.current = undefined;
    signedOut.current = true;
    setAccount(undefined);
    setData(undefined);
    setChatId(undefined);
    setMinimized(true);
    setChatTab('public');
    setError('');
    setGuest(true);
  }, []);
  const load = useCallback(async () => {
    if (!active.current || request.current || signedOut.current) return;
    const version = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!authenticated.current) {
        const session = await api.me(controller.signal);
        if (!active.current || sequence.current !== version) return;
        setAccount(session.account);
      }
      if (!active.current || sequence.current !== version) return;
      const update = await api.socialUpdates(overviewVersion.current, controller.signal);
      if (!active.current || sequence.current !== version) return;
      authenticated.current = true;
      setGuest(false);
      setError('');
      overviewVersion.current = update.version;
      if (update.changed) {
        const next = update.overview;
        setData(next);
        setChatId((current) =>
          next.friends.some((item) => item.person.id === current) ? current : undefined,
        );
      }
      return update.changed;
    } catch (cause) {
      if (!active.current || sequence.current !== version || controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') clearSession();
      else {
        setError('消息与邀请同步失败，请重试。');
        return true;
      }
    } finally {
      if (request.current === controller) request.current = undefined;
    }
  }, [clearSession]);
  const refresh = useCallback(async () => {
    await polling.current?.refresh();
  }, []);
  useEffect(() => {
    active.current = enabled;
    signedOut.current = false;
    if (!enabled) clearSession();
    const scheduler = enabled ? startAdaptivePolling(load) : undefined;
    polling.current = scheduler;
    return () => {
      active.current = false;
      sequence.current++;
      request.current?.abort();
      request.current = undefined;
      scheduler?.stop();
      if (polling.current === scheduler) polling.current = undefined;
    };
  }, [enabled, load, clearSession]);
  const openChat = (id: string) => {
    if (!matchMedia('(min-width: 761px)').matches) {
      navigate(`/friends/chat/${id}`);
      return;
    }
    if (!data?.friends.some((item) => item.person.id === id)) return;
    setChatId(id);
    setChatTab('friends');
    setMinimized(false);
  };
  return (
    <SocialContext.Provider
      value={{
        account: enabled ? account : undefined,
        data,
        error,
        guest,
        refresh,
        chatId,
        minimized,
        openChat,
        closeChat: () => setChatId(undefined),
        setMinimized,
        chatTab,
        setChatTab,
        clearSession,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocialContext() {
  const context = useContext(SocialContext);
  if (!context) throw new Error('SocialProvider is required');
  return context;
}
