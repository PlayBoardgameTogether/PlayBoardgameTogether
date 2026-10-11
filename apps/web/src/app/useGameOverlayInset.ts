import { useLayoutEffect, useRef } from 'react';

// Games may position fixed overlays without assuming the platform navigation's height.
export function useGameOverlayInset(enabled: boolean) {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    const shell = element?.parentElement;
    if (!enabled || !element || !shell) return;
    const measure = () =>
      shell.style.setProperty(
        '--platform-top-inset',
        `${Math.ceil(element.getBoundingClientRect().height) + 12}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      shell.style.removeProperty('--platform-top-inset');
    };
  }, [enabled]);
  return header;
}
