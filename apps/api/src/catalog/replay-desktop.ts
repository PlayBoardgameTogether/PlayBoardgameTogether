// This bootstrap runs only inside the original opaque sandbox. It has no host APIs.
const replayBootstrap = String.raw`<script data-platform-replay>
(() => {
  let step = null, timer, observer, changedAt = 0, started = 0;
  const block = event => {
    if (event.type === 'click' || event.type === 'submit' || event.type === 'keydown') event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['click','submit','pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','input','change','dragstart','drop']) {
    document.addEventListener(type, block, true);
  }
  document.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) block(event);
  }, true);
  const disable = () => {
    for (const el of document.querySelectorAll('button,input,select,textarea')) if (!el.disabled) el.disabled = true;
  };
  const stop = () => { clearTimeout(timer); observer?.disconnect(); };
  const tick = () => {
    const now = performance.now(), budget = 60000 - (now - started);
    if (budget <= 0) { stop(); return; }
    let remaining = Math.max(0, 500 - (now - changedAt));
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running' || animation.playbackRate <= 0) continue;
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) {
        remaining = Math.max(remaining, (end - Number(animation.currentTime ?? 0)) / animation.playbackRate + 80);
      }
    }
    if (step?.animate && remaining > 0) parent.postMessage({
      type: 'boardgame:replay-animation', id: step.id, durationMs: Math.min(budget, remaining)
    }, '*');
    timer = setTimeout(tick, 100);
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'boardgame:view' || !event.data.replay) return;
    stop();
    // Explicit seeks cancel visual effects without executing game rules.
    if (!event.data.replay.animate) document.getAnimations().forEach(animation => animation.cancel());
    step = event.data.replay;
    started = changedAt = performance.now();
    observer = new MutationObserver(() => { changedAt = performance.now(); disable(); });
    observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,characterData:true});
    disable();
    timer = setTimeout(tick, 0);
  });
  addEventListener('pagehide', stop, {once:true});
})();
</script>`;

/** Wrap the response, preserving the installed package bytes and rule digest. */
export function replayDesktop(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const position = head.index + head[0].length;
    return html.slice(0, position) + replayBootstrap + html.slice(position);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const position = doctype?.[0].length ?? 0;
  return html.slice(0, position) + replayBootstrap + html.slice(position);
}
