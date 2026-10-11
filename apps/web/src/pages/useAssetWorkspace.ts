import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssetDraft } from '@boardgame/client-sdk';
import type { AssetFile, AssetVersionInfo } from '@boardgame/protocol/assets';
import { type AssetContract, type PackManifest } from '@boardgame/game-sdk/assets';
import { api, command } from '../platform.js';
import { AssetResolver } from '../assets/resolver.js';
import { AudioManager } from '../assets/audio-manager.js';
import { assetPreviews } from '../game-registry.js';
export function useAssetWorkspace() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<AssetDraft[]>([]),
    [versions, setVersions] = useState<AssetVersionInfo[]>([]);
  const [contracts, setContracts] = useState<
    Array<{
      contract: AssetContract;
      hash: string;
    }>
  >([]);
  const [draft, setDraft] = useState<AssetDraft>(),
    [manifest, setManifest] = useState<PackManifest>(),
    [files, setFiles] = useState<AssetFile[]>([]);
  const [json, setJson] = useState(''),
    [uploadStatus, setUploadStatus] = useState(''),
    [preview, setPreview] = useState<ReactNode>(),
    [previewRevision, setPreviewRevision] = useState<number>();
  const [previewVolume, setPreviewVolume] = useState(0.3);
  const upload = useRef<AbortController | undefined>(undefined),
    audio = useRef(new AudioManager());
  const contract = contracts.find((item) => item.contract.gameId === manifest?.gameId)?.contract;
  async function reload() {
    const [ds, vs] = await Promise.all([api.assets.drafts(), api.assets.versions(undefined, true)]);
    setDrafts(ds);
    setVersions(vs);
  }
  function select(value: AssetDraft) {
    setDraft(value);
    setManifest(value.manifest);
    setJson(JSON.stringify(value.manifest, null, 2));
    setPreview(undefined);
    setPreviewRevision(undefined);
    audio.current.clear();
  }
  async function open(id: string) {
    const [value, fs] = await Promise.all([api.assets.draft(id), api.assets.files(id)]);
    select(value);
    setFiles(fs);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let disposed = false;
    void api.assets
      .contracts()
      .then(async (contracts) => {
        if (disposed) return;
        setContracts(contracts);
        await reload();
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : '读取失败');
      });
    const manager = audio.current;
    const hide = () => {
      if (document.hidden) manager.invalidate();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      disposed = true;
      upload.current?.abort();
      manager.dispose();
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  const change = (value: PackManifest) => {
    setManifest(value);
    setJson(JSON.stringify(value, null, 2));
    setPreview(undefined);
    setPreviewRevision(undefined);
    audio.current.invalidate();
  };
  async function create(form: HTMLFormElement) {
    const data = new FormData(form),
      game = contracts.find((item) => item.contract.gameId === String(data.get('gameId')));
    if (!game) throw new Error('请选择游戏');
    const copy = String(data.get('copy') ?? '');
    const manifest: PackManifest = {
      schemaVersion: 1,
      packId: String(data.get('packId')),
      version: String(data.get('version')),
      gameId: game.contract.gameId,
      name: String(data.get('name')),
      author: String(data.get('author')),
      source: String(data.get('source')),
      license: String(data.get('license')),
      assetContract: {
        id: game.contract.id,
        version: game.contract.version,
        hash: game.hash,
      },
      assets: {},
      sounds: {},
    };
    const made = await api.assets.create({
      requestId: command(),
      manifest,
      ...(copy ? { copyVersionId: copy } : {}),
    });
    await reload();
    await open(made.id);
  }
  async function save() {
    if (!draft || !manifest) return;
    const saved = await api.assets.edit(draft.id, {
      requestId: command(),
      expectedDraftRevision: draft.revision,
      manifestText: JSON.stringify(manifest),
    });
    select(saved);
    await reload();
  }
  async function uploadFiles(list: FileList) {
    if (!draft) return;
    const controller = new AbortController();
    upload.current = controller;
    let done = 0;
    try {
      for (const file of Array.from(list)) {
        if (controller.signal.aborted) break;
        setUploadStatus(`正在上传并校验 ${file.name}（${done}/${list.length}）`);
        await api.assets.upload(draft.id, file, controller.signal);
        done++;
        setFiles(await api.assets.files(draft.id));
      }
      setUploadStatus(
        controller.signal.aborted
          ? '上传已取消，请刷新文件状态确认服务端结果。'
          : `已处理 ${done} 个文件；请检查各文件状态。`,
      );
    } catch (cause) {
      setUploadStatus(
        controller.signal.aborted ? '上传已取消，请刷新文件状态。' : '上传失败，已成功文件仍保留。',
      );
      throw cause;
    } finally {
      upload.current = undefined;
    }
  }
  async function showPreview() {
    if (!draft || !manifest) return;
    const loader = assetPreviews[manifest.gameId];
    if (!loader) throw new Error('该游戏尚未声明固定预览');
    setPreview((await loader())(new AssetResolver(manifest)));
    setPreviewRevision(draft.revision);
  }
  const unsaved =
    !!draft && !!manifest && JSON.stringify(draft.manifest) !== JSON.stringify(manifest);
  return {
    error,
    busy,
    drafts,
    versions,
    contracts,
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
    create,
    save,
    uploadFiles,
    showPreview,
    unsaved,
  };
}
