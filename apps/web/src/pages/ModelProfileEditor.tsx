import { PROVIDER_PRESETS, detectProvider } from './model-presets.js';

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
  | 'selectedPresetId'
  | 'setSelectedPresetId'
  | 'nameInput'
  | 'formSectionRef'
  | 'isMock'
  | 'endpointChanged'
  | 'needsKey'
  | 'cannotSave'
  | 'reset'
  | 'applyPreset'
  | 'save'
  | 'currentPreset'
  | 'availablePresetModels'
>;
export function ModelProfileEditor({
  error,
  endpoints,
  credentialsAvailable,
  draft,
  setDraft,
  editing,
  busy,
  showApiKey,
  setShowApiKey,
  showAdvanced,
  setShowAdvanced,
  selectedPresetId,
  setSelectedPresetId,
  nameInput,
  formSectionRef,
  isMock,
  endpointChanged,
  needsKey,
  cannotSave,
  reset,
  applyPreset,
  save,
  currentPreset,
  availablePresetModels,
}: Props) {
  return (
    <section className="panel model-editor-panel" ref={formSectionRef}>
      <div className="model-editor-header">
        <h2>
          <span>{editing ? `编辑「${editing.name}」` : '新增配置'}</span>
          <span className="model-editor-mode-badge">{editing ? '编辑模式' : '新建模式'}</span>
        </h2>
        {editing && (
          <button type="button" className="secondary model-btn-sm" onClick={reset}>
            切换新建
          </button>
        )}
      </div>

      {/* Quick Provider Presets Grid (shown when creating or freely tweaking) */}
      <div className="provider-presets-section">
        <div className="provider-presets-label">
          <span>🚀 快捷厂商模板推荐</span>
          <span className="muted" style={{ fontSize: 11, textTransform: 'none' }}>
            点击即可一键填入端点与模型
          </span>
        </div>
        <div className="provider-presets-grid">
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`provider-preset-btn ${selectedPresetId === preset.id ? 'is-active' : ''}`}
              onClick={() => applyPreset(preset)}
              disabled={!!busy}
            >
              <div className="provider-preset-top">
                <span className="provider-preset-icon">{preset.icon}</span>
                <span className="provider-preset-tag">{preset.tag}</span>
              </div>
              <span className="provider-preset-name">{preset.shortName}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Form */}
      <form className="form-stack" onSubmit={save}>
        <label>
          配置名称
          <input
            ref={nameInput}
            name="name"
            maxLength={60}
            placeholder="例如：主力推理 DeepSeek-V3"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            disabled={!!busy}
            required
          />
        </label>

        <label>
          服务端点
          <select
            value={draft.endpointId}
            onChange={(e) => {
              const epId = e.target.value;
              const detected = PROVIDER_PRESETS.find((p) => p.endpointId === epId);
              setSelectedPresetId(detected?.id ?? null);
              setDraft({ ...draft, endpointId: epId, apiKey: '' });
            }}
            disabled={!!busy}
            required
          >
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
                {endpoint.protocol === 'mock' ? '（模拟，不调用真实模型）' : ''}
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
              onChange={(e) => {
                const url = e.target.value;
                const detected = detectProvider('custom', url);
                if (detected) setSelectedPresetId(detected.id);
                setDraft({ ...draft, baseUrl: url });
              }}
              disabled={!!busy}
              required
            />
            <span className="muted model-field-hint">
              填写服务商提供的 API 基础地址（通常以 /v1 结尾）。仅支持公网 HTTPS 协议。
            </span>
          </label>
        )}

        <label>
          模型标识
          <input
            name="modelId"
            list="model-id-suggestions"
            placeholder="例如：deepseek-chat 或 gpt-4o-mini"
            value={draft.modelId}
            onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
            disabled={!!busy}
            maxLength={120}
            required
          />
          <datalist id="model-id-suggestions">
            {availablePresetModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="deepseek-chat">DeepSeek-V3</option>
            <option value="deepseek-reasoner">DeepSeek-R1 (深度思考)</option>
            <option value="gpt-4o-mini">GPT-4o Mini</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="qwen-plus">通义千问 Plus</option>
            <option value="glm-4-flash">智谱 GLM-4 Flash</option>
            <option value="moonshot-v1-8k">Kimi Moonshot 8k</option>
            <option value="mock-v1">Mock V1 沙盒模型</option>
          </datalist>
          {/* Quick Model Chips */}
          {availablePresetModels.length > 0 && (
            <div className="model-suggest-chips">
              {availablePresetModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`model-suggest-chip ${draft.modelId === m.id ? 'is-active' : ''}`}
                  onClick={() => setDraft((cur) => ({ ...cur, modelId: m.id }))}
                >
                  {m.label} ({m.id})
                </button>
              ))}
            </div>
          )}
          <span className="muted model-field-hint">
            须与服务商提供的 model ID 完全一致，并支持 Chat Completions 协议。
          </span>
        </label>

        <label>
          API key（仅写入，不会回显）
          <div className="api-key-input-wrapper">
            <input
              name="apiKey"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              minLength={8}
              maxLength={4096}
              disabled={!!busy || isMock || !credentialsAvailable}
              required={needsKey}
              placeholder={
                editing?.has_credential && !endpointChanged
                  ? '留空保留已保存的密钥'
                  : '填写此服务商的 API key'
              }
            />
            <div className="api-key-actions">
              {draft.apiKey && (
                <button
                  type="button"
                  className="api-key-toggle-btn"
                  onClick={() => setDraft({ ...draft, apiKey: '' })}
                  title="清空输入"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                className="api-key-toggle-btn"
                onClick={() => setShowApiKey((v) => !v)}
                title={showApiKey ? '隐藏明文' : '查看明文'}
              >
                {showApiKey ? '🙈 隐藏' : '👁️ 显示'}
              </button>
            </div>
          </div>
        </label>

        {editing?.has_credential && !endpointChanged && !draft.apiKey && (
          <div className="model-security-tag">
            <span>🔒</span>
            <span>已保存安全凭证（仅可覆盖，系统永不回显明文）。若不需要更换，请直接留空。</span>
          </div>
        )}

        {currentPreset?.websiteUrl && !isMock && (
          <div className="model-field-hint" style={{ fontSize: 12 }}>
            💡 {currentPreset.keyHelpText}，前往{' '}
            <a href={currentPreset.websiteUrl} target="_blank" rel="noopener noreferrer">
              {currentPreset.websiteName ?? '服务商平台'} ↗
            </a>
          </div>
        )}

        {endpointChanged && !isMock && (
          <p className="muted" style={{ color: '#f59e0b' }}>
            ⚠️ 更换服务地址后需要重新填写密钥。
          </p>
        )}
        {isMock && (
          <p className="muted" style={{ color: '#10b981' }}>
            🧪 模拟模型无需密钥，由平台沙盒内置驱动，仅用于验证平台与对局流程。
          </p>
        )}

        {/* Advanced Reasoning Parameters Accordion */}
        <div className="model-advanced-box">
          <div
            className="model-advanced-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setShowAdvanced((v) => !v)}
          >
            <span>⚙️ 高级推理参数配置 (可选)</span>
            <span>{showAdvanced ? '▲ 收起' : '▼ 展开'}</span>
          </div>

          {showAdvanced && (
            <div className="model-advanced-content">
              <label className="model-switch-label">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  disabled={!!busy}
                />
                <span>启用此模型配置（允许在房间和对局中指派给玩家座位）</span>
              </label>

              <div className="model-slider-control">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <strong>Temperature (采样温度)</strong>
                  <span className="muted">
                    {typeof draft.temperature === 'number'
                      ? draft.temperature.toFixed(2)
                      : '默认 (0.5)'}
                  </span>
                </div>
                <div className="model-slider-row">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={typeof draft.temperature === 'number' ? draft.temperature : 0.5}
                    onChange={(e) =>
                      setDraft({ ...draft, temperature: parseFloat(e.target.value) })
                    }
                    disabled={!!busy}
                  />
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    value={draft.temperature}
                    placeholder="0.5"
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : parseFloat(e.target.value);
                      setDraft({ ...draft, temperature: val });
                    }}
                    disabled={!!busy}
                  />
                </div>
                <span className="muted model-field-hint">
                  较低值（0.1~0.4）更专注守序，适合棋盘策略推理；较高值（0.8+）更富变化。
                </span>
              </div>

              <div className="model-slider-control">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <strong>Max Output Tokens (最大输出上限)</strong>
                  <span className="muted">
                    {typeof draft.maxOutputTokens === 'number'
                      ? `${draft.maxOutputTokens} tokens`
                      : '默认 (256)'}
                  </span>
                </div>
                <div className="model-slider-row">
                  <input
                    type="range"
                    min="16"
                    max="512"
                    step="16"
                    value={typeof draft.maxOutputTokens === 'number' ? draft.maxOutputTokens : 256}
                    onChange={(e) =>
                      setDraft({ ...draft, maxOutputTokens: parseInt(e.target.value, 10) })
                    }
                    disabled={!!busy}
                  />
                  <input
                    type="number"
                    min="16"
                    max="512"
                    step="16"
                    value={draft.maxOutputTokens}
                    placeholder="256"
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                      setDraft({ ...draft, maxOutputTokens: val });
                    }}
                    disabled={!!busy}
                  />
                </div>
                <span className="muted model-field-hint">
                  控制单步动作生成的最大 Token 数（16 ~ 512）。桌游动作建议保持在
                  128~256，既快又省费用。
                </span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="error-notice" role="alert">
            {error}
          </p>
        )}

        <div className="model-actions" style={{ marginTop: 12 }}>
          <button disabled={!!busy || cannotSave}>
            {busy === 'save' ? '保存中…' : editing ? '保存修改' : '保存配置'}
          </button>
          {editing && (
            <button type="button" className="secondary" disabled={!!busy} onClick={reset}>
              取消编辑
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
