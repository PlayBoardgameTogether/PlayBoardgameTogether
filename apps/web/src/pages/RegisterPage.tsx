import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { registrationInputSchema } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';

type RegistrationField = 'displayName' | 'userId' | 'password' | 'confirmPassword';

export function RegisterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorField, setErrorField] = useState<RegistrationField>();
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy && error && errorField) {
      const field = form.current?.elements.namedItem(errorField);
      if (field instanceof HTMLElement) field.focus();
    }
  }, [busy, error, errorField]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const input = {
      displayName: String(data.get('displayName') ?? ''),
      userId: String(data.get('userId') ?? ''),
      password: String(data.get('password') ?? ''),
    };
    const parsed = registrationInputSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setErrorField(field === 'displayName' || field === 'userId' ? field : 'password');
      setError(
        field === 'displayName'
          ? '用户名须为 1–32 字，不能全为空格。'
          : field === 'userId'
            ? '用户 ID 须为 3–32 位字母、数字或下划线，开头可加 @。'
            : '密码须为 6–128 位，至少包含一个字母和一个数字。',
      );
      return;
    }
    if (input.password !== String(data.get('confirmPassword') ?? '')) {
      setErrorField('confirmPassword');
      setError('两次输入的密码不一致。');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setErrorField(undefined);
    try {
      const result = await api.register(parsed.data);
      if (mounted.current) navigate('/login', { registeredUserId: result.username });
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.code === 'STATE_CONFLICT') setErrorField('userId');
      setError(
        cause instanceof ApiError && cause.code === 'STATE_CONFLICT'
          ? '这个用户 ID 已被使用，请换一个。'
          : cause instanceof ApiError && cause.code === 'RATE_LIMITED'
            ? '注册尝试过于频繁，请一分钟后重试。'
            : cause instanceof ApiError && cause.code === 'VALIDATION_ERROR'
              ? '注册信息不符合要求，请检查后重试。'
              : '暂时无法注册，请检查连接后重试。',
      );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="panel auth-card">
        <p className="eyebrow">账号注册</p>
        <h1>加入游戏桌</h1>
        <p className="muted">注册新账号，开启桌游之旅。</p>
        <form
          ref={form}
          className="form-stack"
          onSubmit={submit}
          onChange={() => {
            if (error) {
              setError('');
              setErrorField(undefined);
            }
          }}
          aria-busy={busy}
          aria-describedby={error ? 'register-error' : undefined}
        >
          <fieldset className="login-fields" disabled={busy}>
            <div className="auth-field">
              <label>
                玩家昵称
                <input
                  name="displayName"
                  aria-invalid={errorField === 'displayName' || undefined}
                  autoComplete="nickname"
                  minLength={1}
                  maxLength={32}
                  required
                  aria-describedby={`register-name-help${errorField === 'displayName' ? ' register-error' : ''}`}
                />
              </label>
              <p className="muted" id="register-name-help">
                你的桌游昵称，后续可随时修改。
              </p>
            </div>
            <div className="auth-field">
              <label>
                用户 ID
                <input
                  name="userId"
                  aria-invalid={errorField === 'userId' || undefined}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="@username"
                  minLength={3}
                  maxLength={33}
                  required
                  aria-describedby={`register-id-help${errorField === 'userId' ? ' register-error' : ''}`}
                />
              </label>
              <p className="muted" id="register-id-help">
                3–32 位字母、数字或下划线，用于登录与好友搜索。
              </p>
            </div>
            <div className="auth-field">
              <label>
                密码
                <input
                  name="password"
                  aria-invalid={errorField === 'password' || undefined}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={128}
                  required
                  aria-describedby={`register-password-help${errorField === 'password' ? ' register-error' : ''}`}
                />
              </label>
              <p className="muted" id="register-password-help">
                至少 6 位，需包含字母和数字。
              </p>
            </div>
            <div className="auth-field">
              <label>
                确认密码
                <input
                  name="confirmPassword"
                  aria-invalid={errorField === 'confirmPassword' || undefined}
                  aria-describedby={errorField === 'confirmPassword' ? 'register-error' : undefined}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={128}
                  required
                />
              </label>
            </div>
            <button
              type="button"
              className="secondary password-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? '隐藏密码' : '显示密码'}
            </button>
          </fieldset>
          {error && (
            <p id="register-error" className="error-notice" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? '注册中…' : '注册账号'}
          </button>
        </form>
        <a className="auth-back" href="/login">
          已有账号？去登录
        </a>
      </div>
    </section>
  );
}
