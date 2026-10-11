import { PROVIDER_PRESETS, detectProvider } from './model-presets.js';

import type { useModelSettings } from './useModelSettings.js';
type Props = Pick<
  ReturnType<typeof useModelSettings>,
  | 'profiles'
  | 'credentialsAvailable'
  | 'editing'
  | 'error'
  | 'busy'
  | 'deleteId'
  | 'setDeleteId'
  | 'results'
  | 'filterType'
  | 'setFilterType'
  | 'searchQuery'
  | 'setSearchQuery'
  | 'nameInput'
  | 'formSectionRef'
  | 'reset'
  | 'edit'
  | 'clone'
  | 'applyPreset'
  | 'action'
  | 'filteredProfiles'
  | 'realCount'
  | 'mockCount'
>;
export function ModelProfileDirectory({
  profiles,
  credentialsAvailable,
  editing,
  busy,
  deleteId,
  setDeleteId,
  results,
  filterType,
  setFilterType,
  searchQuery,
  setSearchQuery,
  nameInput,
  formSectionRef,
  reset,
  edit,
  clone,
  applyPreset,
  action,
  filteredProfiles,
  realCount,
  mockCount,
}: Props) {
  return (
    <section className="model-directory">
      <div className="model-directory-header">
        <h2>
          <span>已保存配置</span>
          <span className="model-count-badge">{filteredProfiles.length}</span>
        </h2>
        <button
          type="button"
          className="secondary model-btn-sm"
          onClick={() => {
            reset();
            nameInput.current?.focus();
            formSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }}
        >
          + 新增配置
        </button>
      </div>

      {/* Toolbar: Search and Filter Pills */}
      <div className="model-toolbar">
        <div className="model-search-box">
          <span className="model-search-icon">🔍</span>
          <input
            type="search"
            className="model-search-input"
            placeholder="搜索模型名称、ID 或端点…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="model-filter-pills">
          <button
            type="button"
            className={`model-filter-pill ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            全部 ({profiles.length})
          </button>
          <button
            type="button"
            className={`model-filter-pill ${filterType === 'real' ? 'active' : ''}`}
            onClick={() => setFilterType('real')}
          >
            云端模型 ({realCount})
          </button>
          <button
            type="button"
            className={`model-filter-pill ${filterType === 'mock' ? 'active' : ''}`}
            onClick={() => setFilterType('mock')}
          >
            模拟沙盒 ({mockCount})
          </button>
          <button
            type="button"
            className={`model-filter-pill ${filterType === 'uncredentialed' ? 'active' : ''}`}
            onClick={() => setFilterType('uncredentialed')}
          >
            待配密钥 ({profiles.filter((p) => !p.has_credential && p.endpoint_id !== 'mock').length}
            )
          </button>
        </div>
      </div>

      {/* Cards List */}
      <div className="model-cards-list">
        {profiles.length === 0 ? (
          <div className="model-empty-state">
            <span className="model-empty-icon">🤖</span>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>尚未保存模型配置。</p>
            <p className="muted" style={{ margin: 0 }}>
              在右侧选择 DeepSeek、OpenAI 或内置模拟，一键添加你的第一个模型配置。
            </p>
            <button
              type="button"
              onClick={() => {
                if (PROVIDER_PRESETS[0]) applyPreset(PROVIDER_PRESETS[0]);
                nameInput.current?.focus();
              }}
            >
              🚀 一键添加 DeepSeek 配置
            </button>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="model-empty-state">
            <span className="model-empty-icon">🔍</span>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>未找到匹配的模型</p>
            <p className="muted">尝试更换关键词或清除筛选标签。</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSearchQuery('');
                setFilterType('all');
              }}
            >
              重置筛选条件
            </button>
          </div>
        ) : (
          filteredProfiles.map((profile) => {
            const detected = detectProvider(profile.endpoint_id, profile.base_url);
            const isMockItem = profile.endpoint_id === 'mock';
            const isCurrentEditing = editing?.id === profile.id;
            const res = results[profile.id];
            return (
              <article
                className={`panel model-profile ${isCurrentEditing ? 'is-editing' : ''}`}
                key={profile.id}
              >
                {/* Top Brand & Status Line */}
                <div className="model-profile-top">
                  <div className="model-profile-brand">
                    <span
                      className="model-brand-avatar"
                      style={{ borderColor: detected?.color ? `${detected.color}40` : undefined }}
                    >
                      {detected?.icon ?? '🧩'}
                    </span>
                    <div className="model-title-group">
                      <h3>{profile.name}</h3>
                      <div className="model-profile-meta">
                        <span>{detected?.shortName ?? 'OpenAI 兼容'}</span>
                        <span>•</span>
                        <span>{isMockItem ? '沙盒环境' : 'HTTPS 端点'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {isMockItem ? (
                    <span className="model-status-badge status-mock">🧪 模拟免密</span>
                  ) : profile.has_credential ? (
                    <span className="model-status-badge status-ready">🟢 凭证就绪</span>
                  ) : (
                    <span className="model-status-badge status-missing-key">🟡 待配 API Key</span>
                  )}
                </div>

                {/* Technical Details Box */}
                <div className="model-profile-details">
                  <div className="model-detail-row">
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {profile.model_id} · 版本 {profile.profile_version}
                    </p>
                    <div className="model-chips-row">
                      {typeof profile.parameters?.temperature === 'number' && (
                        <span className="model-chip" title="采样温度">
                          🌡️ {profile.parameters.temperature}
                        </span>
                      )}
                      {typeof profile.parameters?.maxOutputTokens === 'number' && (
                        <span className="model-chip" title="最大输出 Token">
                          📏 {profile.parameters.maxOutputTokens}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Endpoint URL */}
                  <p className="muted model-endpoint-url" title={profile.base_url}>
                    {isMockItem ? '沙盒内置虚拟环境（无需公网调用）' : profile.base_url}
                  </p>

                  <p className="model-credential-line">
                    {profile.endpoint_id === 'mock'
                      ? '未配置凭证 · 模拟模型无需密钥'
                      : profile.has_credential
                        ? '凭证已配置'
                        : '未配置凭证，请编辑并填写 API key'}
                  </p>
                </div>

                {/* Actions Bar */}
                <div className="model-actions">
                  <button
                    className="secondary model-btn-sm"
                    disabled={
                      !!busy ||
                      (profile.endpoint_id !== 'mock' &&
                        (!profile.has_credential || !credentialsAvailable))
                    }
                    onClick={() => void action(profile, 'test')}
                  >
                    {busy === `test:${profile.id}` ? '测试中…' : '测试连接'}
                  </button>
                  <button
                    className="secondary model-btn-sm"
                    disabled={!!busy}
                    onClick={() => edit(profile)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="secondary model-btn-sm"
                    disabled={!!busy}
                    onClick={() => clone(profile)}
                    title="基于此配置创建副本"
                  >
                    复制
                  </button>
                  {profile.has_credential && (
                    <button
                      className="secondary model-btn-sm"
                      disabled={!!busy}
                      onClick={() => void action(profile, 'revoke')}
                    >
                      撤销凭证
                    </button>
                  )}
                  <button
                    className="secondary model-btn-sm model-btn-danger"
                    disabled={!!busy}
                    onClick={() => setDeleteId(profile.id)}
                  >
                    删除
                  </button>
                </div>

                {/* Delete Confirmation Box */}
                {deleteId === profile.id && (
                  <div className="model-delete-box">
                    <p>
                      确定删除「{profile.name}」？密钥也会撤销。正在使用此配置的对局请先收回控制。
                    </p>
                    <div className="model-actions">
                      <button
                        className="model-btn-sm"
                        disabled={!!busy}
                        onClick={() => void action(profile, 'delete')}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="secondary model-btn-sm"
                        disabled={!!busy}
                        onClick={() => setDeleteId(null)}
                      >
                        取消删除
                      </button>
                    </div>
                  </div>
                )}

                {/* Test or Operation Results */}
                {res?.error && (
                  <div className="model-result-box is-error">
                    <span>⚠️</span>
                    <p
                      className="error-notice"
                      role="alert"
                      style={{ margin: 0, padding: 0, background: 'none' }}
                    >
                      {res.error}
                    </p>
                  </div>
                )}
                {res?.success && (
                  <div className="model-result-box is-success">
                    <span>✅</span>
                    <p role="status" style={{ margin: 0 }}>
                      {res.success}
                      {res.latencyMs !== undefined ? ` (${res.latencyMs}ms)` : ''}
                    </p>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
