import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { AdminUpdateStatus } from '@boardgame/protocol';
import { api } from '../../platform.js';
import { adminError } from './AdminLayout.js';

export const updateWorking = new Set<AdminUpdateStatus['phase']>([
  'checking',
  'building',
  'waiting',
  'applying',
]);

export function useAdminUpdates() {
  const [status, setStatus] = useState<AdminUpdateStatus>();
  const [readError, setReadError] = useState('');
  const [commandError, setCommandError] = useState('');
  const [sending, setSending] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const command = useRef<AbortController | null>(null);
  const retryId = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      command.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const version = generation.current;
      try {
        const value = await api.adminUpdateStatus(controller.signal);
        if (!controller.signal.aborted && version === generation.current && !command.current) {
          setStatus(value);
          setReadError('');
          setDisconnected(false);
          // A status read cannot confirm whether an unanswered command was accepted.
          // Keep its request ID and message until the same command is acknowledged.
        }
      } catch (cause) {
        if (!controller.signal.aborted && version === generation.current && !command.current) {
          const denied =
            cause instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code);
          if (denied) setStatus(undefined);
          setDisconnected(!denied);
          setReadError(adminError(cause));
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void load();
          }, 3000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  async function check() {
    if (command.current) return;
    const controller = new AbortController();
    command.current = controller;
    generation.current++;
    setSending(true);
    setCommandError('');
    retryId.current ??= crypto.randomUUID();
    try {
      const value = await api.checkAdminUpdate(retryId.current, controller.signal);
      if (mounted.current) {
        setStatus(value);
        setReadError('');
        setDisconnected(false);
        retryId.current = null;
      }
    } catch (cause) {
      if (mounted.current) setCommandError(adminError(cause));
    } finally {
      command.current = null;
      if (mounted.current) setSending(false);
    }
  }
  return {
    status,
    readError,
    commandError,
    sending,
    disconnected,
    check,
    reload: () => setAttempt((value) => value + 1),
  };
}
