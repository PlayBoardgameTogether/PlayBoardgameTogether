import { PROVIDER_PRESETS } from './model-presets.js';
import type { useModelSettings } from './useModelSettings.js';

type Props = Pick<
  ReturnType<typeof useModelSettings>,
  | 'endpoints'
  | 'credentialsAvailable'
  | 'draft'
  | 'setDraft'
  | 'editing'
  | 'error'
  | 'busy'
  | 'showApiKey'
  | 'setShowApiKey'
  | 'showAdvanced'
  | 'setShowAdvanced'
  | 'nameInput'
  | 'formSectionRef'
  | 'isMock'
  | 'endpointChanged'
  | 'needsKey'
  | 'cannotSave'
  | 'reset'
  | 'save'
  | 'activePreset'
  | 'applyPreset'
  | 'selectedPresetId'
  | 'setSelectedPresetId'
>;

export function ModelProfileEditor({
  endpoints,
  credentialsAvailable,
  draft,
  setDraft,
  editing,
  error,
  busy,
  showApiKey,
  setShowApiKey,
  showAdvanced,
  setShowAdvanced,
  nameInput,
  formSectionRef,
  isMock,
  endpointChanged,
  needsKey,
  cannotSave,
  reset,
  save,
  activePreset,
  applyPreset,
  selectedPresetId,
  setSelectedPresetId,
}: Props) {
  return (
    <section className="model-editor-panel" ref={formSectionRef}>
      <div className="model-editor-header">
        <div>
          <h2>{editing ? `编辑「${editing.name}」` : '新增配置'}</h2>
          <p className="model-editor-subtitle">
            {editing
              ? '修改模型参数、更新密钥或调整对局策略'
              : '填写服务地址和模型标识，保存后再选择是否测试'}
          </p>
        </div>
        {editing && (
          <button
            type="button"
            className="secondary model-btn-cancel-top"
            disabled={!!busy}
            onClick={reset}
          >
            取消编辑
          </button>
        )}
      </div>

      {/* 热门服务商快捷预设选区 */}
      <details className="model-presets-bar">
        <summary>快速填入服务商配置（可选）</summary>
        <div className="model-presets-header">
          <span className="presets-title">快速选用服务商预设</span>
          <span className="presets-hint">一键填入地址与推荐模型</span>
        </div>
        <div className="model-presets-grid">
          {PROVIDER_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset-pill-btn ${isSelected ? 'is-selected' : ''}`}
                onClick={() => applyPreset(preset)}
                disabled={!!busy}
                title={`${preset.name} - ${preset.description}`}
              >
                <span className="preset-icon" aria-hidden="true">
                  {preset.icon}
                </span>
                <span className="preset-name">{preset.shortName}</span>
                {preset.tag && <span className="preset-tag">{preset.tag}</span>}
              </button>
            );
          })}
        </div>

        {activePreset?.websiteUrl && (
          <div className="preset-guide-bar">
            <span className="guide-desc">💡 {activePreset.description}</span>
            <a
              href={activePreset.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="preset-external-link"
            >
              前往 {activePreset.websiteName ?? '服务商平台'} 获取 Key ↗
            </a>
          </div>
        )}
      </details>

      <form className="form-stack model-form-stack" onSubmit={save}>
        <label>
          配置名称
          <input
            ref={nameInput}
            name="name"
            maxLength={60}
            placeholder="例如：我的桌游 AI"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            disabled={!!busy}
            required
          />
        </label>

        <label>
          服务端点
          <select
            value={draft.endpointId}
            onChange={(event) => {
              const newEndpoint = event.target.value;
              setSelectedPresetId(newEndpoint === 'custom' ? 'custom' : null);
              setDraft({ ...draft, endpointId: newEndpoint, apiKey: '' });
            }}
            disabled={!!busy}
            required
          >
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
                {endpoint.protocol === 'mock' ? '（模拟）' : ''}
              </option>
            ))}
            <option value="custom">自定义 OpenAI 兼容服务</option>
          </select>
        </label>

        {draft.endpointId === 'custom' && (
          <label>
            Base URL（HTTPS）
            <input
              name="baseUrl"
              type="url"
              placeholder="https://api.example.com/v1"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              disabled={!!busy}
              required
            />
          </label>
        )}

        <label>
          模型标识
          <input
            name="modelId"
            placeholder="服务商提供的 model ID"
            value={draft.modelId}
            onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
            disabled={!!busy}
            maxLength={120}
            required
          />
        </label>

        <div className="model-key-field">
          <label htmlFor="model-api-key">API key（仅写入，不会回显）</label>
          <div className="api-key-input-wrapper">
            <input
              id="model-api-key"
              name="apiKey"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              minLength={isMock ? 0 : 4}
              maxLength={4096}
              disabled={!!busy || isMock || !credentialsAvailable}
              required={needsKey}
              placeholder={
                editing?.has_credential && !endpointChanged
                  ? '留空保留已保存的密钥'
                  : '填写服务商的 API key'
              }
            />
            <button
              type="button"
              className="secondary key-toggle-btn"
              disabled={!!busy || isMock || !credentialsAvailable}
              aria-pressed={showApiKey}
              onClick={() => setShowApiKey((value) => !value)}
            >
              {showApiKey ? '隐藏' : '显示'}
            </button>
          </div>
          {isMock && <p className="muted model-field-hint">模拟模型无需密钥，不调用真实服务。</p>}
          {endpointChanged && !isMock && (
            <p className="muted model-field-hint">更换服务地址后，请重新填写密钥。</p>
          )}
        </div>

        <details
          className="model-advanced-box"
          open={showAdvanced}
          onToggle={(event) => setShowAdvanced(event.currentTarget.open)}
        >
          <summary>高级设置</summary>
          <div className="model-advanced-content">
            <label className="model-switch-label">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                disabled={!!busy}
              />
              启用此配置
            </label>
            <label>
              采样温度
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={draft.temperature}
                placeholder="服务商默认（推荐 0.3~0.5）"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    temperature: event.target.value === '' ? '' : Number(event.target.value),
                  })
                }
                disabled={!!busy}
              />
            </label>
            <label>
              最大输出 Token
              <input
                type="number"
                min="16"
                max="512"
                step="1"
                value={draft.maxOutputTokens}
                placeholder="服务商默认（推荐 256）"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxOutputTokens: event.target.value === '' ? '' : Number(event.target.value),
                  })
                }
                disabled={!!busy}
              />
            </label>
          </div>
        </details>

        {error && (
          <p className="error-notice" role="alert">
            {error}
          </p>
        )}

        <div className="model-actions model-editor-submit-bar">
          <button className="model-btn-save" disabled={!!busy || cannotSave}>
            {busy === 'save' ? '保存中…' : editing ? '保存修改' : '保存配置'}
          </button>
          {editing && (
            <button type="button" className="secondary" disabled={!!busy} onClick={reset}>
              取消编辑
            </button>
          )}
        </div>
        <p className="muted model-field-hint">保存不会调用模型。</p>
      </form>
    </section>
  );
}
