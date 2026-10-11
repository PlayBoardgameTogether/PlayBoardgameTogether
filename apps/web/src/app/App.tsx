import { useGameOverlayInset } from './useGameOverlayInset.js';
import { Suspense, useEffect, type MouseEvent } from 'react';
import { PageFeedback } from '@boardgame/ui';
import { followPageLink, usePageNavigation } from './navigation.js';
import { PageBoundary } from './PageBoundary.js';
import { resolvePage } from './routes.js';
import { SocialProvider, useSocialContext } from '../social/SocialProvider.js';
import { SocialNotifications } from '../social/SocialNotifications.js';
import { ChatDock } from '../social/ChatDock.js';
import { NavigationTools } from './NavigationTools.js';

export function App() {
  const path = usePageNavigation();
  return <SocialProvider enabled={path !== '/login' && path !== '/register'}><AppShell path={path} /></SocialProvider>;
}

function AppShell({ path }: { path: string }) {
  const social = useSocialContext();
  function followLink(event: MouseEvent<HTMLElement>) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      link instanceof HTMLAnchorElement && link.origin === location.origin && !link.search && !link.hash &&
      !link.hasAttribute('download') && (!link.target || link.target === '_self') && matchMedia('(min-width: 761px)').matches) {
      const chat = /^\/friends\/chat\/([0-9a-f-]{36})$/i.exec(link.pathname);
      if (chat && social.data?.friends.some(item => item.person.id === chat[1])) {
        event.preventDefault(); social.openChat(chat[1]!); return;
      }
    }
    followPageLink(event);
  }
  const labEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LAB === 'true';
  const route = resolvePage(path);
  const header = useGameOverlayInset(!!route.game);
  useEffect(() => {
    document.title = route.documentTitle ?? `${route.title} · 桌游平台`;
  }, [route.title, route.documentTitle]);
  return <div className={`desktop-shell ${route.game ? 'desktop-shell--game' : ''}`} onClick={followLink}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="site-header" ref={header}>
      <div className="window-marks" aria-hidden="true"><i /><i /><i /></div>
      <a className="brand" href="/"><svg className="brand-symbol" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="4" width="24" height="24" rx="6" /><path d="M11 11h3v3h-3zm7 7h3v3h-3zM18 11h3v3h-3zm-7 7h3v3h-3z" /></svg><span className="brand-name">桌游平台<span>一起坐下来，玩一局</span></span></a>
      <nav aria-label="主导航">
        <span className="nav-caption">游戏空间</span>
        <a href="/" aria-current={path === '/' ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7" /></svg>游戏大厅</a>
        <a href="/profile" aria-current={path === '/profile' || path.startsWith('/profile/') ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>我的资料</a>
        <a href="/friends" aria-current={(path === '/friends' || path.startsWith('/friends/')) ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5" /></svg>好友</a>
        <a className="mobile-chat-link" href="/chat" aria-current={path === '/chat' ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" /></svg>公共聊天</a>
        <NavigationTools path={path} labEnabled={labEnabled} />
      </nav>
      <div className="sidebar-note"><span>和朋友，共享一张桌</span><small>私人房间 · 实时对局</small></div>
    </header>
    <div className="workspace">
      <div className="workspace-toolbar"><span>桌游平台 <span aria-hidden="true">/</span> <strong>{route.title}</strong></span><SocialNotifications /></div>
      <main key={path} id="main-content" tabIndex={-1} aria-label={route.title}>
        <PageBoundary>
          <Suspense fallback={<PageFeedback title={`正在加载${route.title}…`} loading />}>
            {route.page}
          </Suspense>
        </PageBoundary>
      </main>
      <footer>桌游平台 v{__APP_VERSION__} · 和朋友继续这场对局</footer>
    </div>
    <ChatDock />
    <nav className="shell-help" aria-label="辅助导航"><a href="/developers" aria-current={route.developer ? 'page' : undefined}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18" /></svg>开发者文档</a></nav>
  </div>;
}
