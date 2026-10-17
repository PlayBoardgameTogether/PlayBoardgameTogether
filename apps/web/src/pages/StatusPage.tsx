import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button, Panel, StatusBadge } from '@boardgame/ui';
import { pingWebSocket } from '@boardgame/client-sdk';

type Check = { state: 'idle' | 'ok' | 'error' | 'warn'; label: string; detail: string };

const serviceIcons: Record<string, string> = {
  API: '⚡',
  数据库: '🗄️',
  实时连接: '🛰️',
};

export function StatusPage() {
  const [api, setApi] = useState<Check>({
    state: 'idle',
    label: '未检查',
    detail: 'HTTP 进程状态',
  });
  const [db, setDb] = useState<Check>({ state: 'idle', label: '未检查', detail: '数据库与注册表' });
  const [ws, setWs] = useState<Check>({ state: 'idle', label: '未检查', detail: '实时 ping/pong' });
  const [time, setTime] = useState('—');
  const [checking, setChecking] = useState(false);

  const run = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => run.current?.abort(), []);

  async function check() {
    if (run.current) return;
    const controller = new AbortController();
    run.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    const current = () => !controller.signal.aborted;
    setChecking(true);
    setApi({ state: 'idle', label: '检查中', detail: 'HTTP 进程状态' });
    setDb({ state: 'idle', label: '检查中', detail: '数据库与注册表' });
    setWs({ state: 'idle', label: '检查中', detail: '实时 ping/pong' });
    const started = performance.now();
    const healthSchema = z.object({
      data: z
        .object({
          database: z
            .object({
              reason: z.string().nullable().optional(),
            })
            .optional(),
        })
        .optional(),
    });
    try {
      await Promise.all([
        (async () => {
          try {
            const response = await fetch('/health/live', { signal, cache: 'no-store' });
            if (current())
              setApi({
                state: response.ok ? 'ok' : 'error',
                label: response.ok ? '可用' : '失败',
                detail: `${Math.round(performance.now() - started)} ms`,
              });
          } catch {
            if (current())
              setApi({
                state: 'error',
                label: '不可用',
                detail: signal.aborted ? '检查超时，请重试' : '无法连接 API',
              });
          }
        })(),
        (async () => {
          try {
            const response = await fetch('/health/ready', { signal, cache: 'no-store' });
            const body: unknown = await response.json();
            const parsed = healthSchema.parse(body);
            if (current())
              setDb({
                state: response.ok ? 'ok' : 'warn',
                label: response.ok ? '就绪' : '未就绪',
                detail:
                  parsed.data?.database?.reason ??
                  (response.ok ? '迁移与扩展同步正常' : '服务尚未就绪，请稍后重试'),
              });
          } catch {
            if (current())
              setDb({
                state: 'error',
                label: '不可用',
                detail: signal.aborted ? '检查超时，请重试' : '无法读取就绪状态',
              });
          }
        })(),
        (async () => {
          try {
            const ms = await pingWebSocket(signal);
            if (current()) setWs({ state: 'ok', label: '可用', detail: `${ms} ms` });
          } catch {
            if (current())
              setWs({ state: 'error', label: '不可用', detail: '实时连接检查失败，请重试' });
          }
        })(),
      ]);
      if (current()) setTime(new Date().toLocaleTimeString());
    } finally {
      if (run.current === controller) run.current = undefined;
      if (current()) setChecking(false);
    }
  }

  const items: Array<[string, Check]> = [
    ['API', api],
    ['数据库', db],
    ['实时连接', ws],
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">运行诊断</p>
          <h1>系统状态</h1>
          <p>分别检查服务、数据与实时连接，帮助排查无法进入或同步游戏的问题。</p>
        </div>
        <Button onClick={check} disabled={checking}>
          {checking ? '正在检查…' : '立即检查'}
        </Button>
      </div>

      <div className="cards status-cards" aria-live="polite" aria-busy={checking}>
        {items.map(([name, item]) => (
          <Panel key={name} className={`status-service-card status-service--${item.state}`}>
            <div className="status-service-header">
              <span className="status-service-icon" aria-hidden="true">
                {serviceIcons[name] ?? '📊'}
              </span>
              <h2>{name}</h2>
            </div>
            <StatusBadge state={item.state}>{item.label}</StatusBadge>
            <p>{item.detail}</p>
          </Panel>
        ))}
      </div>

      <p className="muted">最近检查：{time}</p>
    </>
  );
}
