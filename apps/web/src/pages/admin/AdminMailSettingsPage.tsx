import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { mailSettingsInputSchema, mailTestInputSchema } from '@boardgame/protocol';
import { PageFeedback } from '@boardgame/ui';
import { api } from '../../platform.js';
import { AdminLayout, adminError, useAdminRequestId } from './AdminLayout.js';

type Settings = Awaited<ReturnType<typeof api.adminMailSettings>>;
type SaveInput = Parameters<typeof api.saveAdminMailSettings>[0];
type TestInput = Parameters<typeof api.testAdminMailSettings>[0];
const editable = (data: Settings) => ({
  enabled: data.enabled,
  host: data.host,
  port: data.port,
  username: data.username,
  from: data.from,
});
const definitive = (cause: unknown) =>
  cause instanceof ApiError &&
  [
    'VALIDATION_ERROR',
    'STATE_CONFLICT',
    'REQUEST_ID_CONFLICT',
    'FORBIDDEN',
    'UNAUTHENTICATED',
    'RATE_LIMITED',
  ].includes(cause.code);

function MailSettings() {
  const [data, setData] = useState<Settings>();
  const [draft, setDraft] = useState({
    enabled: false,
    host: '',
    port: 465 as 465 | 587,
    username: '',
    from: '',
  });
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<'save' | 'test'>();
  const saveRequest = useRef<SaveInput | undefined>(undefined);
  const testRequest = useRef<TestInput | undefined>(undefined);
  const testCycle = useRef(0);
  const alive = useRef(false);
  const lock = useRef(false);
  const saveId = useAdminRequestId();
  const testId = useAdminRequestId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      saveRequest.current = undefined;
      testRequest.current = undefined;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api
      .adminMailSettings(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setDraft(editable(value));
        setPassword('');
        setClearPassword(false);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(adminError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data || lock.current) return;
    const decision = {
      ...draft,
      expectedRevision: data.revision,
      ...(password ? { password } : {}),
      clearPassword,
    };
    const parsed = mailSettingsInputSchema.safeParse(
      saveRequest.current ?? { ...decision, requestId: saveId(decision) },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查邮件设置');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    saveRequest.current = parsed.data;
    try {
      const saved = await api.saveAdminMailSettings(parsed.data);
      if (!alive.current) return;
      saveRequest.current = undefined;
      setPending(undefined);
      setData(saved);
      setDraft(editable(saved));
      setPassword('');
      setClearPassword(false);
      setNotice('邮件设置已保存，立即生效。');
    } catch (cause) {
      if (!alive.current) return;
      if (definitive(cause)) {
        saveRequest.current = undefined;
        setPending(undefined);
      } else setPending('save');
      setError(adminError(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function sendTest(event: FormEvent) {
    event.preventDefault();
    if (!data || lock.current) return;
    const decision = { email: recipient, expectedRevision: data.revision };
    const parsed = mailTestInputSchema.safeParse(
      testRequest.current ?? {
        ...decision,
        requestId: testId({ ...decision, cycle: testCycle.current }),
      },
    );
    if (!parsed.success) {
      setError('请输入有效的测试收件邮箱。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    testRequest.current = parsed.data;
    try {
      const result = await api.testAdminMailSettings(parsed.data);
      if (!alive.current) return;
      if (result.status === 'sending') {
        setPending('test');
        setNotice('发送结果待确认，请检查收件箱，也可再次确认原请求。');
      } else {
        testRequest.current = undefined;
        testCycle.current++;
        setPending(undefined);
        if (result.status === 'sent') setNotice('邮件服务已受理测试邮件，请检查收件箱或垃圾邮件。');
        else setError('测试邮件发送失败，请核对服务器、账号、授权码及服务商限制后重新测试。');
      }
    } catch (cause) {
      if (!alive.current) return;
      if (definitive(cause)) {
        testRequest.current = undefined;
        setPending(undefined);
      } else setPending('test');
      setError(adminError(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (!data)
    return (
      <PageFeedback
        title={error ? '邮件设置加载失败' : '正在读取邮件设置…'}
        loading={!error}
        {...(error ? { retry: () => setAttempt((value) => value + 1) } : {})}
      >
        {error}
      </PageFeedback>
    );
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(editable(data)) || !!password || clearPassword;
  const locked = busy || loading || !!pending;
  return (
    <div className="mail-settings-workspace">
      <section className="panel" aria-labelledby="mail-configuration-title">
        <div className="admin-section-heading">
          <div>
            <h2 id="mail-configuration-title">注册邮件</h2>
            <p className="muted">
              {data.configured
                ? '已配置，可以发送邮件'
                : data.enabled
                  ? '配置尚不完整，暂不可发信'
                  : '尚未启用注册邮件'}
              {data.source === 'environment'
                ? ' · 当前使用服务器环境配置'
                : data.source === 'database'
                  ? ' · 使用后台保存的配置'
                  : ''}
            </p>
          </div>
          <button
            className="secondary"
            disabled={locked}
            onClick={() => {
              setNotice('');
              setAttempt((value) => value + 1);
            }}
          >
            重新读取
          </button>
        </div>
        {!data.encryptionAvailable && (
          <p role="alert" className="error-notice">
            平台凭据加密未配置。请维护者一次性配置平台加密主密钥后，在此保存 SMTP 授权码。
          </p>
        )}
        <form className="form-stack" onSubmit={(event) => void save(event)} aria-busy={busy}>
          <fieldset className="mail-settings-fields" disabled={locked}>
            <label className="mail-settings-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              启用注册邮件
            </label>
            <p className="muted">关闭后新用户无法完成邮箱验证，已有账号仍可正常登录。</p>
            <div className="mail-settings-grid">
              <label>
                SMTP 服务器
                <input
                  autoComplete="off"
                  value={draft.host}
                  maxLength={253}
                  required={draft.enabled}
                  placeholder="smtp.example.com"
                  onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                />
              </label>
              <label>
                加密连接
                <select
                  value={draft.port}
                  onChange={(event) =>
                    setDraft({ ...draft, port: Number(event.target.value) as 465 | 587 })
                  }
                >
                  <option value={465}>TLS · 465</option>
                  <option value={587}>STARTTLS · 587</option>
                </select>
              </label>
              <label>
                SMTP 账号
                <input
                  autoComplete="off"
                  value={draft.username}
                  maxLength={254}
                  required={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </label>
              <label>
                发件邮箱
                <input
                  type="email"
                  autoComplete="off"
                  value={draft.from}
                  maxLength={254}
                  required={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                />
              </label>
            </div>
            <label>
              SMTP 授权码
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                maxLength={512}
                aria-describedby="mail-password-help"
                disabled={!data.encryptionAvailable || locked}
                placeholder={
                  data.hasPassword ? '已保存，留空保留' : '填写邮箱服务提供的 SMTP 授权码'
                }
                onChange={(event) => {
                  setPassword(event.target.value);
                  setClearPassword(false);
                }}
              />
            </label>
            <small className="muted" id="mail-password-help">
              {data.hasPassword ? '授权码已保存，不会回显。' : '尚未保存授权码。'}
              更换服务器、端口或账号时需重新填写。授权码在服务端加密保存。
            </small>
            {data.hasPassword && (
              <label className="mail-settings-toggle">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(event) => {
                    setClearPassword(event.target.checked);
                    setPassword('');
                  }}
                />
                清除已保存授权码（请同时关闭邮件）
              </label>
            )}
          </fieldset>
          <button
            disabled={busy || loading || pending === 'test' || (!dirty && pending !== 'save')}
          >
            {pending === 'save' ? '确认原保存请求' : busy ? '处理中…' : '保存邮件设置'}
          </button>
        </form>
      </section>
      <section className="panel" aria-labelledby="mail-test-title">
        <h2 id="mail-test-title">发送测试邮件</h2>
        <p className="muted">
          使用已保存的配置，每分钟最多测试一次。邮件服务受理后，请到收件箱确认实际投递。
        </p>
        {dirty && <p className="muted">有尚未保存的修改，请先保存后测试。</p>}
        <form className="form-stack" onSubmit={(event) => void sendTest(event)}>
          <label>
            测试收件邮箱
            <input
              type="email"
              autoComplete="email"
              value={recipient}
              maxLength={254}
              required
              disabled={locked}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || loading || pending === 'save' || dirty || !data.configured}
          >
            {pending === 'test' ? '确认原测试请求' : '发送测试邮件'}
          </button>
        </form>
      </section>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

export function AdminMailSettingsPage() {
  return (
    <AdminLayout
      path="/admin/mail"
      title="邮件设置"
      description="配置注册验证码的发信邮箱，并确认邮件是否可以送达。"
    >
      <MailSettings />
    </AdminLayout>
  );
}
