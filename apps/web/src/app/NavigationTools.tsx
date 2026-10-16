import { useEffect, useRef } from 'react';
import { ThemeSelect } from './ThemeSelect.js';

export function NavigationTools({ path, labEnabled, administrator }: {
  path: string;
  labEnabled: boolean;
  administrator: boolean;
}) {
  const container = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => { if (container.current) container.current.open = false; }, [path]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && container.current && !container.current.contains(event.target)) container.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && container.current?.open) {
        container.current.open = false;
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return <details className="nav-tools" ref={container} onBlur={event => {
    // Touch browsers may clear focus before dispatching the tapped link's click.
    // Outside pointer presses, Escape and navigation already dismiss the menu.
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary ref={trigger}><span aria-hidden="true">⋯</span> 更多</summary>
    <div aria-label="平台设置">
      <ThemeSelect />
      <a href="/official-ai" aria-current={path === '/official-ai' ? 'page' : undefined}>官方 AI 与点数</a>
      <a href="/settings/models" aria-current={path === '/settings/models' ? 'page' : undefined}>模型设置</a>
      {administrator && <a href="/admin" aria-current={path === '/admin' || path.startsWith('/admin/') ? 'page' : undefined}>管理员后台</a>}
      {labEnabled && <><a href="/dev/lab" aria-current={path === '/dev/lab' ? 'page' : undefined}>扩展实验台</a><a href="/dev/ui" aria-current={path === '/dev/ui' ? 'page' : undefined}>界面场景</a></>}
    </div>
  </details>;
}
