/** Only the owned API child may request an update; never expose a supervisor HTTP endpoint. */
export function createUpdateControl({ enabled, branch, currentSha, run }) {
  let status = {
    enabled, branch, currentSha, candidateSha: null, lastCheckedAt: null,
    phase: enabled ? 'idle' : 'disabled',
  };
  let running = false;
  const receipts = new Set();
  const snapshot = () => ({ ...status });
  const patch = value => { status = { ...status, ...value }; };
  function check(requestId) {
    if (!enabled || receipts.has(requestId)) return snapshot();
    receipts.add(requestId);
    if (receipts.size > 256) receipts.delete(receipts.values().next().value);
    if (running) return snapshot();
    running = true;
    patch({ phase: 'checking', failure: null, lastCheckedAt: new Date().toISOString() });
    // Acknowledge before building/draining, so the triggering HTTP request can finish.
    void Promise.resolve().then(run).catch(() => patch({ phase: 'failed' }))
      .finally(() => { running = false; });
    return snapshot();
  }
  return { snapshot, patch, check };
}
