import { useModelSettings } from './useModelSettings.js';
import { ModelProfileDirectory } from './ModelProfileDirectory.js';
import { ModelProfileEditor } from './ModelProfileEditor.js';

export function ModelSettingsPage() {
  const model = useModelSettings();

  const totalProfiles = model.profiles.length;
  const readyProfiles = model.profiles.filter(
    (p) => p.enabled && (p.endpoint_id === 'mock' || p.has_credential),
  ).length;

  return (
    <div className="model-settings-shell">
      {/* 页面顶栏 Banner */}
      <header className="model-page-header">
        <div className="header-text-block">
          <div className="header-badge-row">
            <span className="header-chip">
              <span className="header-chip-pulse" aria-hidden="true" />
              AI 智能对弈中枢
            </span>
            <span className="header-chip header-chip-sec">PlayBoard 智能体工坊</span>
          </div>
          <h1>模型配置</h1>
          <p className="header-desc">
            管理对局 AI 使用的模型与密钥。支持一键接入
            DeepSeek、OpenAI、通义千问、智谱等云端端点，亦支持本地离线 Ollama 与免密沙盒模拟。
          </p>
        </div>

        {/* 顶部状态指标卡片组 */}
        {!model.loading && !model.loadError && (
          <div className="header-stats-grid">
            <div className="header-stat-card">
              <span className="stat-label">已收录模型</span>
              <span className="stat-number">{totalProfiles}</span>
              <span className="stat-footnote">当前已保存配置</span>
            </div>
            <div className="header-stat-card">
              <span className="stat-label">已就绪可出牌</span>
              <span className="stat-number stat-number-ready">{readyProfiles}</span>
              <span className="stat-footnote">随时加入对局席位</span>
            </div>
            <div className="header-stat-card">
              <span className="stat-label">凭证加密引擎</span>
              <span
                className={`stat-status-badge ${model.credentialsAvailable ? 'is-secure' : 'is-warning'}`}
              >
                {model.credentialsAvailable ? '🔒 AES-GCM 安全就绪' : '⚠️ 密钥加密未启用'}
              </span>
              <span className="stat-footnote">
                {model.credentialsAvailable ? '硬件/信封密钥防护' : '仅可使用内置沙盒模型'}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* 服务端未启用加密时的警示 Alert */}
      {!model.credentialsAvailable && !model.loading && !model.loadError && (
        <div className="model-alert-banner alert-warning" role="alert">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="alert-content">
            <strong>服务器当前未配置加密主密钥 (MODEL_CREDENTIAL_KEY)</strong>
            <p>
              外部真实模型的 API Key
              保存功能暂时受限，您依然可以自由使用「平台内置模拟」沙盒模型完成完整桌游对局流程。
            </p>
          </div>
        </div>
      )}

      {/* 全局操作通知 Toast */}
      {model.notice && (
        <div className="model-alert-banner alert-success" role="status">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div className="alert-content">
            <strong>操作成功</strong>
            <p>{model.notice}</p>
          </div>
        </div>
      )}

      {/* 加载与错误状态 */}
      {model.loading ? (
        <div className="model-loading-panel" role="status" aria-busy="true">
          <div className="loading-spinner-ring" aria-hidden="true" />
          <p>正在同步您的模型配置与安全端点…</p>
        </div>
      ) : model.loadError ? (
        <div className="model-error-panel" role="alert">
          <div className="error-icon-wrap" aria-hidden="true">
            ⚠️
          </div>
          <h2>模型配置加载失败</h2>
          <p>{model.loadError}</p>
          <button type="button" className="model-btn-primary" onClick={() => location.reload()}>
            重新加载页面
          </button>
        </div>
      ) : (
        /* 主工作台：左侧配置库 + 右侧编辑器 */
        <div className="model-workbench">
          <ModelProfileDirectory {...model} />
          <ModelProfileEditor {...model} />
        </div>
      )}
    </div>
  );
}
