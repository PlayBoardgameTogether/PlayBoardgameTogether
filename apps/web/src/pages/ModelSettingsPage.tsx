import { useModelSettings } from './useModelSettings.js';
import { ModelProfileDirectory } from './ModelProfileDirectory.js';
import { ModelProfileEditor } from './ModelProfileEditor.js';

export function ModelSettingsPage() {
  const model = useModelSettings();
  const {
    credentialsAvailable,
    loading,
    loadError,
    notice,
    totalCount,
    readyCount,
    realCount,
    mockCount,
  } = model;
  return (
    <div className="model-settings-shell">
      {/* Page Header */}
      <section className="page-heading model-page-header">
        <div>
          <p className="eyebrow">个人设置 · AI 推理中心</p>
          <h1>模型配置</h1>
          <p>
            配置大语言模型推理端点与密钥，为对局注入高智能 AI 玩家。支持
            DeepSeek、OpenAI、通义千问等主流服务商及沙盒模拟。
          </p>
          <p className="muted">
            保存不会调用模型；点击“测试连接”会发送一次简短请求，可能产生服务商少量费用。
          </p>
        </div>
      </section>

      {/* Global Status Notices */}
      {!credentialsAvailable && (
        <p className="error-notice" role="alert">
          服务器尚未启用密钥加密，请联系管理员配置后使用真实模型。模拟模型仍可使用。
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      {/* Metrics Banner */}
      {!loading && !loadError && (
        <div className="model-metrics-grid">
          <div className="model-metric-card">
            <div className="model-metric-icon">🧩</div>
            <div className="model-metric-info">
              <span className="model-metric-val">{totalCount}</span>
              <span className="model-metric-label">已配置模型</span>
            </div>
          </div>
          <div className="model-metric-card">
            <div className="model-metric-icon">🟢</div>
            <div className="model-metric-info">
              <span className="model-metric-val">{readyCount}</span>
              <span className="model-metric-label">就绪可用</span>
            </div>
          </div>
          <div className="model-metric-card">
            <div className="model-metric-icon">⚡</div>
            <div className="model-metric-info">
              <span className="model-metric-val">{realCount}</span>
              <span className="model-metric-label">真实云端模型</span>
            </div>
          </div>
          <div className="model-metric-card">
            <div className="model-metric-icon">🧪</div>
            <div className="model-metric-info">
              <span className="model-metric-val">{mockCount}</span>
              <span className="model-metric-label">内置模拟沙盒</span>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p role="status">正在加载模型设置…</p>
      ) : loadError ? (
        <section className="panel">
          <p role="alert">加载失败：{loadError}</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </section>
      ) : (
        <div className="model-workbench">
          {/* LEFT COLUMN: Saved Profiles Directory */}
          <ModelProfileDirectory {...model} />

          {/* RIGHT COLUMN: Configuration Workbench / Editor */}
          <ModelProfileEditor {...model} />
        </div>
      )}
    </div>
  );
}
