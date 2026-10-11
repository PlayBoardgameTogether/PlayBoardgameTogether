import { parseAssetJson, packManifestSchema } from '@boardgame/game-sdk/assets';
import { api, command } from '../platform.js';
import type { useAssetWorkspace } from './useAssetWorkspace.js';
type Props = Pick<
  ReturnType<typeof useAssetWorkspace>,
  | 'error'
  | 'busy'
  | 'draft'
  | 'setDraft'
  | 'manifest'
  | 'setManifest'
  | 'files'
  | 'json'
  | 'setJson'
  | 'uploadStatus'
  | 'preview'
  | 'setPreview'
  | 'previewRevision'
  | 'previewVolume'
  | 'setPreviewVolume'
  | 'upload'
  | 'audio'
  | 'contract'
  | 'reload'
  | 'select'
  | 'open'
  | 'run'
  | 'change'
  | 'save'
  | 'uploadFiles'
  | 'showPreview'
  | 'unsaved'
>;
export function AssetDraftEditor({
  busy,
  draft,
  setDraft,
  manifest,
  setManifest,
  files,
  json,
  setJson,
  uploadStatus,
  preview,
  setPreview,
  previewRevision,
  previewVolume,
  setPreviewVolume,
  upload,
  audio,
  contract,
  reload,
  select,
  open,
  run,
  change,
  save,
  uploadFiles,
  showPreview,
  unsaved,
}: Props) {
  if (!draft || !manifest) return null;
  return (
    <section className="panel asset-editor">
      <h2>
        {manifest.name} · {manifest.version}
      </h2>
      <p>
        {manifest.packId} · 契约 {manifest.assetContract.id}@{manifest.assetContract.version} · 草稿{' '}
        {draft.revision}
      </p>
      <p>
        {files.length} 个可用/上传记录 ·{' '}
        {Math.round(files.reduce((sum, file) => sum + file.bytes, 0) / 1024)} KiB
      </p>
      <label>
        上传图片或短音效
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav"
          disabled={busy || draft.status === 'published'}
          onChange={(event) => {
            if (event.target.files) {
              const list = event.target.files;
              void run(() => uploadFiles(list));
            }
          }}
        />
      </label>
      {uploadStatus && <p role="status">{uploadStatus}</p>}
      {busy && upload.current && <button onClick={() => upload.current?.abort()}>取消上传</button>}
      <div className="asset-file-grid">
        {files.map((file) => (
          <article key={file.id}>
            <strong>{file.originalName}</strong>
            <p>
              {file.status} · {file.bytes} bytes
            </p>
            {file.error && <p className="error-notice">{file.error}</p>}
            {file.status === 'validated' &&
              (file.kind === 'image' ? (
                <img
                  src={`/api/v1/assets/files/${file.id}`}
                  alt={file.originalName}
                  loading="lazy"
                />
              ) : (
                <button
                  onClick={() =>
                    void audio.current
                      .unlock()
                      .then(() => audio.current.playFile(`/api/v1/assets/files/${file.id}`))
                  }
                >
                  试听 {file.originalName}
                </button>
              ))}
            <small>
              {file.metadata.width
                ? `${file.metadata.width} × ${file.metadata.height}`
                : `${file.metadata.durationMs ?? 0} ms`}
            </small>
          </article>
        ))}
      </div>
      <h3>映射表</h3>
      <div className="asset-table-scroll">
        <table>
          <thead>
            <tr>
              <th>槽位</th>
              <th>要求</th>
              <th>文件</th>
              <th>媒体信息</th>
            </tr>
          </thead>
          <tbody>
            {contract?.slots.map((slot) => {
              const file = files.find((file) => file.id === manifest.assets[slot.key]?.fileId);
              return (
                <tr key={slot.key}>
                  <td>
                    {slot.label}
                    <br />
                    <code>{slot.key}</code>
                  </td>
                  <td>
                    {slot.kind} · {slot.required ? '必需' : '可选'}
                  </td>
                  <td>
                    <select
                      aria-label={slot.key}
                      disabled={busy || draft.status === 'published'}
                      value={manifest.assets[slot.key]?.fileId ?? ''}
                      onChange={(event) => {
                        const assets = { ...manifest.assets };
                        if (event.target.value)
                          assets[slot.key] = {
                            kind: slot.kind,
                            fileId: event.target.value,
                          };
                        else delete assets[slot.key];
                        change({ ...manifest, assets });
                      }}
                    >
                      <option value="">{slot.required ? '缺失' : '静音 / 无'}</option>
                      {files
                        .filter((file) => file.status === 'validated' && file.kind === slot.kind)
                        .map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.originalName}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    {file
                      ? file.kind === 'image'
                        ? `${file.metadata.width} × ${file.metadata.height}`
                        : `${file.metadata.durationMs} ms`
                      : slot.required
                        ? '缺少必需资源'
                        : '可省略'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>声音事件</h3>
      {contract?.cues.map((cue) => (
        <label key={cue.id}>
          {cue.id}
          <select
            aria-label={cue.id}
            disabled={busy || draft.status === 'published'}
            value={manifest.sounds[cue.id]?.assetKey ?? ''}
            onChange={(event) => {
              const sounds = { ...manifest.sounds };
              if (event.target.value)
                sounds[cue.id] = {
                  assetKey: event.target.value,
                  gain: 0.7,
                  cooldownMs: 100,
                };
              else delete sounds[cue.id];
              change({ ...manifest, sounds });
            }}
          >
            <option value="">静音</option>
            {contract.slots
              .filter((slot) => slot.kind === 'audio' && manifest.assets[slot.key])
              .map((slot) => (
                <option key={slot.key}>{slot.key}</option>
              ))}
          </select>
        </label>
      ))}
      <details>
        <summary>JSON 映射导入 / 编辑</summary>
        <textarea
          aria-label="JSON 映射"
          rows={16}
          value={json}
          onChange={(event) => setJson(event.target.value)}
          disabled={draft.status === 'published'}
        />
        <input
          type="file"
          accept="application/json,.json"
          disabled={draft.status === 'published'}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void run(async () => {
                if (file.size > 256 * 1024) throw new Error('JSON 超过 256 KiB');
                const text = await file.text();
                change(packManifestSchema.parse(parseAssetJson(text)));
              });
          }}
        />
        <button
          disabled={busy || draft.status === 'published'}
          onClick={() =>
            void run(async () => {
              change(packManifestSchema.parse(parseAssetJson(json)));
            })
          }
        >
          应用 JSON 到表单
        </button>
      </details>
      <div className="asset-toolbar">
        <button
          disabled={busy || draft.status === 'published' || !unsaved}
          onClick={() => void run(save)}
        >
          保存映射
        </button>
        <button
          disabled={busy || unsaved || draft.status === 'published'}
          onClick={() =>
            void run(async () => {
              select(
                await api.assets.validate(draft.id, {
                  requestId: command(),
                  expectedDraftRevision: draft.revision,
                }),
              );
              await reload();
            })
          }
        >
          校验草稿
        </button>
        <button disabled={busy || unsaved} onClick={() => void run(showPreview)}>
          固定场景预览
        </button>
        <button
          disabled={
            busy || unsaved || draft.status !== 'ready' || previewRevision !== draft.revision
          }
          onClick={() =>
            void run(async () => {
              await api.assets.publish(draft.id, {
                requestId: command(),
                expectedDraftRevision: draft.revision,
                contentHash: draft.content_hash!,
              });
              await reload();
              await open(draft.id);
            })
          }
        >
          发布精确版本
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (confirm('删除此草稿及其未发布映射？已发布版本仍保留，未引用文件延迟清理。'))
              void run(async () => {
                await api.assets.removeDraft(draft.id, draft.revision);
                setDraft(undefined);
                setManifest(undefined);
                setPreview(undefined);
                audio.current.clear();
                await reload();
              });
          }}
        >
          删除草稿
        </button>
      </div>
      {unsaved && <p>有未保存修改，旧校验和预览不能用于发布。</p>}
      <h3>校验报告</h3>
      {draft.report.errors.map((message) => (
        <p className="error-notice" key={message}>
          {message}
        </p>
      ))}
      {draft.report.warnings.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {draft.status === 'ready' && <p>校验通过 · {draft.content_hash}</p>}
      {preview && (
        <section className="asset-preview">
          <h2>演示预览 · 不是真实对局</h2>
          <label>
            预览音量
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={previewVolume}
              onChange={(event) => {
                const value = Number(event.target.value);
                setPreviewVolume(value);
                audio.current.setPreferences({ muted: false, game: value, ui: value }, false);
              }}
            />
          </label>
          {contract?.cues.map((cue) => (
            <button
              key={cue.id}
              onClick={() =>
                void audio.current
                  .unlock()
                  .then(() => audio.current.play(cue.id, manifest, contract, true))
              }
            >
              试听 {cue.id}
            </button>
          ))}
          <button
            className="secondary"
            onClick={() => {
              setPreview(undefined);
              audio.current.clear();
            }}
          >
            关闭预览
          </button>
          {preview}
        </section>
      )}
    </section>
  );
}
