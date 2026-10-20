import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import {createApp} from '../../apps/api/src/app.js';
import {createDatabase,type Database} from '../../apps/api/src/db/index.js';
import {createRegistry} from '../../apps/api/src/registry/index.js';
import {createAccount} from '../../apps/api/src/auth.js';
import {colorMatchExtension} from '@boardgame/color-match/server';
import {randomUUID} from 'node:crypto';
import {winningPosition} from '../fixtures/color-match-win.js';

process.loadEnvFile('.env');
const url=process.env.TEST_DATABASE_URL;const origin='http://127.0.0.1:5173';
type Session={cookie:string;csrf:string};

describe.skipIf(!url)('stage 5 script AI and delegation',()=>{
  let db:Database;let app:Awaited<ReturnType<typeof createApp>>;
  async function startApp(){db=createDatabase(url!);app=await createApp({config:{NODE_ENV:'test',API_HOST:'127.0.0.1',API_PORT:3001,DATABASE_URL:url!,WEB_ORIGIN:origin,ENABLE_DEV_LAB:false,LOG_LEVEL:'silent',AI_SCAN_INTERVAL_MS:100,AI_DECISION_TIMEOUT_MS:1000},db,registry:createRegistry(false)});}

  afterAll(()=>app.close());
  beforeEach(async()=>{if(app)await app.close();const cleanup=createDatabase(url!);try{await cleanup.query('TRUNCATE accounts CASCADE');}finally{await cleanup.end();}await startApp();await createAccount(db,{username:'alice',displayName:'Alice',password:'correct horse battery',role:'user'});});
  async function login():Promise<Session>{const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'alice',password:'correct horse battery'}});const raw=response.headers['set-cookie'];const values=Array.isArray(raw)?raw:[String(raw)];return{cookie:values.map(value=>value.split(';')[0]).join('; '),csrf:response.json().data.csrfToken};}
  const write=(method:string,path:string,session:Session,payload:unknown)=>app.inject({method:method as any,url:path,headers:{origin,cookie:session.cookie,'x-csrf-token':session.csrf},payload});
  const read=(path:string,session:Session)=>app.inject({url:path,headers:{cookie:session.cookie}});
  async function waitFor<T>(readValue:()=>Promise<T>,accept:(value:T)=>boolean,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){const value=await readValue();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('timed out waiting for AI');}

  it('rejects human script delegation and finishes with a human playing alongside a bot',async()=>{
    const alice=await login();const created=await write('POST','/api/v1/rooms',alice,{requestId:'ai-create',name:'AI table',gameId:'color-match',version:'1.0.0',options:{},seatCount:2});
    expect(created.statusCode).toBe(200);const roomId=created.json().data.roomId as string;const botSeat=created.json().data.room.seats[1];
    const added=await write('PUT',`/api/v1/rooms/${roomId}/seats/${botSeat.seatId}/bot`,alice,{requestId:'add-bot',expectedRoomRevision:0,policyId:'basic-v1'});expect(added.statusCode).toBe(200);expect(added.json().data.seats[1]).toMatchObject({occupantKind:'bot',ownerAccountId:null,ready:true});
    const ready=await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,alice,{requestId:'ready',expectedRoomRevision:1,ready:true});expect(ready.statusCode).toBe(200);
    const started=await write('POST',`/api/v1/rooms/${roomId}/start`,alice,{requestId:'start',expectedRoomRevision:2});expect(started.statusCode).toBe(200);const matchId=started.json().data.matchId as string;
    const bot=await db.query<{account_id:string|null;occupant_kind:string;controller_type:string}>('SELECT account_id,occupant_kind,controller_type FROM match_participants WHERE match_id=$1 AND seat_id=$2',[matchId,botSeat.seatId]);expect(bot.rows[0]).toEqual({account_id:null,occupant_kind:'bot',controller_type:'script'});
    const delegated=await write('PUT',`/api/v1/matches/${matchId}/my-controller`,alice,{requestId:'delegate',expectedControllerEpoch:0,controllerType:'script',policyId:'basic-v1'});
    expect(delegated.statusCode).toBe(403);
    expect((await read(`/api/v1/matches/${matchId}/view`,alice)).json().data.controller).toMatchObject({type:'human',controllerEpoch:0});
    const ended=await waitFor(async()=>{
      const view=(await read(`/api/v1/matches/${matchId}/view`,alice)).json().data;
      if(view.status==='active'){
        const action=colorMatchExtension.getFallbackAction(view.view,{});
        if(action)expect((await write('POST',`/api/v1/matches/${matchId}/actions`,alice,{requestId:randomUUID(),expectedRevision:view.revision,expectedControllerEpoch:0,action})).statusCode).toBe(200);
      }
      return view;
    },(view:any)=>view.status==='finished');
    expect(ended.revision).toBeGreaterThan(1);
    expect(ended.view.phase).toBe('finished');
    expect(ended.players.map((player: { displayName: string }) => player.displayName)).toEqual(['Alice', '电脑 2']);
    await db.query("UPDATE seats SET bot_name='新电脑' WHERE id=$1", [botSeat.seatId]);
    const recoveredNames = (await read(`/api/v1/matches/${matchId}/view`, alice)).json().data.players;
    expect(recoveredNames[1]).toEqual({
      seatId: botSeat.seatId, seatIndex: 1, displayName: '电脑 2', occupantKind: 'bot',
    });

    const tasks=await db.query<{count:string;duplicates:string}>(`SELECT count(*)::text AS count,(count(*)-count(DISTINCT (match_id,seat_id,source_revision,controller_epoch,decision_key)))::text AS duplicates FROM ai_tasks WHERE match_id=$1`,[matchId]);expect(Number(tasks.rows[0]!.count)).toBeGreaterThan(1);expect(tasks.rows[0]!.duplicates).toBe('0');
    expect(JSON.stringify(ended)).not.toContain('proposed_action');
    const room=(await read(`/api/v1/rooms/${roomId}`,alice)).json().data;
    expect(room).toMatchObject({status:'waiting',activeMatchId:null,matchStatus:null});
    expect(room.seats.map((seat:{ready:boolean})=>seat.ready)).toEqual([false,true]);
    expect((await write('POST',`/api/v1/rooms/${roomId}/leave`,alice,{requestId:'leave-finished',expectedRoomRevision:room.roomRevision})).statusCode).toBe(200);
    expect((await db.query<{status:string}>('SELECT status FROM rooms WHERE id=$1',[roomId])).rows[0]!.status).toBe('closed');
    expect((await write('POST','/api/v1/rooms',alice,{requestId:'next-game',name:'Next',gameId:'color-match',version:'1.0.0',options:{},seatCount:2})).statusCode).toBe(200);
  },20000);

  it('terminates a looping policy worker and submits one legal fallback action',async()=>{
    const alice=await login();const created=await write('POST','/api/v1/rooms',alice,{requestId:'timeout-create',name:'Fallback',gameId:'color-match',version:'1.0.0',options:{},seatCount:2});const roomId=created.json().data.roomId as string;const botSeat=created.json().data.room.seats[1];
    await write('PUT',`/api/v1/rooms/${roomId}/seats/${botSeat.seatId}/bot`,alice,{requestId:'timeout-bot',expectedRoomRevision:0,policyId:'basic-v1'});await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,alice,{requestId:'timeout-ready',expectedRoomRevision:1,ready:true});const started=await write('POST',`/api/v1/rooms/${roomId}/start`,alice,{requestId:'timeout-start',expectedRoomRevision:2});const matchId=started.json().data.matchId as string;
    await db.query("UPDATE match_participants SET policy_id='fixture-timeout',policy_hash='test-timeout' WHERE match_id=$1 AND seat_id=$2",[matchId,botSeat.seatId]);
    const acted=await write('POST',`/api/v1/matches/${matchId}/actions`,alice,{requestId:'human-draw',expectedRevision:0,expectedControllerEpoch:0,action:{type:'draw_card'}});expect(acted.statusCode).toBe(200);
    const task=await waitFor(async()=>{const result=await db.query<{status:string;safe_error_code:string|null;applied_revision:number|null}>("SELECT status,safe_error_code,applied_revision FROM ai_tasks WHERE match_id=$1 AND seat_id=$2 AND source_revision=1 LIMIT 1",[matchId,botSeat.seatId]);return result.rows[0];},value=>value?.status==='succeeded',5000);
    expect(task).toMatchObject({status:'succeeded',safe_error_code:'AI_FALLBACK_USED',applied_revision:2});
    expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1 AND revision=2',[matchId])).rows[0]!.count).toBe('1');
    expect((await db.query('SELECT actor_seat_id,internal_events FROM match_replay_frames WHERE match_id=$1 AND revision=2',[matchId])).rows[0]).toMatchObject({actor_seat_id:botSeat.seatId});
  },10000);

  it('restarts from one frozen proposal and keeps its action and request id',async()=>{
    const alice=await login();const created=await write('POST','/api/v1/rooms',alice,{requestId:'restart-create',name:'Restart',gameId:'color-match',version:'1.0.0',options:{},seatCount:2});const roomId=created.json().data.roomId as string;const botSeat=created.json().data.room.seats[1];
    await write('PUT',`/api/v1/rooms/${roomId}/seats/${botSeat.seatId}/bot`,alice,{requestId:'restart-bot',expectedRoomRevision:0,policyId:'basic-v1'});await write('PUT',`/api/v1/rooms/${roomId}/my-ready`,alice,{requestId:'restart-ready',expectedRoomRevision:1,ready:true});const started=await write('POST',`/api/v1/rooms/${roomId}/start`,alice,{requestId:'restart-start',expectedRoomRevision:2});const matchId=started.json().data.matchId as string;
    await write('POST',`/api/v1/matches/${matchId}/actions`,alice,{requestId:'before-restart',expectedRevision:0,expectedControllerEpoch:0,action:{type:'draw_card'}});
    const bot=await db.query<{policy_id:string;policy_version:string;policy_hash:string}>('SELECT policy_id,policy_version,policy_hash FROM match_participants WHERE match_id=$1 AND seat_id=$2',[matchId,botSeat.seatId]);
    await app.close();db=createDatabase(url!);const taskId=randomUUID(),requestId=randomUUID();
    await db.query('DELETE FROM ai_tasks WHERE match_id=$1',[matchId]);
    const saved=(await db.query<{state:unknown;revision:number}>('SELECT state,revision FROM matches WHERE id=$1',[matchId])).rows[0]!;
    const win=winningPosition(saved.state,botSeat.seatId);
    await db.query('UPDATE matches SET state=$2 WHERE id=$1',[matchId,win.state]);
    await db.query(`INSERT INTO ai_tasks(id,match_id,seat_id,source_revision,controller_epoch,decision_key,policy_id,policy_version,policy_hash,status,lease_owner,lease_until,lease_generation,request_id,proposed_action,proposal_hash) VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,'proposed','dead-worker',now()-interval '1 second',1,$9,$10,'frozen')`,[taskId,matchId,botSeat.seatId,saved.revision,`play:${botSeat.seatId}`,bot.rows[0]!.policy_id,bot.rows[0]!.policy_version,bot.rows[0]!.policy_hash,requestId,win.action]);
    await db.end();await startApp();
    const recovered=await waitFor(async()=>{const result=await db.query<{status:string;request_id:string;proposed_action:unknown;applied_revision:number|null}>('SELECT status,request_id,proposed_action,applied_revision FROM ai_tasks WHERE id=$1',[taskId]);return result.rows[0];},value=>value?.status==='succeeded',5000);
    expect(recovered).toMatchObject({status:'succeeded',request_id:requestId,proposed_action:win.action,applied_revision:saved.revision+1});expect((await db.query<{count:string}>('SELECT count(*) FROM match_actions WHERE match_id=$1 AND revision=$2',[matchId,saved.revision+1])).rows[0]!.count).toBe('1');
    expect((await read(`/api/v1/rooms/${roomId}`,alice)).json().data).toMatchObject({status:'waiting',activeMatchId:null});
    expect((await read(`/api/v1/matches/${matchId}/view`,alice)).json().data.status).toBe('finished');
    const finalResult = (await read(`/api/v1/matches/${matchId}/view`, alice)).json().data.result;
    expect(finalResult.players.find((player: { seatId: string }) => player.seatId === botSeat.seatId)).toEqual({ seatId: botSeat.seatId, winner: true });
    expect((await read('/api/v1/profile/matches', alice)).json().data.items[0].result).toEqual({ winner: false, sharedWin: false });
  },10000);
});
