import { useEffect, useState, type FormEvent } from 'react';
import { friendIdInputValueSchema, formatFriendId } from '@boardgame/protocol';
import { api } from '../platform.js';
import { useSocial, useSocialCommand } from './useSocial.js';

export function FriendIdCard() {
  const { data, error, refresh } = useSocial();
  const action = useSocialCommand();
  const [value, setValue] = useState('');
  const [copy, setCopy] = useState('');
  const [copyError, setCopyError] = useState('');
  useEffect(() => {
    if (data) setValue(formatFriendId(data.identity.friendId));
  }, [data?.identity.friendId]);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const input = {
      friendId: friendIdInputValueSchema.parse(value),
      expectedRevision: data.identity.revision,
    };
    void action.run(
      JSON.stringify(input),
      (id) => api.changeFriendId({ ...input, requestId: id }),
      '好友 ID 已保存',
      () => void refresh(),
    );
  }
  async function copyFriendId() {
    if (!data) return;
    setCopy('');
    setCopyError('');
    try {
      await navigator.clipboard.writeText(formatFriendId(data.identity.friendId));
      setCopy('好友 ID 已复制');
    } catch {
      setCopyError('复制失败，请长按或选中 ID 复制');
    }
  }
  return (
    <section className="panel friend-id-card">
      <h2>我的好友 ID</h2>
      {data ? (
        <>
          <p>
            <code className="friend-id">{formatFriendId(data.identity.friendId)}</code>
          </p>
          <button className="secondary" onClick={() => void copyFriendId()}>
            复制好友 ID
          </button>
          <p className="muted">
            好友可通过此 ID 搜索并添加你。修改后好友关系与聊天记录均不受影响。
          </p>
          <form className="form-stack" onSubmit={save}>
            <label>
              新好友 ID
              <input
                required
                pattern="@?[A-Za-z0-9_]{3,36}"
                minLength={3}
                maxLength={37}
                placeholder="@username"
                value={value}
                disabled={action.busy}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <small className="muted">
              支持 3–36 位字母、数字或下划线，不区分大小写。
            </small>
            <p className="muted">
              {data.identity.changeIntervalDays === 0
                ? '当前可随时修改好友 ID。'
                : `当前每 ${data.identity.changeIntervalDays} 天可修改一次，首次自定义不受限制。`}
              {!data.identity.canChange && data.identity.nextChangeAt && (
                <>
                  <br />
                  下次可修改：
                  <time dateTime={data.identity.nextChangeAt}>
                    {new Date(data.identity.nextChangeAt).toLocaleString('zh-CN')}
                  </time>
                </>
              )}
            </p>
            <button
              disabled={
                action.busy ||
                !data.identity.canChange ||
                friendIdInputValueSchema.safeParse(value).data === data.identity.friendId
              }
            >
              保存好友 ID
            </button>
          </form>
        </>
      ) : (
        !error && <p>正在读取好友 ID…</p>
      )}
      {(error || action.error || copyError) && (
        <div className="profile-feedback-toast profile-feedback-toast--error">
          <span className="toast-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div className="toast-body">
            <strong className="toast-title">提示</strong>
            <span className="error-notice" role="alert">
              {error || action.error || copyError}
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => void (copyError && !error && !action.error ? copyFriendId() : refresh())}
          >
            {copyError && !error && !action.error ? '重试复制' : '重新读取'}
          </button>
        </div>
      )}
      {(action.notice || copy) && (
        <div className="profile-feedback-toast profile-feedback-toast--success">
          <span className="toast-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="toast-body">
            <strong className="toast-title">操作成功</strong>
            <span role="status" className="toast-msg">
              {action.notice || copy}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
