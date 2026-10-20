import type { MatchResult } from '@boardgame/protocol';
import { publicResult } from './public-results.js';
import { azulExtension, azulAssetManifest } from '@boardgame/azul/server';
import { publicRules as azulRules } from '@boardgame/azul/rules';
import { azulAssetContract, azulPresentationCues } from '@boardgame/azul/assets';
import { splendorExtension, splendorAssetManifest } from '@boardgame/splendor/server';
import { publicRules as splendorRules } from '@boardgame/splendor/rules';
import { splendorAssetContract } from '@boardgame/splendor/assets';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assetManifestSchema, manifestSchema, type GameExtension } from '@boardgame/game-sdk';
import { counterAssetManifest, counterRoomExtension, testCounterExtension } from '@boardgame/test-counter/server';
import { colorAssetManifest, colorMatchExtension } from '@boardgame/color-match/server';
import { publicRules as counterRules } from '@boardgame/test-counter/rules';
import { publicRules as colorRules } from '@boardgame/color-match/rules';
import { colorAssetContract, colorPresentationCues } from '@boardgame/color-match/assets';
import { gridGardenExtension } from '@boardgame/grid-garden/server';
import { gridGardenAssetManifest } from '@boardgame/grid-garden/server';
import { publicRules as gridGardenRules } from '@boardgame/grid-garden/rules';
import { gridGardenAssetContract, gridGardenPresentationCues } from '@boardgame/grid-garden/assets';
import type { AssetContract, PresentationCue } from '@boardgame/game-sdk/assets';

export type AnyExtension = GameExtension<any, any, any, any, any, any> & { getDecisionRequests?(state: any): Array<{ seatId: string; decisionKey: string }> };
export class GameRegistry {
  readonly resultSummaries = new Map<string, (outcome: unknown, seats: string[]) => MatchResult | null>();
  readonly assetContracts = new Map<string, AssetContract>();
  readonly presentation = new Map<string, (events: Array<Record<string, unknown>>, view: unknown) => PresentationCue[]>();
  readonly entries = new Map<string, AnyExtension>();
  readonly rules = new Map<string, string>();
  private resourcePacks = new Set<string>();
  private digests = new Map<string, { rule: string; resource: string }>();
  register(raw: AnyExtension, resourcePack?:unknown, ruleSources: URL[] = [], packageSource?: Uint8Array) { const manifest = manifestSchema.parse(raw.manifest); if (!manifest.sdkRange.startsWith('^0.1.')) throw new Error(`Incompatible SDK range for ${manifest.id}: ${manifest.sdkRange}`); const key = `${manifest.id}@${manifest.version}`; if (this.entries.has(key)) throw new Error(`Duplicate game registration: ${key}`); let resource = ''; if(resourcePack){const pack=assetManifestSchema.parse(resourcePack);if(pack.id!==manifest.defaultAssetPack.id||pack.version!==manifest.defaultAssetPack.version)throw new Error(`Default resource pack mismatch for ${key}`);this.resourcePacks.add(key);resource = createHash('sha256').update(JSON.stringify(pack)).digest('hex');}const hash=createHash('sha256').update(JSON.stringify(manifest));for(const source of ruleSources)hash.update(readFileSync(source));if (packageSource) hash.update(packageSource);const rule=hash.digest('hex');this.digests.set(key,{rule,resource});this.entries.set(key, raw); }
  get(id: string, version: string) { return this.entries.get(`${id}@${version}`); }
  digest(id: string, version: string) { return this.digests.get(`${id}@${version}`); }
  hasResourcePack(id:string,version:string){return this.resourcePacks.has(`${id}@${version}`);}
  manifests() { return [...this.entries.values()].map(e => e.manifest); }
}
export function createRegistry(includeDevelopment: boolean) {
  const registry = new GameRegistry();
  for (const key of [
    'azul.base@1.0.0',
    'splendor.base@1.0.0',
    'color-match@1.0.0',
    'grid-garden@1.0.0',
    'demo.counter-room@1.0.0',
  ]) {
    registry.resultSummaries.set(key, publicResult);
  }
  registry.assetContracts.set('azul.base', azulAssetContract);
  registry.presentation.set('azul.base', azulPresentationCues);
  registry.rules.set('azul.base@1.0.0', azulRules);
  registry.assetContracts.set('splendor.base', splendorAssetContract);
  registry.assetContracts.set('color-match', colorAssetContract);
  registry.presentation.set('color-match', colorPresentationCues);
  registry.assetContracts.set('grid-garden', gridGardenAssetContract);
  registry.presentation.set('grid-garden', gridGardenPresentationCues);
  const sdk = new URL('../../../../packages/game-sdk/src/index.ts', import.meta.url);
  registry.register(azulExtension, azulAssetManifest, [
    sdk,
    new URL('../../../../games/azul/src/shared/index.ts', import.meta.url),
    new URL('../../../../games/azul/src/server/index.ts', import.meta.url),
  ]);
  const counterSources = [
    sdk,
    new URL('../../../../games/test-counter/src/shared/index.ts', import.meta.url),
    new URL('../../../../games/test-counter/src/server/index.ts', import.meta.url),
  ];
  const colorSources = [
    sdk,
    new URL('../../../../games/color-match/src/shared/index.ts', import.meta.url),
    new URL('../../../../games/color-match/src/server/index.ts', import.meta.url),
  ];
  const gardenSources = [
    sdk,
    new URL('../../../../games/grid-garden/src/shared/index.ts', import.meta.url),
    new URL('../../../../games/grid-garden/src/server/index.ts', import.meta.url),
  ];
  const splendorSources = [
    sdk,
    new URL('../../../../games/splendor/src/shared/index.ts', import.meta.url),
    new URL('../../../../games/splendor/src/shared/catalog.ts', import.meta.url),
    new URL('../../../../games/splendor/src/server/index.ts', import.meta.url),
  ];

  registry.rules.set('splendor.base@1.0.0', splendorRules);
  registry.register(counterRoomExtension, counterAssetManifest, counterSources);
  registry.register(colorMatchExtension, colorAssetManifest, colorSources);
  registry.register(gridGardenExtension, gridGardenAssetManifest, gardenSources);
  registry.register(splendorExtension, splendorAssetManifest, splendorSources);

  registry.rules.set('demo.counter-room@1.0.0', counterRules);
  registry.rules.set('color-match@1.0.0', colorRules);
  registry.rules.set('grid-garden@1.0.0', gridGardenRules);
  if (includeDevelopment) registry.rules.set('demo.test-counter@0.1.0', counterRules);
  if (includeDevelopment) registry.register(testCounterExtension, counterAssetManifest, counterSources);
  return registry;
}
