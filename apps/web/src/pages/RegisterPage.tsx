import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import { registrationInputSchema, registrationEmailSchema } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';

type RegistrationField =
  | 'displayName'
  | 'userId'
  | 'password'
  | 'confirmPassword'
  | 'email'
  | 'emailCode';

export function RegisterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; email: string }>();
  const [sending, setSending] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [mailStatus, setMailStatus] = useState('');
  const sendingRef = useRef(false);
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
    if (!retryAt) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function sendCode() {
    if (sendingRef.current || pending.current || seconds > 0) return;
    const parsed = registrationEmailSchema.safeParse(email);
    if (!parsed.success) {
      setErrorField('email');
      setError('请输入有效的邮箱地址。');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    setErrorField(undefined);
    setMailStatus('');
    try {
      const result = await api.requestRegistrationEmailCode(parsed.data);
      if (!mounted.current) return;
      setChallenge({ id: result.challengeId, email: parsed.data });
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      setMailStatus('验证码已发送，10 分钟内有效。请检查收件箱或垃圾邮件。');
      const field = form.current?.elements.namedItem('emailCode');
      if (field instanceof HTMLElement) field.focus();
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        cause instanceof ApiError && cause.code === 'RATE_LIMITED'
          ? '发送过于频繁，请稍后重试；同一邮箱每小时最多发送 5 封。'
          : cause instanceof ApiError && cause.code === 'SERVICE_UNAVAILABLE'
            ? '邮件服务暂不可用，请稍后重试。'
            : '发送结果未确认，请检查邮箱；一分钟后可重新发送。',
      );
      setRetryAt(Date.now() + 60_000);
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  }

  useEffect(() => {
    if (!busy && error && errorField) {
      const field = form.current?.elements.namedItem(errorField);
      if (field instanceof HTMLElement) field.focus();
    }
  }, [busy, error, errorField]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || sendingRef.current) return;
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
    const parsedEmail = registrationEmailSchema.safeParse(email);
    if (!parsedEmail.success || !challenge || challenge.email !== parsedEmail.data) {
      setErrorField('email');
      setError('请先向当前邮箱发送验证码。');
      return;
    }
    const emailCode = String(data.get('emailCode') ?? '');
    if (!/^\d{6}$/.test(emailCode)) {
      setErrorField('emailCode');
      setError('请输入邮件中的 6 位数字验证码。');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setErrorField(undefined);
    try {
      const result = await api.register({
        ...parsed.data,
        email: parsedEmail.data,
        challengeId: challenge.id,
        emailCode,
      });
      if (mounted.current) navigate('/login', { registeredUserId: result.username });
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.code === 'STATE_CONFLICT') setErrorField('userId');
      setError(
        cause instanceof ApiError && cause.code === 'STATE_CONFLICT'
          ? '用户 ID 或邮箱已被使用，请更换后重试。'
          : cause instanceof ApiError && cause.code === 'RATE_LIMITED'
            ? '注册尝试过于频繁，请一分钟后重试。'
            : cause instanceof ApiError && cause.code === 'VALIDATION_ERROR'
              ? '注册信息或验证码无效；验证码 10 分钟内有效，输错 5 次后需重新发送。'
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
        <p className="muted">验证邮箱后注册，开启桌游之旅。</p>
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
          aria-busy={busy || sending}
          aria-describedby={error ? 'register-error' : undefined}
        >
          <fieldset className="login-fields" disabled={busy}>
            <div className="auth-field">
              <label>
                邮箱
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  disabled={sending}
                  aria-invalid={errorField === 'email' || undefined}
                  aria-describedby="register-email-help"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setChallenge(undefined);
                    setMailStatus('');
                  }}
                />
              </label>
              <p className="muted" id="register-email-help">
                用于验证账号，一个邮箱可注册一个账号。
              </p>
              <button
                type="button"
                className="secondary"
                disabled={sending || seconds > 0}
                onClick={() => void sendCode()}
              >
                {sending
                  ? '发送中…'
                  : seconds > 0
                    ? `${seconds} 秒后可重发`
                    : challenge
                      ? '重新发送验证码'
                      : '发送验证码'}
              </button>
            </div>
            <div className="auth-field">
              <label>
                邮箱验证码
                <input
                  name="emailCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  pattern="[0-9]{6}"
                  aria-invalid={errorField === 'emailCode' || undefined}
                  aria-describedby={errorField === 'emailCode' ? 'register-error' : undefined}
                />
              </label>
            </div>
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
          {mailStatus && <p role="status">{mailStatus}</p>}
          <button type="submit" disabled={busy || sending}>
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
