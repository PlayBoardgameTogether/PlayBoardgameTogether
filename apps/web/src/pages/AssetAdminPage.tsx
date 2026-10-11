import { useAssetWorkspace } from './useAssetWorkspace.js';
import { AssetDraftEditor } from './AssetDraftEditor.js';
import { api } from '../platform.js';
import { AdminLayout } from './admin/AdminLayout.js';
export function AssetAdminPage() {
  return (
    <AdminLayout
      path="/admin/assets"
      title="图片与短音效"
      description="上传、映射、校验，再发布一个不可变版本。"
    >
      <AssetWorkspace />
    </AdminLayout>
  );
}
function AssetWorkspace() {
  const model = useAssetWorkspace();
  const { error, busy, drafts, versions, contracts, draft, manifest, reload, open, run, create } =
    model;
  return (
    <>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>已发布资源</h2>
        <div className="asset-table-scroll">
          <table>
            <thead>
              <tr>
                <th>资源包</th>
                <th>状态</th>
                <th>引用</th>
                <th>管理</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <td>
                    {version.name}
                    <br />
                    {version.packId}@{version.version}
                  </td>
                  <td>{version.status}</td>
                  <td>{version.references ?? 0}</td>
                  <td>
                    {!version.builtin && (
                      <>
                        <button
                          disabled={busy || version.status === 'archived'}
                          onClick={() =>
                            void run(async () => {
                              await api.assets.archive(version.id);
                              await reload();
                            })
                          }
                        >
                          归档
                        </button>
                        <button
                          className="danger"
                          disabled={busy || (version.references ?? 0) > 0}
                          onClick={() => {
                            if (
                              confirm(
                                `删除 ${version.packId}@${version.version}？引用数 ${version.references ?? 0}。字节将在延迟清理后删除。`,
                              )
                            )
                              void run(async () => {
                                await api.assets.remove(version.id);
                                await reload();
                              });
                          }}
                        >
                          删除
                        </button>
                        {(version.references ?? 0) > 0 && (
                          <span>保留对局或房间引用中，只能归档</span>
                        )}
                      </>
                    )}
                    {version.builtin && '内置 · 不可删除'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="panel">
        <summary>创建资源草稿</summary>
        <form
          className="asset-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void run(() => create(form));
          }}
        >
          <label>
            游戏
            <select name="gameId">
              {contracts.map((item) => (
                <option key={item.contract.gameId}>{item.contract.gameId}</option>
              ))}
            </select>
          </label>
          <label>
            包 ID
            <input
              name="packId"
              required
              pattern="[a-z0-9][a-z0-9.-]*"
              maxLength={128}
              placeholder="my-color-theme"
            />
          </label>
          <label>
            版本
            <input name="version" required defaultValue="1.0.0" />
          </label>
          <label>
            显示名称
            <input name="name" required maxLength={80} />
          </label>
          <label>
            作者
            <input name="author" required maxLength={120} />
          </label>
          <label>
            来源
            <input name="source" required maxLength={500} />
          </label>
          <label>
            许可
            <input name="license" required maxLength={500} defaultValue="CC0-1.0" />
          </label>
          <label>
            复制现有映射
            <select name="copy">
              <option value="">空白映射</option>
              {versions.map((version) => (
                <option value={version.id} key={version.id}>
                  {version.name} · {version.version}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>创建草稿</button>
        </form>
      </details>
      <section className="panel">
        <h2>草稿</h2>
        <div className="asset-draft-list">
          {drafts.map((item) => (
            <button
              className="secondary"
              key={item.id}
              disabled={busy}
              onClick={() => void run(() => open(item.id))}
            >
              {item.manifest.name} · {item.manifest.version} · {item.status}
            </button>
          ))}
        </div>
      </section>
      {draft && manifest && <AssetDraftEditor {...model} />}
    </>
  );
}
