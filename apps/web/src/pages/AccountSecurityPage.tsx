import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { AccountSecurity } from '@boardgame/protocol';
import { ErrorNotice, PageFeedback } from '@boardgame/ui';
import { api, navigate } from '../platform.js';
import { useSocialContext } from '../social/SocialProvider.js';
import { AdminLayout } from './admin/AdminLayout.js';
import '../styles/account-security.css';

export function AccountSecurityPage({ administrator = false }: { administrator?: boolean }) {
  return administrator ? (
    <AdminLayout
      path="/admin/security"
      title="我的账户安全"
      description="管理当前管理员的邮箱、密码和登录会话。"
    >
      <SecuritySettings />
    </AdminLayout>
  ) : (
    <div className="security-page">
      <a href="/profile">← 返回我的资料</a>
      <h1>账户安全</h1>
      <SecuritySettings />
    </div>
  );
}

function SecuritySettings() {
  const social = useSocialContext();
  const [status, setStatus] = useState<AccountSecurity>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [show, setShow] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const emailForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let disposed = false;
    active.current = true;
    void api
      .me()
      .then(() => api.accountSecurity())
      .then((value) => {
        if (!disposed) {
          setStatus(value);
          setError('');
        }
      })
      .catch((cause) => {
        if (disposed) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
        else setError('账户安全信息加载失败，请重试。');
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [attempt]);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    if (!retryAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    if (challenge) emailForm.current?.querySelector<HTMLInputElement>('[name=emailCode]')?.focus();
  }, [challenge]);

  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof ApiError
            ? cause.message
            : '结果尚未确认，请检查连接。若已提交改密或换绑，可返回登录页确认；不要反复发送验证码。',
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  function complete(message: string) {
    if (!active.current) return;
    social.clearSession();
    setChallenge('');
    setFinished(true);
    setNotice(message);
  }
  async function sendCode() {
    const form = emailForm.current;
    if (!form) return;
    // The verification code becomes required only after a successful send.
    const data = new FormData(form);
    const email = String(data.get('email'));
    const currentPassword = String(data.get('currentPassword'));
    const fields = form.querySelectorAll<HTMLInputElement>('[name=email],[name=currentPassword]');
    if (Array.from(fields).some((field) => !field.reportValidity())) return;
    await run(async () => {
      const result = await api.requestBindingCode({ email, currentPassword });
      if (active.current) {
        setChallenge(result.challengeId);
        setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
        setNotice('验证码已发送，请查看新邮箱。10 分钟内有效。');
      }
    });
  }
  function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    void run(async () => {
      await api.bindEmail({
        email: String(data.get('email')),
        currentPassword: String(data.get('currentPassword')),
        emailCode: String(data.get('emailCode')),
        challengeId: challenge,
      });
      form.reset();
      complete('邮箱已更新，全部登录已退出。请重新登录。');
    });
  }
  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      setError('两次输入的新密码不一致。');
      return;
    }
    const form = event.currentTarget;
    void run(async () => {
      await api.changePassword({
        currentPassword: String(data.get('currentPassword')),
        newPassword: String(data.get('newPassword')),
      });
      form.reset();
      complete('密码已修改，全部登录已退出。请使用新密码登录。');
    });
  }
  function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    void run(async () => {
      const result = await api.revokeOtherSessions({
        currentPassword: String(data.get('currentPassword')),
      });
      if (!active.current) return;
      form.reset();
      const current = await api.accountSecurity();
      if (!active.current) return;
      setStatus(current);
      setNotice(`已退出其他 ${result.revoked} 个登录会话，当前登录保留。`);
    });
  }
  if (!status)
    return (
      <PageFeedback
        title={error ? '无法读取账户安全信息' : '正在读取账户安全信息…'}
        loading={!error}
        {...(error ? { retry: () => setAttempt((value) => value + 1) } : {})}
      >
        {error}
      </PageFeedback>
    );
  return (
    <div className="security-settings">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {notice && (
        <p className="success-notice" role="status">
          <span aria-hidden="true">✓ </span>
          {notice}
        </p>
      )}
      {finished ? (
        <a className="button-link" href="/login">
          重新登录
        </a>
      ) : (
        <>
          <button
            className="secondary"
            type="button"
            aria-pressed={show}
            onClick={() => setShow((value) => !value)}
          >
            {show ? '隐藏密码' : '显示密码'}
          </button>
          <section className="panel security-section">
            <h2>绑定邮箱</h2>
            <p className="security-email">{status.email ?? '尚未绑定邮箱'}</p>
            <p className="muted">用于找回密码。换绑需验证当前密码和新邮箱，成功后退出全部登录。</p>
            <form ref={emailForm} className="form-stack" onSubmit={bind}>
              <fieldset disabled={busy} className="security-fields">
                <label>
                  当前密码
                  <input
                    name="currentPassword"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  {status.email ? '新邮箱' : '邮箱'}
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    onChange={() => setChallenge('')}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={seconds > 0}
                  onClick={() => void sendCode()}
                >
                  {seconds > 0 ? `${seconds} 秒后可重发` : '发送邮箱验证码'}
                </button>
                {challenge && (
                  <label>
                    邮箱验证码
                    <input
                      name="emailCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                    />
                  </label>
                )}
                <button type="submit" disabled={!challenge}>
                  {busy ? '处理中…' : status.email ? '确认换绑邮箱' : '确认绑定邮箱'}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="panel security-section">
            <h2>修改密码</h2>
            <p className="muted">新密码为 12–128 位，包含字母和数字。成功后所有设备需重新登录。</p>
            <form className="form-stack" onSubmit={password}>
              <fieldset disabled={busy} className="security-fields">
                <label>
                  当前密码
                  <input
                    name="currentPassword"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </label>
                <NewPasswordFields show={show} />
                <button type="submit">{busy ? '处理中…' : '修改密码并退出登录'}</button>
              </fieldset>
            </form>
          </section>
          <section className="panel security-section">
            <h2>登录会话</h2>
            <p>当前有效会话：{status.activeSessions} 个</p>
            <p className="muted">可退出其他浏览器或设备的登录，当前登录保留。</p>
            <form className="form-stack" onSubmit={revoke}>
              <fieldset disabled={busy} className="security-fields">
                <label>
                  当前密码
                  <input
                    name="currentPassword"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </label>
                <button className="secondary" type="submit">
                  退出其他设备
                </button>
              </fieldset>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

export function NewPasswordFields({ show = false }: { show?: boolean }) {
  return (
    <>
      <label>
        新密码
        <input
          name="newPassword"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          pattern="(?=.*[A-Za-z])(?=.*[0-9]).*"
          required
        />
      </label>
      <label>
        确认新密码
        <input
          name="confirmPassword"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </label>
    </>
  );
}
