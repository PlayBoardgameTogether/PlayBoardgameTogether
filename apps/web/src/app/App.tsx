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
import { PixelHomeIcon, PixelFriendsIcon, PixelChatIcon, PixelProfileIcon, PixelDocsIcon } from '../ui/PixelIcons.js';

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
  const isPixel = !route.game;
  useEffect(() => {
    document.title = route.documentTitle ?? `${route.title} · 桌游平台`;
  }, [route.title, route.documentTitle]);
  return <div
    className={`desktop-shell ${isPixel ? 'desktop-shell--pixel' : ''} ${path === '/' ? 'desktop-shell--pixel-lobby' : ''} ${route.game ? 'desktop-shell--game' : ''} ${path === '/admin' || path.startsWith('/admin/') ? 'desktop-shell--admin' : ''}`}
    onClick={followLink}
  >
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="site-header" ref={header}>
      <div className="window-marks" aria-hidden="true"><i /><i /><i /></div>
      <a className="brand" href="/">
        {isPixel ? (
          <img
            className="brand-symbol pixel-symbol"
            src="/platform-art/pixel-dice.png"
            alt=""
            width="32"
            height="32"
          />
        ) : (
          <svg className="brand-symbol" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="24" height="24" rx="6" />
            <path d="M11 11h3v3h-3zm7 7h3v3h-3zM18 11h3v3h-3zm-7 7h3v3h-3z" />
          </svg>
        )}
        <span className="brand-name">
          {isPixel ? (
            <img className="pixel-wordmark" src="/platform-art/pixel-wordmark.svg" alt="PlayBoard" width="132" height="18" />
          ) : 'PlayBoard'}
          <span>顶尖桌游联盟</span>
        </span>
      </a>
      <nav className="platform-navigation" aria-label="主导航">
        <span className="nav-caption">游戏空间</span>
        <a href="/" aria-label="游戏大厅" aria-current={path === '/' ? 'page' : undefined}>
          <PixelHomeIcon />
          <span className="nav-desktop-label">游戏大厅</span>
          <span className="nav-mobile-label">首页</span>
        </a>
        <a href="/friends" aria-current={(path === '/friends' || path.startsWith('/friends/')) ? 'page' : undefined}>
          <PixelFriendsIcon />
          好友
        </a>
        <a className="mobile-chat-link" href="/chat" aria-label="公共聊天" aria-current={path === '/chat' ? 'page' : undefined}>
          <PixelChatIcon />
          聊天
        </a>
        <a href="/profile" aria-label="我的资料" aria-current={path === '/profile' || path.startsWith('/profile/') ? 'page' : undefined}>
          <PixelProfileIcon />
          <span className="nav-desktop-label">我的资料</span>
          <span className="nav-mobile-label">我的</span>
        </a>
        <NavigationTools path={path} labEnabled={labEnabled} administrator={social.account?.role === 'administrator' && social.account.status === 'active'} />
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
      <footer>PlayBoard v{__APP_VERSION__} · 顶尖桌游联盟</footer>
    </div>
    <ChatDock />
    <nav className="shell-help" aria-label="辅助导航">
      <a href="/developers" aria-current={route.developer ? 'page' : undefined}>
        <PixelDocsIcon />
        开发者文档
      </a>
    </nav>
  </div>;
}
