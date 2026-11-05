import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorNotice } from '@boardgame/ui';
import { ApiError } from '@boardgame/client-sdk';
import { api } from '../platform.js';
import { NewPasswordFields } from './AccountSecurityPage.js';
import '../styles/account-security.css';

export function PasswordRecoveryPage() {
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [show, setShow] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    if (!retryAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    if (challenge) form.current?.querySelector<HTMLInputElement>('[name=emailCode]')?.focus();
  }, [challenge]);
  async function perform(work: () => Promise<void>) {
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
            : '结果尚未确认，请检查连接。若已提交新密码，可返回登录页尝试登录。',
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function send() {
    if (!form.current) return;
    const inputs = form.current.querySelectorAll<HTMLInputElement>('[name=username],[name=email]');
    if (Array.from(inputs).some((input) => !input.reportValidity())) return;
    const data = new FormData(form.current);
    await perform(async () => {
      const result = await api.requestRecoveryCode({
        username: String(data.get('username')),
        email: String(data.get('email')),
      });
      if (!active.current) return;
      setChallenge(result.challengeId);
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      setNotice('如果用户 ID 和已验证邮箱匹配，将收到重置验证码。请检查收件箱和垃圾邮件。');
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const element = event.currentTarget;
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      setError('两次输入的新密码不一致。');
      return;
    }
    void perform(async () => {
      await api.recoverPassword({
        username: String(data.get('username')),
        email: String(data.get('email')),
        challengeId: challenge,
        emailCode: String(data.get('emailCode')),
        newPassword: String(data.get('newPassword')),
      });
      if (!active.current) return;
      element.reset();
      setDone(true);
      setNotice('密码已重置，全部旧登录已失效。请使用新密码登录。');
    });
  }
  return (
    <section className="auth-shell">
      <div className="panel auth-card security-settings">
        <h1>找回密码</h1>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {notice && (
          <p className="success-notice" role="status">
            <span aria-hidden="true">✓ </span>
            {notice}
          </p>
        )}
        {!done && (
          <>
            <p className="muted">
              输入登录用户 ID 和已绑定邮箱。未绑定邮箱或无法收信时，请联系平台维护者核验后重置。
            </p>
            <form ref={form} onSubmit={submit} className="form-stack">
              <fieldset disabled={busy} className="security-fields">
                <label>
                  用户 ID
                  <input
                    name="username"
                    autoComplete="username"
                    minLength={3}
                    maxLength={33}
                    required
                    onChange={() => setChallenge('')}
                  />
                </label>
                <label>
                  绑定邮箱
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
                  onClick={() => void send()}
                >
                  {seconds > 0 ? `${seconds} 秒后可重发` : '发送重置验证码'}
                </button>
                {challenge && (
                  <>
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
                    <p className="muted">新密码为 12–128 位，包含字母和数字。</p>
                    <NewPasswordFields show={show} />
                    <button
                      type="button"
                      className="secondary"
                      aria-pressed={show}
                      onClick={() => setShow((value) => !value)}
                    >
                      {show ? '隐藏密码' : '显示密码'}
                    </button>
                    <button type="submit">{busy ? '处理中…' : '重置密码'}</button>
                  </>
                )}
              </fieldset>
            </form>
          </>
        )}
        <a href="/login">返回登录</a>
      </div>
    </section>
  );
}
