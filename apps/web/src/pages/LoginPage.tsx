import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { api, navigate } from '../platform.js';

export function LoginPage() {
  const [registeredUserId] = useState(() => {
    const state: unknown = history.state;
    return state && typeof state === 'object' && 'registeredUserId' in state && typeof state.registeredUserId === 'string'
      ? state.registeredUserId : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api.login(String(data.get('username')), String(data.get('password')));
      if (mounted.current) navigate('/');
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof ApiError && cause.code === 'AUTH_INVALID_CREDENTIALS'
        ? '用户名或密码不正确，或账户已停用。'
        : cause instanceof ApiError && cause.code === 'RATE_LIMITED'
          ? '登录尝试过于频繁，请稍后再试。'
          : '暂时无法登录，请检查连接后重试。');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="auth-shell">
    <div className="panel auth-card">
      <p className="eyebrow">账户登录</p>
      <h1>回到游戏桌</h1>
      <p className="muted">输入你的用户 ID 或账号登录。</p>
      {registeredUserId && <p className="success-notice" role="status">注册成功，请输入密码登录。</p>}
      <form className="form-stack" onSubmit={submit} aria-busy={busy} aria-describedby={error ? 'login-error' : undefined}>
        <fieldset className="login-fields" disabled={busy}>
          <label>用户 ID<input name="username" aria-label="用户名" placeholder="@username" defaultValue={registeredUserId ? `@${registeredUserId}` : ''} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={33} required /></label>
          <label>密码<input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" minLength={6} maxLength={128} required /></label>
          <button type="button" className="secondary password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
            {showPassword ? '隐藏密码' : '显示密码'}
          </button>
        </fieldset>
        {error && <p id="login-error" className="error-notice" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
      <a className="auth-back" href="/register">还没有账号？立即注册</a>
      <br />
      <a className="auth-back" href="/">暂不登录，回大厅逛逛</a>
    </div>
  </section>;
}
