import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Badge } from '@boardgame/protocol';

// model-viewer also caches failed URLs. Move only failed loads to a fresh cache key.
const modelRetries = new Map<string, number>();

export function BadgePreview({
  badge,
  model,
  onClose,
}: {
  badge: Badge;
  model: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const host = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let failed = false;
    let viewer: HTMLElement | undefined;
    const generation = modelRetries.get(model) ?? 0;
    setStatus('loading');
    const fail = () => {
      if (!active || failed) return;
      failed = true;
      modelRetries.set(model, Math.max(generation + 1, modelRetries.get(model) ?? 0));
      clearTimeout(timeout);
      viewer?.remove();
      setStatus('error');
    };
    const loaded = () => {
      if (!active || failed) return;
      clearTimeout(timeout);
      setStatus('ready');
    };
    const timeout = window.setTimeout(fail, 30_000);
    // Keep WebGL and the model out of the initial page/list download.
    void import('@google/model-viewer')
      .then(() => {
        if (!active || failed) return;
        viewer = document.createElement('model-viewer');
        viewer.setAttribute('src', generation ? `${model}?retry=${generation}` : model);
        viewer.setAttribute('alt', `${badge.name}，可用方向键或拖动旋转`);
        viewer.setAttribute('camera-controls', '');
        viewer.setAttribute('touch-action', 'pan-y');
        viewer.setAttribute('interaction-prompt', 'none');
        viewer.setAttribute('loading', 'eager');
        viewer.setAttribute('environment-image', 'neutral');
        viewer.setAttribute('shadow-intensity', '1');
        viewer.addEventListener('load', loaded);
        viewer.addEventListener('error', fail);
        host.current?.append(viewer);
      })
      .catch(fail);
    return () => {
      active = false;
      clearTimeout(timeout);
      viewer?.removeEventListener('load', loaded);
      viewer?.removeEventListener('error', fail);
      viewer?.remove();
    };
  }, [model, badge.name, attempt]);

  return createPortal(
    <dialog
      className="badge-preview-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={(event) => {
        // StrictMode reopens the dialog after effect cleanup; ignore that queued close event.
        if (!event.currentTarget.open) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{badge.name}</h2>
        <button className="secondary" autoFocus onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="badge-model-stage" ref={host} aria-busy={status === 'loading'} />
      {status === 'loading' && <p role="status">正在加载立体徽章…</p>}
      {status === 'error' && (
        <div className="badge-feedback" role="alert">
          <p>暂时无法展示 3D 模型，普通徽章仍可使用。</p>
          <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
            重试加载
          </button>
        </div>
      )}
      {status === 'ready' && <p className="muted">拖动或使用方向键旋转，滚轮或双指缩放。</p>}
      <p>{badge.description}</p>
    </dialog>,
    document.body,
  );
}
