// History may be supplied by browser extensions or older pages. Only known,
// non-secret creation routes can continue through login and registration.
export function roomCreationContinuation(state: unknown): { roomCreationPath: string } | undefined {
  if (!state || typeof state !== 'object' || !('roomCreationPath' in state)) return;
  const path = state.roomCreationPath;
  if (typeof path !== 'string' || path.length > 256) return;
  if (
    path !== '/rooms/new' &&
    !/^\/games\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\/new$/i.test(path)
  )
    return;
  return { roomCreationPath: path };
}
