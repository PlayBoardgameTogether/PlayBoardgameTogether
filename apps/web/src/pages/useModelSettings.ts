import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@boardgame/client-sdk';
import type { ModelEndpoint, ModelProfile } from '@boardgame/protocol';
import { api, navigate } from '../platform.js';
import {
  PROVIDER_PRESETS,
  detectProvider,
  type PresetModel,
  type ProviderPreset,
} from './model-presets.js';
type Draft = {
  name: string;
  endpointId: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature: number | '';
  maxOutputTokens: number | '';
  enabled: boolean;
};
const emptyDraft = (): Draft => ({
  name: '',
  endpointId: 'openai',
  baseUrl: '',
  modelId: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.5,
  maxOutputTokens: 256,
  enabled: true,
});
const message = (cause: unknown) => (cause instanceof Error ? cause.message : '操作失败，请重试');
type TestResult = {
  error?: string;
  success?: string;
  latencyMs?: number;
};
export function useModelSettings() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);
  const [credentialsAvailable, setCredentialsAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  // UI state
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>('openai');
  const [filterType, setFilterType] = useState<'all' | 'real' | 'mock' | 'uncredentialed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const formSectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    void api
      .me()
      .then(() =>
        Promise.all([api.modelProfiles(), api.modelEndpoints(), api.modelSettingsStatus()]),
      )
      .then(([saved, catalog, status]) => {
        if (!active) return;
        setProfiles(saved);
        setEndpoints(catalog);
        setCredentialsAvailable(status.credentialsAvailable);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') navigate('/login');
        else setLoadError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const isMock = draft.endpointId === 'mock';
  const originalEndpoint = editing?.endpoint_id.startsWith('custom-')
    ? 'custom'
    : editing?.endpoint_id;
  const endpointChanged =
    editing !== null &&
    (draft.endpointId !== originalEndpoint ||
      (draft.endpointId === 'custom' &&
        draft.baseUrl.replace(/\/+$/, '') !== editing.base_url.replace(/\/+$/, '')));
  const needsKey = !isMock && (!editing?.has_credential || endpointChanged);
  const cannotSave = !isMock && !credentialsAvailable && (needsKey || !!draft.apiKey);
  function reset() {
    setEditing(null);
    setDraft(emptyDraft());
    setError('');
    setShowApiKey(false);
    setSelectedPresetId('openai');
  }
  function edit(profile: ModelProfile) {
    setEditing(profile);
    const endpointId = profile.endpoint_id.startsWith('custom-') ? 'custom' : profile.endpoint_id;
    setDraft({
      name: profile.name,
      endpointId,
      baseUrl: profile.base_url,
      modelId: profile.model_id,
      apiKey: '',
      temperature:
        typeof profile.parameters?.temperature === 'number' ? profile.parameters.temperature : '',
      maxOutputTokens:
        typeof profile.parameters?.maxOutputTokens === 'number'
          ? profile.parameters.maxOutputTokens
          : '',
      enabled: profile.enabled ?? true,
    });
    setError('');
    setNotice('');
    setDeleteId(null);
    setShowApiKey(false);
    if (
      profile.parameters?.temperature !== undefined ||
      profile.parameters?.maxOutputTokens !== undefined
    ) {
      setShowAdvanced(true);
    }
    const detected = detectProvider(profile.endpoint_id, profile.base_url);
    setSelectedPresetId(detected?.id ?? null);
    nameInput.current?.focus();
    formSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function clone(profile: ModelProfile) {
    setEditing(null);
    const endpointId = profile.endpoint_id.startsWith('custom-') ? 'custom' : profile.endpoint_id;
    setDraft({
      name: `${profile.name} (副本)`,
      endpointId,
      baseUrl: profile.base_url,
      modelId: profile.model_id,
      apiKey: '',
      temperature:
        typeof profile.parameters?.temperature === 'number' ? profile.parameters.temperature : '',
      maxOutputTokens:
        typeof profile.parameters?.maxOutputTokens === 'number'
          ? profile.parameters.maxOutputTokens
          : '',
      enabled: profile.enabled ?? true,
    });
    setError('');
    setNotice(`已基于「${profile.name}」载入配置，请设置新名称并保存。`);
    setDeleteId(null);
    setShowApiKey(false);
    if (
      profile.parameters?.temperature !== undefined ||
      profile.parameters?.maxOutputTokens !== undefined
    ) {
      setShowAdvanced(true);
    }
    const detected = detectProvider(profile.endpoint_id, profile.base_url);
    setSelectedPresetId(detected?.id ?? null);
    nameInput.current?.focus();
    formSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function applyPreset(preset: ProviderPreset) {
    setSelectedPresetId(preset.id);
    setDraft((current) => {
      const isDefaultName =
        !current.name ||
        PROVIDER_PRESETS.some(
          (p) => current.name.startsWith(p.shortName) || current.name.startsWith(p.name),
        );
      return {
        ...current,
        name: isDefaultName ? `${preset.shortName} 推荐配置` : current.name,
        endpointId: preset.endpointId,
        baseUrl: preset.baseUrl,
        modelId: preset.defaultModelId,
        temperature: preset.defaultTemperature,
        maxOutputTokens: preset.defaultMaxTokens,
      };
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const parameters: Record<string, number> = {};
      if (typeof draft.temperature === 'number') {
        parameters.temperature = draft.temperature;
      }
      if (typeof draft.maxOutputTokens === 'number') {
        parameters.maxOutputTokens = draft.maxOutputTokens;
      }
      const body = {
        name: draft.name.trim(),
        endpointId: draft.endpointId,
        modelId: draft.modelId.trim(),
        parameters,
        enabled: draft.enabled,
        ...(draft.endpointId === 'custom' ? { baseUrl: draft.baseUrl.trim() } : {}),
        ...(!isMock && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      };
      const saved = editing
        ? await api.updateModelProfile(editing.id, {
            ...body,
            expectedVersion: editing.profile_version,
          })
        : await api.createModelProfile(body);
      const name = draft.name;
      reset();
      setResults((current) => ({
        ...current,
        [saved.id]: { success: '配置已保存，尚未测试连接' },
      }));
      setNotice(`已保存「${name}」。可在下方测试连接或继续编辑。`);
      try {
        setProfiles(await api.modelProfiles());
      } catch {
        setError('保存已成功，但列表刷新失败，请刷新页面查看。');
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy('');
    }
  }
  async function action(profile: ModelProfile, kind: 'test' | 'delete' | 'revoke') {
    setBusy(`${kind}:${profile.id}`);
    setResults((current) => ({ ...current, [profile.id]: {} }));
    const startTime = performance.now();
    try {
      if (kind === 'test') {
        const result = await api.testModelProfile(profile.id);
        const elapsed = Math.round(performance.now() - startTime);
        const successText = result.kind === 'mock' ? `模拟连接测试通过` : `真实服务连接测试通过`;
        setResults((current) => ({
          ...current,
          [profile.id]: {
            success: successText,
            latencyMs: elapsed,
          },
        }));
      } else {
        if (kind === 'delete') {
          await api.deleteModelProfile(profile.id);
        } else {
          await api.revokeModelCredential(profile.id);
        }
        if (editing?.id === profile.id) reset();
        setDeleteId(null);
        setProfiles(await api.modelProfiles());
        setNotice(
          kind === 'delete'
            ? `已删除「${profile.name}」`
            : `已撤销「${profile.name}」的密钥，可通过编辑重新填写。`,
        );
      }
    } catch (cause) {
      setResults((current) => ({
        ...current,
        [profile.id]: { error: message(cause) },
      }));
    } finally {
      setBusy('');
    }
  }
  // Filter profiles based on search and pill
  const filteredProfiles = profiles.filter((profile) => {
    if (filterType === 'real' && profile.endpoint_id === 'mock') return false;
    if (filterType === 'mock' && profile.endpoint_id !== 'mock') return false;
    if (
      filterType === 'uncredentialed' &&
      (profile.has_credential || profile.endpoint_id === 'mock')
    )
      return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    return (
      profile.name.toLowerCase().includes(query) ||
      profile.model_id.toLowerCase().includes(query) ||
      profile.base_url.toLowerCase().includes(query)
    );
  });
  // Calculate metrics
  const totalCount = profiles.length;
  const readyCount = profiles.filter((p) => p.has_credential || p.endpoint_id === 'mock').length;
  const realCount = profiles.filter((p) => p.endpoint_id !== 'mock').length;
  const mockCount = profiles.filter((p) => p.endpoint_id === 'mock').length;
  const currentPreset = selectedPresetId
    ? PROVIDER_PRESETS.find((p) => p.id === selectedPresetId)
    : null;
  const availablePresetModels: PresetModel[] = currentPreset?.models ?? [];
  return {
    profiles,
    endpoints,
    credentialsAvailable,
    loading,
    loadError,
    draft,
    setDraft,
    editing,
    error,
    notice,
    busy,
    deleteId,
    setDeleteId,
    results,
    showApiKey,
    setShowApiKey,
    showAdvanced,
    setShowAdvanced,
    selectedPresetId,
    setSelectedPresetId,
    filterType,
    setFilterType,
    searchQuery,
    setSearchQuery,
    nameInput,
    formSectionRef,
    isMock,
    endpointChanged,
    needsKey,
    cannotSave,
    reset,
    edit,
    clone,
    applyPreset,
    save,
    action,
    filteredProfiles,
    totalCount,
    readyCount,
    realCount,
    mockCount,
    currentPreset,
    availablePresetModels,
  };
}
