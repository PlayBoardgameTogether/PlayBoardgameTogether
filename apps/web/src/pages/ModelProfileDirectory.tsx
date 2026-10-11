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
}: Props) {
  return (
    <section className="model-directory" aria-label="已保存配置">
      <div className="model-section-heading">
        <h2>
          已保存配置 <small>{profiles.length}</small>
        </h2>
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => {
            reset();
            nameInput.current?.focus();
            formSectionRef.current?.scrollIntoView({ block: 'nearest' });
          }}
        >
          新增配置
        </button>
      </div>
      {profiles.length > 0 && (
        <input
          type="search"
          aria-label="搜索配置"
          placeholder="搜索名称、模型或地址"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      )}
      <div className="model-cards-list">
        {profiles.length === 0 ? (
          <p className="model-empty-state">暂无配置，填写表单添加第一个模型。</p>
        ) : filteredProfiles.length === 0 ? (
          <div className="model-empty-state">
            <p>没有匹配的配置。</p>
            <button type="button" className="secondary" onClick={() => setSearchQuery('')}>
              清除搜索
            </button>
          </div>
        ) : (
          filteredProfiles.map((profile) => {
            const isMock = profile.endpoint_id === 'mock';
            const result = results[profile.id];
            return (
              <article
                className={`model-profile ${editing?.id === profile.id ? 'is-editing' : ''}`}
                key={profile.id}
              >
                <div className="model-profile-top">
                  <h3>{profile.name}</h3>
                  <span className="muted">
                    {!profile.enabled
                      ? '已停用'
                      : isMock
                        ? '模拟模型'
                        : profile.has_credential
                          ? '凭证已配置'
                          : '待配密钥'}
                  </span>
                </div>
                <p className="model-profile-id">
                  {profile.model_id} · 版本 {profile.profile_version}
                </p>
                <p className="muted model-endpoint-url">
                  {isMock
                    ? '未配置凭证 · 模拟模型无需密钥'
                    : profile.has_credential
                      ? profile.base_url
                      : '未配置凭证，请编辑并填写 API key'}
                </p>
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
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => void action(profile, 'revoke')}
                        >
                          撤销凭证
                        </button>
                      )}
                      <button
                        className="secondary danger"
                        disabled={!!busy}
                        onClick={() => setDeleteId(profile.id)}
                      >
                        删除
                      </button>
                    </div>
                  </details>
                </div>
                {deleteId === profile.id && (
                  <div className="model-delete-box">
                    <p>确定删除「{profile.name}」？密钥也会撤销。使用中的对局请先收回控制。</p>
                    <div className="model-actions">
                      <button disabled={!!busy} onClick={() => void action(profile, 'delete')}>
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
                {result?.error && (
                  <p className="error-notice" role="alert">
                    {result.error}
                  </p>
                )}
                {result?.success && (
                  <p className="model-feedback" role="status">
                    {result.success}
                    {result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ''}
                  </p>
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
