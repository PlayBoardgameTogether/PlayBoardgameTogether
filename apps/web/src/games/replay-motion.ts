import type { ReplayPresentation } from '@boardgame/game-sdk/presentation';

/** Observe the existing desktop; never infer game rules or manufacture animations. */
export function observeReplayMotion(root: HTMLElement, replay: ReplayPresentation) {
  const started = performance.now();
  let changedAt = started;
  let stopped = false;
  const disableControls = () => {
    for (const control of root.querySelectorAll<HTMLButtonElement>(
      'button,input,select,textarea',
    )) {
      if (!control.disabled) control.disabled = true;
    }
  };
  disableControls();
  const observer = new MutationObserver(() => {
    changedAt = performance.now();
    disableControls();
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const budget = 60000 - (now - started);
    if (budget <= 0) return;
    let remaining = Math.max(0, 500 - (now - changedAt));
    for (const animation of root.getAnimations({ subtree: true })) {
      if (animation.playState !== 'running' || animation.playbackRate <= 0) continue;
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) {
        remaining = Math.max(
          remaining,
          (end - Number(animation.currentTime ?? 0)) / animation.playbackRate + 80,
        );
      }
    }
    if (replay.animate && remaining > 0) replay.hold(Math.min(budget, remaining));
    timer = window.setTimeout(tick, 100);
  };
  let timer = window.setTimeout(tick, 0);
  return () => {
    stopped = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}
