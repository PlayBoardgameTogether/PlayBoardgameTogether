import { useModelSettings } from './useModelSettings.js';
import { ModelProfileDirectory } from './ModelProfileDirectory.js';
import { ModelProfileEditor } from './ModelProfileEditor.js';

export function ModelSettingsPage() {
  const model = useModelSettings();
  return (
    <div className="model-settings-shell">
      <section className="page-heading model-page-header">
        <h1>模型配置</h1>
        <p className="muted">管理对局 AI 使用的模型与密钥。</p>
      </section>
      {!model.credentialsAvailable && !model.loading && !model.loadError && (
        <p className="error-notice" role="alert">
          服务器尚未启用密钥加密，请联系管理员。模拟模型仍可使用。
        </p>
      )}
      {model.notice && (
        <p className="model-feedback" role="status">
          {model.notice}
        </p>
      )}
      {model.loading ? (
        <p role="status">正在加载模型设置…</p>
      ) : model.loadError ? (
        <section className="panel">
          <p role="alert">加载失败：{model.loadError}</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </section>
      ) : (
        <div className="model-workbench">
          <ModelProfileDirectory {...model} />
          <ModelProfileEditor {...model} />
        </div>
      )}
    </div>
  );
}
