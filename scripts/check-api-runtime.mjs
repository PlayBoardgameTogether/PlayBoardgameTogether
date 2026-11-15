import { Worker } from 'node:worker_threads';
import { setTimeout, clearTimeout } from 'node:timers';
import { createRegistry } from '../apps/api/dist/registry/index.js';
import { PackageRuntime } from '../apps/api/dist/registry/package-runtime.js';
import { readFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import { DeterministicRng } from '@boardgame/game-sdk';
import { releaseCapabilities } from './runtime-compatibility.mjs';
import { packagePublicResultContractSchema } from '../apps/api/dist/registry/package-public-result.js';

const registry = createRegistry(false);
if (!registry.get('demo.counter-room', '1.0.0') || !registry.hasResourcePack('demo.counter-room', '1.0.0')) {
  throw new Error('Production API registry cannot load the room game and its resources');
}
console.log('production API loads compiled game modules and resources');

const runtime = await PackageRuntime.create();
const capabilities = await releaseCapabilities(fileURLToPath(new URL('..', import.meta.url)));
if (JSON.stringify(capabilities) !== JSON.stringify([packagePublicResultContractSchema.value])) {
  throw new Error('Release capabilities do not match the compiled package runtime');
}
const projected = runtime.publicResult('var game = { getPublicResult: function(outcome) { return { winners: outcome.winners }; } };')(
  { status: 'finished', winners: ['a'] }, ['a', 'b'],
);
if (!projected?.players[0]?.winner || projected.players[1]?.winner) {
  throw new Error('Production public result projection is unavailable');
}
console.log('production runtime verifies advertised package result capabilities');
const extension = runtime.extension(await readFile(new URL('../apps/api/game-package-example/server.txt', import.meta.url), 'utf8'));
const initial = extension.setup({ seats: ['a', 'b'], options: extension.validateOptions({}), rng: new DeterministicRng(123) });
const updated = extension.applyAction(initial.state, { kind: 'seat', seatId: 'a', controllerEpoch: 0 }, { type: 'claim' }, new DeterministicRng(123));
const view = extension.getView(extension.deserialize(extension.serialize(updated.state)), { kind: 'seat', seatId: 'b' });
if (!view.canClaim || view.scores[0] < 1) throw new Error('Production package runtime cannot execute and restore the uploaded game contract');
console.log('production API runs isolated ZIP rules and restores serialized state');

const uno = runtime.extension(await readFile(new URL('../game-packages/uno/server.txt', import.meta.url), 'utf8'));
const unoState = uno.setup({ seats: ['a', 'b'], options: {}, rng: new DeterministicRng(123) }).state;
const unoDecision = uno.getDecisionContext?.(unoState, { kind: 'seat', seatId: 'a' });
if (!unoDecision?.legalActions.length) throw new Error('Production online game AI context is unavailable');
uno.validateAction(unoState, { kind:'seat',seatId:'a',controllerEpoch:0 }, uno.parseAction(unoDecision.legalActions[0]));
async function checkWorker(gameId, view, legalActions) {
  const worker = new Worker(new URL('../apps/api/src/ai-policy-worker.mjs', import.meta.url), { execArgv:['--conditions=production'] });
  let timer;
  try {
    const reply = await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Production policy worker timed out')),5000);
      worker.once('message',resolve);worker.once('error',reject);
      worker.postMessage({gameId,policyId:'basic-v1',view,legalActions});
    });
    if (!reply.ok || !legalActions.some(action=>JSON.stringify(action)===JSON.stringify(reply.action))) throw new Error('Production AI policy did not choose a legal action');
  } finally { clearTimeout(timer); await worker.terminate(); }
}
await checkWorker(uno.manifest.id,uno.getView(unoState,{kind:'seat',seatId:'a'}),unoDecision.legalActions);
const color = registry.get('color-match','1.0.0');
const colorState = color.setup({seats:['a','b'],options:color.validateOptions({}),rng:new DeterministicRng(123)}).state;
const colorDecision = color.getDecisionContext(colorState,{kind:'seat',seatId:'a'});
await checkWorker(color.manifest.id,color.getView(colorState,{kind:'seat',seatId:'a'}),colorDecision.legalActions);
console.log('production API supports online AI context and generic/built-in policy workers');
