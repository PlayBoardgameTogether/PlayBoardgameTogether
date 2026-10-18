import { detectProvider, PROVIDER_PRESETS } from './model-presets.js';
import type { useModelSettings } from './useModelSettings.js';

type Props = Pick<
  ReturnType<typeof useModelSettings>,
  | 'profiles'
  | 'credentialsAvailable'
  | 'editing'
  | 'busy'
  | 'deleteId'
  | 'setDeleteId'
  | 'results'
  | 'reset'
  | 'edit'
  | 'clone'
  | 'action'
  | 'nameInput'
  | 'formSectionRef'
  | 'searchQuery'
  | 'setSearchQuery'
  | 'filteredProfiles'
  | 'filterKind'
  | 'setFilterKind'
  | 'applyPreset'
>;

export function ModelProfileDirectory({
  profiles,
  credentialsAvailable,
  editing,
  busy,
  deleteId,
  setDeleteId,
  results,
  reset,
  edit,
  clone,
  action,
  nameInput,
  formSectionRef,
  searchQuery,
  setSearchQuery,
  filteredProfiles,
  filterKind,
  setFilterKind,
  applyPreset,
}: Props) {
  const readyCount = profiles.filter(
    (p) => p.enabled && (p.endpoint_id === 'mock' || p.has_credential),
  ).length;
  const needsKeyCount = profiles.filter(
    (p) => p.enabled && p.endpoint_id !== 'mock' && !p.has_credential,
  ).length;

  return (
    <section className="model-directory" aria-label="已保存配置">
      {/* 头部标题与新增按钮 */}
      <div className="model-directory-header">
        <div className="model-directory-title-wrap">
          <div className="model-directory-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div>
            <div className="model-directory-title-row">
              <h2>已保存配置</h2>
              <span className="model-badge-count" title={`总共 ${profiles.length} 个配置`}>
                {profiles.length}
              </span>
            </div>
            <p className="model-directory-subtitle">管理自定义 AI 模型与密钥配置</p>
          </div>
        </div>

        <button
          type="button"
          className="model-create-btn"
          disabled={!!busy}
          onClick={() => {
            reset();
            nameInput.current?.focus();
            formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
          title="新建一个模型配置"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新增配置
        </button>
      </div>

      {/* 搜索框与状态筛选标签栏 */}
      {profiles.length > 0 && (
        <div className="model-filter-toolbar">
          <div className="model-search-box">
            <svg
              className="model-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              aria-label="搜索配置"
              placeholder="搜索配置名称、模型标识或地址…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="model-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="清除搜索"
              >
                ✕
              </button>
            )}
          </div>

          <div className="model-filter-tabs" role="group" aria-label="状态过滤">
            <button
              type="button"
              className={`model-filter-tab ${filterKind === 'all' ? 'is-active' : ''}`}
              aria-pressed={filterKind === 'all'}
              onClick={() => setFilterKind('all')}
            >
              全部 ({profiles.length})
            </button>
            <button
              type="button"
              className={`model-filter-tab ${filterKind === 'ready' ? 'is-active' : ''}`}
              aria-pressed={filterKind === 'ready'}
              onClick={() => setFilterKind('ready')}
            >
              <span className="dot dot--ready" aria-hidden="true" />
              已就绪 ({readyCount})
            </button>
            {needsKeyCount > 0 && (
              <button
                type="button"
                className={`model-filter-tab ${filterKind === 'needs-key' ? 'is-active' : ''}`}
                aria-pressed={filterKind === 'needs-key'}
                onClick={() => setFilterKind('needs-key')}
              >
                <span className="dot dot--warn" aria-hidden="true" />
                待配密钥 ({needsKeyCount})
              </button>
            )}
            <button
              type="button"
              className={`model-filter-tab ${filterKind === 'mock' ? 'is-active' : ''}`}
              aria-pressed={filterKind === 'mock'}
              onClick={() => setFilterKind('mock')}
            >
              🧪 沙盒模拟
            </button>
          </div>
        </div>
      )}

      {/* 配置卡片列表 */}
      <div className="model-cards-list">
        {profiles.length === 0 ? (
          <div className="model-empty-hero">
            <div className="model-empty-icon" aria-hidden="true">
              🎲
            </div>
            <h3>暂无模型配置</h3>
            <p>添加自己的模型，或先用无需密钥的内置模拟体验托管。</p>
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() => {
                const preset = PROVIDER_PRESETS.find((item) => item.id === 'mock');
                if (preset) applyPreset(preset);
                nameInput.current?.focus();
                formSectionRef.current?.scrollIntoView({ block: 'nearest' });
              }}
            >
              配置内置模拟
            </button>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="model-no-results">
            <p>未找到符合条件的模型配置。</p>
            <button
              type="button"
              className="model-btn-ghost"
              onClick={() => {
                setSearchQuery('');
                setFilterKind('all');
              }}
            >
              重置筛选与搜索
            </button>
          </div>
        ) : (
          filteredProfiles.map((profile) => {
            const isMock = profile.endpoint_id === 'mock';
            const result = results[profile.id];
            const isEditing = editing?.id === profile.id;
            const provider = detectProvider(profile.endpoint_id, profile.base_url);

            return (
              <article
                className={`model-profile ${isEditing ? 'is-editing' : ''}`}
                key={profile.id}
              >
                {/* 正在编辑指示 */}
                {isEditing && (
                  <div className="model-editing-ribbon">
                    <span className="model-pulse-dot" aria-hidden="true" />
                    正在编辑此配置
                  </div>
                )}

                {/* 卡片顶部：服务商与状态 */}
                <div className="model-profile-top">
                  <div className="model-title-wrap">
                    {provider && (
                      <span className="model-provider-badge">
                        <span className="provider-icon">{provider.icon}</span>
                        <span className="provider-name">{provider.shortName}</span>
                      </span>
                    )}
                    <h3>{profile.name}</h3>
                  </div>

                  <span
                    className={`model-status-pill ${
                      !profile.enabled
                        ? 'status-disabled'
                        : isMock
                          ? 'status-mock'
                          : profile.has_credential
                            ? 'status-ready'
                            : 'status-needs-key'
                    }`}
                  >
                    {!profile.enabled
                      ? '已停用'
                      : isMock
                        ? '模拟模型'
                        : profile.has_credential
                          ? '凭证已配置'
                          : '待配密钥'}
                  </span>
                </div>

                {/* 模型标识与版本号 */}
                <p className="model-profile-id">
                  {profile.model_id} · 版本 {profile.profile_version}
                </p>

                {/* 端点地址与凭证说明 */}
                <p className="muted model-endpoint-url">
                  {isMock
                    ? '未配置凭证 · 模拟模型无需密钥'
                    : profile.has_credential
                      ? profile.base_url
                      : '未配置凭证，请编辑并填写 API key'}
                </p>

                {/* 测试结果反馈 */}
                {result?.error && (
                  <div className="error-notice" role="alert">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{result.error}</span>
                  </div>
                )}
                {result?.success && (
                  <div className="model-feedback" role="status">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>
                      {result.success}
                      {result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ''}
                    </span>
                  </div>
                )}

                {/* 操作栏 */}
                <div className="model-actions">
                  <button className="secondary" disabled={!!busy} onClick={() => edit(profile)}>
                    编辑
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      !!busy || (!isMock && (!profile.has_credential || !credentialsAvailable))
                    }
                    onClick={() => void action(profile, 'test')}
                  >
                    {busy === `test:${profile.id}` ? '测试中…' : '测试连接'}
                  </button>
                  <details className="model-more">
                    <summary>更多</summary>
                    <div className="model-more-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => clone(profile)}
                      >
                        复制
                      </button>
                      {profile.has_credential && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => void action(profile, 'revoke')}
                        >
                          撤销凭证
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary danger"
                        disabled={!!busy}
                        onClick={() => setDeleteId(profile.id)}
                      >
                        删除
                      </button>
                    </div>
                  </details>
                </div>

                {/* 删除确认框 */}
                {deleteId === profile.id && (
                  <div className="model-delete-box" role="alert">
                    <p>确定删除「{profile.name}」？密钥也会撤销。使用中的对局请先收回控制。</p>
                    <div className="model-actions">
                      <button
                        type="button"
                        className="danger"
                        disabled={!!busy}
                        onClick={() => void action(profile, 'delete')}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => setDeleteId(null)}
                      >
                        取消删除
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {profiles.length > 0 && (
        <p className="muted model-field-hint">测试连接会发送一次请求，可能产生服务商费用。</p>
      )}
    </section>
  );
}
