import { useEffect, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { navigate } from '../platform.js';

interface PageTransition {
  skipTransition(): void;
  finished: Promise<void>;
}

// Only enhance page links. Hashes, downloads and new tabs keep browser behavior.
export function followPageLink(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') ||
      (link.target && link.target !== '_self') || link.relList.contains('external')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.hash || url.search ||
      !/^(?:\/|\/chat|\/login|\/register|\/profile(?:\/(?:edit|history|identity|badges|coins))?|\/friends(?:\/(?:add|requests|invitations|chat\/[0-9a-f-]{36}))?|\/games\/[a-z0-9._-]+\/[a-z0-9._-]+(?:\/(?:new|tutorial))?|\/rooms\/new|\/rooms\/[0-9a-f-]+|\/matches\/[0-9a-f-]+(?:\/replay)?|\/official-ai|\/settings\/models|\/admin(?:\/(?:accounts(?:\/[0-9a-f-]{36}\/(?:badges|coins))?|catalog|submissions|assets|games|updates|official-ai))?|\/status|\/developers(?:\/[a-z-]+)?|\/dev\/(?:ui|lab))$/i.test(url.pathname)) return;
  event.preventDefault();
  if (url.pathname !== location.pathname) navigate(url.pathname);
}

export function usePageNavigation() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    let currentPath = location.pathname;
    let transition: PageTransition | undefined;
    const change = (event: PopStateEvent) => {
      const nextPath = location.pathname;
      if (nextPath === currentPath) return;
      currentPath = nextPath;
      transition?.skipTransition();
      // A transition captures asynchronously: prevent edits/submits on the departing page.
      const departingPage = document.getElementById('main-content');
      if (departingPage) {
        departingPage.inert = true;
        // Native form APIs also need a disabled boundary while the old DOM is present.
        departingPage.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
          'input, select, textarea, button',
        ).forEach(control => { control.disabled = true; });
      }
      const update = () => {
        if (currentPath !== nextPath) return;
        flushSync(() => setPath(nextPath));
        // Native history traversal retains browser scroll restoration.
        if (!event.isTrusted) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.getElementById('main-content')?.focus({ preventScroll: true });
      };
      const startTransition = (document as Document & {
        startViewTransition?: (update: () => void) => PageTransition;
      }).startViewTransition;
      if (startTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        transition = startTransition.call(document, update);
        void transition.finished.catch(() => undefined);
      } else {
        update();
      }
    };
    addEventListener('popstate', change);
    return () => {
      removeEventListener('popstate', change);
      transition?.skipTransition();
    };
  }, []);
  return path;
}
