import { useState, type FormEvent } from 'react';
import type { ModelProfile } from '@boardgame/protocol';

export type BotSettings = { controllerType: 'model'; profileId: string } | { controllerType: 'script'; policyId: 'basic-v1' };

export function BotSeatSettings({ editing, policyId, profileId, profiles, loading, error, save, refresh, remove }: {
  editing: boolean;
  policyId: string | null;
  profileId: string | null;
  profiles: ModelProfile[];
  loading: boolean;
  error: string;
  save: (settings: BotSettings) => void;
  refresh: () => void;
  remove?: () => void;
}) {
  const [type, setType] = useState(editing && policyId !== 'model' ? 'script' : 'model');
  const [selectedProfile, setSelectedProfile] = useState(profileId ?? '');
  const available = profiles.filter(profile => profile.enabled && (profile.has_credential || profile.endpoint_id === 'mock'));
  const selected = selectedProfile || available[0]?.id || '';
  const usable = available.some(profile => profile.id === selected);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (type === 'model' && !usable) return;
    save(type === 'model' ? { controllerType: 'model', profileId: selected } : { controllerType: 'script', policyId: 'basic-v1' });
  }

  return <details className="bot-settings">
    <summary>{editing ? 'AI 设置' : '选择模型 AI'}</summary>
    <form className="form-stack" onSubmit={submit}>
      <label>AI 类型<select value={type} onChange={event => setType(event.target.value)}>
        <option value="script">基础脚本 AI</option>
        <option value="model">模型 AI</option>
      </select></label>
      {type === 'model' && <>
        <label>模型配置<select value={selected} disabled={loading || available.length === 0} onChange={event => setSelectedProfile(event.target.value)}>
          {!usable && <option value={selected}>{selected ? '原配置不可用，请重新选择' : '请先创建模型配置'}</option>}
          {available.map(profile => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.official_offer_id
                ? profile.official_token_pricing
                  ? ` · 按 token 计费，单次最多 ${profile.official_points_per_action} 点`
                  : ` · ${profile.official_points_per_action} 点/行动`
                : ` · ${profile.model_id}`}
              {profile.endpoint_id === 'mock' ? '（模拟）' : ''}
            </option>
          ))}
        </select></label>
        <p className="muted">使用房主的模型配置与额度；模型会收到此 AI 座位可见的游戏信息，并持续操作到对局结束。</p>
        {available.find(profile => profile.id === selected)?.official_offer_id && <p className="muted">从房主的 AI 点数扣费，此席位单局上限 {available.find(profile => profile.id === selected)?.official_match_budget} 点。余额或上限不足时暂停付费 AI。</p>}
        <a href="/official-ai">选择官方 AI / 查看点数</a>
        {loading && <p role="status">正在读取模型配置…</p>}
        {error && <p role="alert">{error}</p>}
        <a href="/settings/models">管理模型配置</a>
        <button type="button" className="secondary" onClick={refresh}>刷新模型列表</button>
      </>}
      <button className="secondary" disabled={type === 'model' && (loading || !usable)}>
        {editing ? '保存 AI 设置' : type === 'model' ? '添加模型 AI' : '添加脚本 AI'}
      </button>
      {remove && <button type="button" className="secondary" onClick={remove}>移除 AI</button>}
    </form>
  </details>;
}
