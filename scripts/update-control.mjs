/** Only the owned API child may request an update; never expose a supervisor HTTP endpoint. */
export function updateStatusForClient(status, version) {
  if (version === 2) return status;
  // Older APIs validate strictly; keep new optional metadata out of their replies.
  const legacy = { ...status };
  for (const key of ['currentVersion', 'candidateVersion', 'stage', 'stageStartedAt', 'checkIntervalMs']) {
    delete legacy[key];
  }
  return legacy;
}

export function createUpdateControl({
  enabled,
  branch,
  currentSha,
  currentVersion = null,
  checkIntervalMs = 300000,
  run,
}) {
  let status = {
    enabled, branch, currentSha, candidateSha: null, lastCheckedAt: null,
    phase: enabled ? 'idle' : 'disabled',
    currentVersion, candidateVersion: null, stage: null, stageStartedAt: null, checkIntervalMs,
  };
  let running = false;
  const receipts = new Set();
  const snapshot = () => ({ ...status });
  const patch = value => {
    if ('stage' in value && value.stage !== status.stage) {
      status.stageStartedAt = value.stage ? new Date().toISOString() : null;
    }
    status = { ...status, ...value };
  };
  function check(requestId) {
    if (!enabled || receipts.has(requestId)) return snapshot();
    receipts.add(requestId);
    if (receipts.size > 256) receipts.delete(receipts.values().next().value);
    if (running) return snapshot();
    running = true;
    patch({ phase: 'checking', stage: 'fetch', failure: null, lastCheckedAt: new Date().toISOString() });
    // Acknowledge before building/draining, so the triggering HTTP request can finish.
    void Promise.resolve().then(run).catch(() => patch({ phase: 'failed' }))
      .finally(() => { running = false; });
    return snapshot();
  }
  return { snapshot, patch, check };
}
