import { useModelSettings } from './useModelSettings.js';
import { ModelProfileDirectory } from './ModelProfileDirectory.js';
import { ModelProfileEditor } from './ModelProfileEditor.js';

export function ModelSettingsPage() {
  const model = useModelSettings();

  return (
    <div className="model-settings-shell">
      <header className="model-page-header model-page-header--compact">
        <div>
          <p className="eyebrow">对局助手</p>
          <h1>模型配置</h1>
          <p>保存模型后，可在房间添加 AI 或在对局中启用托管。</p>
        </div>
        <a className="button-link secondary" href="/official-ai">
          使用官方 AI
        </a>
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
            <strong>当前暂未启用外部密钥加密存储</strong>
            <p>可使用内置模拟模型体验；如需接入第三方模型，请联系管理员启用安全存储。</p>
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
          <p>正在同步模型配置…</p>
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
