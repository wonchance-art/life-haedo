/* Optional integration runner: real Chromium, SDK, application and IndexedDB;
 * anonymous Supabase HTTP simulator (NOT evidence of live SQL/RLS security).
 * Start npm run dev, then node tests/life-sync-browser.cjs.
 * Uses an existing Playwright installation, never installs application packages.
 */
'use strict';
const assert = require('node:assert/strict');
const base = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('Local anonymous test server required.');
const cloud = 'https://life-sync-test.supabase.co';
const publicKey = 'sb_publishable_anonymous_browser_test_only';
const password = 'anonymous-browser-password';
const accounts = {
  a:{id:'11111111-1111-4111-8111-111111111111',email:'device-a@example.invalid'},
  b:{id:'22222222-2222-4222-8222-222222222222',email:'device-b@example.invalid'}
};
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH,'playwright','playwright-core','/opt/codex/cua_node/lib/node_modules/playwright','/opt/codex/cua_node/lib/node_modules/playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
const copy = value => JSON.parse(JSON.stringify(value));
function user(account) {
  return {...account,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
}
function token(account) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:account.id,aud:'authenticated',role:'authenticated',iss:`${cloud}/auth/v1`,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})}.anonymous-test-signature`;
}
function session(account) {
  return {access_token:token(account),refresh_token:`test-refresh-${account.id}`,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(account)};
}

class FakeCloud {
  constructor() {
    this.rows = new Map(); this.receipts = new Map(); this.requests = [];
    this.offline = new Set(); this.loseResponses = new Set(); this.schemaMissing = false;
    this.expectedFailures = 0; this.heldRead = null;
    this.oauthAccounts = new Map(); this.codes = new Map();
  }
  key(owner,id) { return `${owner}:${id}`; }
  row(owner,id) { return this.rows.get(this.key(owner,id)); }
  writes(owner,id) { return this.requests.filter(r => r.kind === 'write' && (!owner || r.owner === owner) && (!id || r.id === id)); }
  async attach(context,device) {
    await context.route(`${cloud}/**`,route => this.handle(route,device));
  }
  async handle(route,device) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
    const send = (body,status=200) => route.fulfill({status,headers,body:status === 204 ? '' : JSON.stringify(body)});
    if (method === 'OPTIONS') return send(null,204);
    if (this.offline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
    if (url.pathname === '/auth/v1/settings') return send({external:{google:true},disable_signup:false});
    if (url.pathname === '/auth/v1/authorize') {
      const target = new URL(url.searchParams.get('redirect_to'));
      if (target.origin !== new URL(base).origin) throw new Error('OAuth fixture redirect escaped localhost');
      const code = `anonymous-code-${this.codes.size+1}`;
      this.codes.set(code,this.oauthAccounts.get(device) || accounts.a);
      target.searchParams.set('code',code);
      return route.fulfill({status:302,headers:{...headers,location:target.href},body:''});
    }
    const bearer = request.headers().authorization?.replace(/^Bearer /i,'');
    let account = Object.values(accounts).find(item => token(item) === bearer);
    // Tokens survive reload and the wall-clock second in their issued JWT can differ.
    if (!account && bearer?.includes('.')) {
      try { const payload = JSON.parse(Buffer.from(bearer.split('.')[1],'base64url')); account = Object.values(accounts).find(item => item.id === payload.sub); } catch (_) {}
    }
    let body = {};
    if (request.postData()) { try { body = request.postDataJSON(); } catch (_) {} }
    if (url.pathname === '/auth/v1/token') {
      account = url.searchParams.get('grant_type') === 'pkce' ? this.codes.get(body.auth_code) : url.searchParams.get('grant_type') === 'refresh_token'
        ? Object.values(accounts).find(item => body.refresh_token === `test-refresh-${item.id}`)
        : Object.values(accounts).find(item => item.email === body.email && body.password === password);
      this.requests.push({kind:'login',device});
      return account ? send(session(account)) : send({code:'invalid_credentials',message:'Anonymous test login rejected'},400);
    }
    if (url.pathname === '/auth/v1/user') return account ? send(user(account)) : send({code:'bad_jwt',message:'No test account'},401);
    if (url.pathname === '/auth/v1/logout') {this.requests.push({kind:'logout',device,owner:account?.id});return send(null,204);}
    if (!account) return send({code:'PGRST301',message:'No test account'},401);
    if (this.schemaMissing) { this.expectedFailures++; return send({code:'PGRST205',message:'Anonymous test schema is unavailable'},404); }
    if (url.pathname === '/rest/v1/life_workspaces') {
      const id = url.searchParams.get('id')?.replace(/^eq\./,'');
      this.requests.push({kind:id ? 'read' : 'list',owner:account.id,id,device});
      const rows = [...this.rows.values()].filter(row => row.owner_id === account.id && (!id || row.id === id));
      const result = rows.map(row => {
        const value = copy(row); delete value.owner_id;
        if (!url.searchParams.get('select')?.split(',').includes('data')) delete value.data;
        return value;
      });
      if (this.heldRead?.device === device && this.heldRead.id === id) {
        const held = this.heldRead; this.heldRead = null; held.entered(); await held.release;
      }
      // PostgREST maybeSingle GET requests use an array then SDK converts it.
      if (request.headers().accept?.includes('vnd.pgrst.object')) return send(result[0] || null);
      return send(result);
    }
    if (url.pathname === '/rest/v1/rpc/life_sync_put' && method === 'POST') {
      const {p_workspace_id:id,p_expected_revision:expected,p_operation_id:operation,p_data:data} = body;
      this.requests.push({kind:'write',owner:account.id,id,operation,expected,device});
      const key = this.key(account.id,id), receiptKey = `${key}:${operation}`, payload = JSON.stringify({expected,data});
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.payload !== payload) return send({code:'operation_mismatch',message:'Anonymous request mismatch'},400);
        if (this.loseResponses.has(device)) { this.expectedFailures++; return route.abort('failed'); }
        return send(receipt.result);
      }
      const old = this.rows.get(key);
      let result;
      if (!old && expected !== 0) result = {status:'missing'};
      else if (old && old.revision !== expected) result = {status:'conflict',revision:old.revision};
      else {
        result = {status:'stored',revision:(old?.revision || 0)+1};
        this.rows.set(key,{owner_id:account.id,id,title:data.title,revision:result.revision,data:copy(data),updated_at:new Date().toISOString()});
        this.receipts.set(receiptKey,{payload,result});
      }
      if (this.loseResponses.has(device)) { this.expectedFailures++; return route.abort('failed'); }
      return send(result);
    }
    throw new Error(`Unexpected anonymous HTTP request: ${method} ${url.pathname}`);
  }
}

async function platformContext(context,server,device,seed=accounts.a) {
  await server.attach(context,device);
  await context.route(`${base}/assets/platform-config.js`,route=>route.fulfill({contentType:'application/javascript',body:`window.HAEDO_CONFIG=Object.freeze(${JSON.stringify({url:cloud,key:publicKey})});`}));
  for (const pattern of ['https://fonts.googleapis.com/**','https://fonts.gstatic.com/**','https://cdn.jsdelivr.net/**']) {
    await context.route(pattern,route=>route.fulfill({contentType:'text/css',body:''}));
  }
  if (seed) await context.addInitScript(({value,origin})=>{
    if(location.origin!==origin)return;
    if(!localStorage.getItem('anonymous-platform-fixture-seeded')) {
      localStorage.setItem('caeyeon_life_platform_session',JSON.stringify(value));
      localStorage.setItem('anonymous-platform-fixture-seeded','1');
    }
  },{value:session(seed),origin:new URL(base).origin});
}

const failures = [], unexpectedErrors = [];
let passed = 0, expectedConsoleErrors = 0;
async function check(name,action) {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}\n${error.stack}`); }
}
function observe(page) {
  page.on('pageerror',error => unexpectedErrors.push(`page: ${error.message}`));
  page.on('console',message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url;
    if (url.startsWith(cloud) && /^Failed to load resource:/.test(text) && /net::ERR_(FAILED|INTERNET_DISCONNECTED|ABORTED)|status of 404/.test(text)) expectedConsoleErrors++;
    else unexpectedErrors.push(`console: ${text}`);
  });
}
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.sync);
  await page.evaluate(() => HaedoLife.Shell.ready);
  await page.locator('.life-app').waitFor();
}
async function settle(page) { await page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]')); }
async function openManagement(page) {
  const button = page.getByRole('button',{name:'자료 관리',exact:true});
  if (await button.getAttribute('aria-expanded') !== 'true') { await button.click(); await settle(page); }
}
async function openAccount(page) {
  const toggle = page.locator('#lifeAccountToggle');
  if (!(await toggle.evaluate(el => el.closest('details').open))) await toggle.click();
}
async function click(page,name) {
  if (['기기 간 동기화','내보내기·사본 복원','시간 보기'].includes(name)) await openManagement(page);
  if (name === '로그아웃') await openAccount(page);
  await page.getByRole('button',{name,exact:true}).click(); await settle(page);
}
async function state(page,id) { return page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id),id); }
async function bundle(page,id) { return page.evaluate(id => HaedoLife.Shell.storage.read(id),id); }
async function syncNow(page,id) {
  return page.evaluate(async id => {
    try { await HaedoLife.Shell.sync.syncNow(id); return null; }
    catch (error) { return {code:error.code,message:error.message}; }
  },id);
}
async function append(page,id,title,text=title) {
  return page.evaluate(async ({id,title,text}) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, current = await s.read(id);
    const prepared = await c.prepareImport({origin:'other',title,text},current);
    const result = await s.commitLocal({operationId:c.id(),workspaceId:id,baseRevision:current.revision,changes:c.buildImportChanges(current,prepared,[])});
    if (result.status !== 'stored') throw new Error(`Local fixture commit ${result.status}`);
    return result;
  },{id,title,text});
}
async function loginUI(page,account=accounts.a,server,device) {
  const current=await page.evaluate(()=>globalThis.HaedoAuth?.user?.id);
  if(current!==account.id){
    if(!server)throw new Error('Account-switch fixture requires the HTTP simulator.');
    server.oauthAccounts.set(device,account);
    await page.goto(`${base}/login.html?next=life.html`);await page.locator('#googleLogin').click();
    await page.waitForURL('**/life.html');await ready(page);
  }
  await click(page,'기기 간 동기화');
  await page.waitForFunction(userId => HaedoLife.Shell.sync.getAccount()?.userId === userId,account.id);
}

async function main() {
  const browser = await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const server = new FakeCloud();
  const contexts = [];
  async function device(name) {
    const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1100,height:900}});
    contexts.push(context); await platformContext(context,server,name);
    const page = await context.newPage(); page.setDefaultTimeout(10000); observe(page);
    await page.goto(`${base}/life.html`); await ready(page);
    return {context,page,name};
  }
  try {
    const a = await device('a'), b = await device('b');
    const id = await a.page.evaluate(() => HaedoLife.Shell.storage.getActive());
    await check('login alone never uploads local work; explicit opt-in uploads',async () => {
      await append(a.page,id,'익명 첫 자료');
      assert.equal(server.requests.length,0,'authentication alone issued workspace data requests');
      await loginUI(a.page);
      assert.equal(server.writes().length,0,'login uploaded an unbound workspace');
      assert.equal(await state(a.page,id),null);
      await click(a.page,'이 작업공간 동기화 시작'); await syncNow(a.page,id);
      assert.equal(server.row(accounts.a.id,id).data.sources.length,1);
      assert.equal((await state(a.page,id)).status,'synced');
    });
    await check('second browser explicitly downloads same IDs without uploading its empty workspace',async () => {
      const localId = await b.page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await loginUI(b.page); assert.equal(server.writes().length,1);
      await click(b.page,'서버 작업공간 목록 확인');
      await b.page.locator('#lifeRemoteList').getByRole('button',{name:'이 작업공간 받기',exact:true}).click(); await settle(b.page);
      assert.equal(await b.page.evaluate(() => HaedoLife.Shell.storage.getActive()),id);
      const first = await bundle(a.page,id), second = await bundle(b.page,id);
      assert.equal(second.sources[0].id,first.sources[0].id);
      assert.equal(second.sourceVersions[0].id,first.sourceVersions[0].id);
      assert.equal((await bundle(b.page,localId)).sources.length,0);
      assert.equal(server.writes().length,1);
    });
    await check('offline durable outbox survives lost write response and reload, replay is idempotent',async () => {
      try {
        server.offline.add('a'); await a.context.setOffline(true);
        await append(a.page,id,'오프라인 추가'); await syncNow(a.page,id);
        let pending = await state(a.page,id);
        const local = await bundle(a.page,id);
        assert.equal(local.sources.length,2);
        assert.notEqual(pending.syncedLocalRevision,local.revision,'offline edit lost durable dirty marker');
        server.loseResponses.add('a'); server.offline.delete('a'); await a.context.setOffline(false);
        await syncNow(a.page,id);
        assert.equal(server.row(accounts.a.id,id).revision,2);
        pending = await state(a.page,id); assert.ok(pending.outbox,'uncertain write lost durable request');
        const operation = pending.outbox.operationId;
        await append(a.page,id,'응답 대기 중 추가');
        assert.equal((await state(a.page,id)).outbox.operationId,operation);
        assert.equal((await state(a.page,id)).outbox.data.sources.length,2,'later edit changed saved request contents');
        await a.page.reload(); await ready(a.page);
        await a.page.waitForFunction(() => HaedoLife.Shell.sync.getAccount()?.userId === '11111111-1111-4111-8111-111111111111');
        server.loseResponses.delete('a'); await syncNow(a.page,id);
        assert.equal((await state(a.page,id)).outbox,null);
        assert.equal((await state(a.page,id)).status,'synced');
        assert.equal(server.row(accounts.a.id,id).revision,3,'retry failed to reuse receipt before the next local edit');
        assert.equal(server.row(accounts.a.id,id).data.sources.length,3);
        assert.ok(server.writes(accounts.a.id,id).filter(r => r.operation === operation).length >= 2);
      } finally { server.offline.delete('a'); server.loseResponses.delete('a'); await a.context.setOffline(false); }
    });
    await check('clean pull retains saved and currently edited local import drafts',async () => {
      await click(b.page,'가져오기');
      await b.page.locator('#lifeImportTitle').fill('기기 B 검토 초안');
      await b.page.locator('#lifeImportText').fill('아직 통합하지 않은 익명 본문');
      await click(b.page,'검토 내용 보관');
      await syncNow(b.page,id);
      assert.equal((await bundle(b.page,id)).sources.length,3);
      assert.equal(await b.page.locator('#lifeImportText').inputValue(),'아직 통합하지 않은 익명 본문');
      const stages = await b.page.evaluate(id => HaedoLife.Shell.storage.listStages(id),id);
      assert.ok(stages.some(s => s.input.title === '기기 B 검토 초안' && s.state === 'draft'));
    });
    await check('cold load without Auth verification stays locked until explicit re-verification',async () => {
      const before = await bundle(a.page,id);
      server.offline.add('a');
      try {
        // Keep the local static server reachable; only Auth/REST are unavailable.
        // This tests boot recovery independently of the separately tested SW cache.
        await a.page.reload();await a.page.waitForFunction(()=>globalThis.HaedoLife?.Shell);await a.page.evaluate(()=>HaedoLife.Shell.ready);
        assert.equal(await a.page.evaluate(()=>HaedoLife.Shell.storage),null);
        assert.ok(await a.page.locator('#lifeApp').isHidden());
        server.offline.delete('a');
        await click(a.page,'다시 확인');await ready(a.page);
        await a.page.waitForFunction(() => HaedoLife.Shell.sync.getAccount()?.userId === '11111111-1111-4111-8111-111111111111');
        await syncNow(a.page,id);
        assert.deepEqual(await bundle(a.page,id),before);
        assert.equal((await state(a.page,id)).status,'synced');
      } finally { server.offline.delete('a'); }
    });
    await check('conflict remote choice preserves unselected local content in a separate unbound copy',async () => {
      server.offline.add('b'); await b.context.setOffline(true);
      await append(b.page,id,'B 충돌 전용 자료'); await syncNow(b.page,id);
      await append(a.page,id,'A 서버 변경'); await syncNow(a.page,id);
      server.offline.delete('b'); await b.context.setOffline(false); await syncNow(b.page,id);
      assert.equal((await state(b.page,id)).status,'conflict');
      const before = await bundle(b.page,id);
      const beforeIds = await b.page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w=>w.workspaceId));
      await click(b.page,'기기 간 동기화'); await click(b.page,'양쪽 변경 비교');
      assert.ok(await b.page.locator('#lifeSyncConflict .life-conflict-content').count() >= 2);
      await click(b.page,'서버 변경 받기 · 내 변경은 사본 보관');
      const current = await bundle(b.page,id);
      assert.ok(current.sources.some(s => s.title === 'A 서버 변경'));
      assert.ok(!current.sources.some(s => s.title === 'B 충돌 전용 자료'));
      const copies = await b.page.evaluate(async beforeIds => (await HaedoLife.Shell.storage.listWorkspaces()).filter(w => !beforeIds.includes(w.workspaceId)),beforeIds);
      assert.equal(copies.length,1);
      const savedCopy = await bundle(b.page,copies[0].workspaceId);
      assert.deepEqual(savedCopy.sourceVersions.map(v=>v.contentText).sort(),before.sourceVersions.map(v=>v.contentText).sort());
      assert.equal(await state(b.page,copies[0].workspaceId),null);
      assert.ok(savedCopy.sources.every(source => !before.sources.some(old=>old.id===source.id)));
    });
    await check('conflict local choice preserves the remote version as a separate copy before CAS upload',async () => {
      server.offline.add('b'); await b.context.setOffline(true);
      await append(b.page,id,'B 선택할 로컬 변경'); await syncNow(b.page,id);
      await append(a.page,id,'A 보존할 서버 변경'); await syncNow(a.page,id);
      const remoteBefore = copy(server.row(accounts.a.id,id));
      server.offline.delete('b'); await b.context.setOffline(false); await syncNow(b.page,id);
      assert.equal((await state(b.page,id)).status,'conflict');
      const beforeIds = await b.page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w=>w.workspaceId));
      await click(b.page,'기기 간 동기화'); await click(b.page,'양쪽 변경 비교');
      await click(b.page,'내 변경 보내기 · 서버 변경은 사본 보관'); await syncNow(b.page,id);
      assert.ok(server.row(accounts.a.id,id).data.sources.some(s=>s.title==='B 선택할 로컬 변경'));
      assert.ok(!server.row(accounts.a.id,id).data.sources.some(s=>s.title==='A 보존할 서버 변경'));
      const copies = await b.page.evaluate(async ids => (await HaedoLife.Shell.storage.listWorkspaces()).filter(w=>!ids.includes(w.workspaceId)),beforeIds);
      assert.equal(copies.length,1);
      assert.deepEqual((await bundle(b.page,copies[0].workspaceId)).sourceVersions.map(v=>v.contentText).sort(),remoteBefore.data.sourceVersions.map(v=>v.contentText).sort());
      assert.equal(await state(b.page,copies[0].workspaceId),null);
    });
    await check('pause and logout keep local work/outbox; another account cannot upload the old binding',async () => {
      await click(b.page,'기기 간 동기화'); await click(b.page,'연결 중지');
      const requests = server.writes().length;
      await append(b.page,id,'중지 중 로컬 변경'); await syncNow(b.page,id);
      assert.equal(server.writes().length,requests); assert.equal((await state(b.page,id)).enabled,false);
      await click(b.page,'로그아웃');await b.page.waitForFunction(()=>location.pathname.endsWith('/index.html')&&document.readyState==='complete');
      assert.equal(await b.page.evaluate(()=>HaedoAuth.user),null);
      await loginUI(b.page,accounts.b,server,'b'); await syncNow(b.page,id);
      assert.equal(server.writes(accounts.b.id,id).length,0);
      const rejected = await b.page.evaluate(async id => {
        try { await HaedoLife.Shell.sync.enable(id); return null; } catch(error) { return error.code; }
      },id);
      assert.ok(rejected,'replacement account enabled a workspace it cannot own');
      assert.ok(!(await b.page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces())).some(w=>w.workspaceId===id));
      await click(b.page,'로그아웃');await b.page.waitForFunction(()=>location.pathname.endsWith('/index.html')&&document.readyState==='complete');
      await loginUI(b.page,accounts.a,server,'b');
      assert.equal((await state(b.page,id)).enabled,false);
      assert.ok((await bundle(b.page,id)).sources.some(s=>s.title==='중지 중 로컬 변경'));
    });
    await check('late response from old account cannot apply after account switch',async () => {
      let enter, release;
      const entered = new Promise(resolve=>{enter=resolve;});
      const gate = new Promise(resolve=>{release=resolve;});
      server.heldRead = {device:'a',id,entered:enter,release:gate};
      try {
        await a.page.evaluate(id => { window.__oldSync = HaedoLife.Shell.sync.syncNow(id).catch(error=>({code:error.code})); },id);
        let timeout;
        try { await Promise.race([entered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('late-read fixture did not reach REST')),10000);})]); }
        finally { clearTimeout(timeout); }
        await click(a.page,'로그아웃');await a.page.waitForFunction(()=>location.pathname.endsWith('/index.html')&&document.readyState==='complete');
        await loginUI(a.page,accounts.b,server,'a');
        const replacementId=await a.page.evaluate(()=>HaedoLife.Shell.storage.getActive()),before=await bundle(a.page,replacementId);
        release();
        assert.deepEqual(await bundle(a.page,replacementId),before,'old response altered the replacement account workspace');
        assert.ok(!(await a.page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces())).some(w=>w.workspaceId===id));
        assert.equal(await a.page.evaluate(()=>HaedoLife.Shell.sync.getAccount().userId),accounts.b.id);
        assert.equal(server.writes(accounts.b.id,id).length,0);
      } finally { release(); server.heldRead=null; }
    });
    await check('remote original-text hash mismatch cannot install or overwrite local data',async () => {
      const c = await device('integrity'); await loginUI(c.page);
      const original = copy(server.row(accounts.a.id,id));
      const before = await c.page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces());
      server.row(accounts.a.id,id).data.sourceVersions[0].contentText += '변조';
      try {
        const rejected = await c.page.evaluate(async id => {
          try { await HaedoLife.Shell.sync.download(id); return null; } catch(error) { return error.code; }
        },id);
        assert.equal(rejected,'hash_mismatch');
        assert.deepEqual(await c.page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces()),before);
      } finally { server.rows.set(server.key(accounts.a.id,id),original); }
    });
    await check('real IDB: sync metadata abort rolls back local commit and a saved outbox survives two-tab preparation',async () => {
      const fixture = await b.page.evaluate(async projectUrl => {
        const s=HaedoLife.Shell.storage,c=HaedoLife.Core,local=await s.createWorkspace('익명 원자경계');
        const binding={projectUrl,userId:HaedoAuth.user.id,remoteId:local.workspaceId};
        await s.bindSync(local.workspaceId,binding);
        const prepared=await c.prepareImport({origin:'other',title:'원자 저장',text:'익명 원자 저장 본문'},local);
        const request={operationId:c.id(),workspaceId:local.workspaceId,baseRevision:local.revision,changes:c.buildImportChanges(local,prepared,[])};
        const original=IDBObjectStore.prototype.put; let injected=false;
        IDBObjectStore.prototype.put=function(...args) {
          const result=original.apply(this,args);
          if(this.name==='meta' && args[0].key===`sync:${local.workspaceId}`){injected=true;this.transaction.abort();}
          return result;
        };
        let result; try{result=await s.commitLocal(request);}finally{IDBObjectStore.prototype.put=original;}
        if(!injected || result.status!=='rejected' || (await s.read(local.workspaceId)).sources.length!==0) throw new Error('metadata failure leaked local commit');
        if((await s.commitLocal(request)).status!=='stored') throw new Error('same ID retry failed');
        return {id:local.workspaceId,binding};
      },cloud);
      const other=await b.context.newPage();observe(other);
      try {
        await other.goto(`${base}/life.html?view-only=1`);
        await other.waitForFunction(()=>globalThis.HaedoLife?.Storage);
        await other.evaluate(binding=>{window.__testScope=HaedoLife.Storage.forAccount(binding);},fixture.binding);
        const prepare=({id,binding})=>(HaedoLife.Shell.storage||window.__testScope).prepareSyncUpload(id,binding);
        const [one,two]=await Promise.all([b.page.evaluate(prepare,fixture),other.evaluate(prepare,fixture)]);
        assert.deepEqual(one,two,'two tabs created different operation IDs for the same pending snapshot');
        assert.equal(one.data.sources.length,1);
      } finally {await other.close();}
    });
    await check('backup excludes connection, auth session, password and sync metadata',async () => {
      const backup = await b.page.evaluate(async id => HaedoLife.Core.makeBackup(await HaedoLife.Shell.storage.read(id)),id);
      const serialized = JSON.stringify(backup);
      for (const forbidden of [publicKey,password,cloud,'access_token','refresh_token','syncedLocalRevision','outbox']) assert.ok(!serialized.includes(forbidden),`backup leaked ${forbidden === password ? 'test password' : forbidden}`);
    });
    await check('schema_missing remains a local-preserving UI error with setup guidance',async () => {
      server.schemaMissing = true;
      const before = await bundle(b.page,id);
      await click(b.page,'기기 간 동기화'); await click(b.page,'서버 작업공간 목록 확인');
      const content = await b.page.locator('#lifeApp').textContent();
      assert.match(content,/저장소가 준비|스키마|SQL|연결 도움말/);
      assert.deepEqual(await bundle(b.page,id),before);
      server.schemaMissing = false;
    });
    await check('unexpected browser console/page errors',async () => assert.deepEqual(unexpectedErrors,[]));
  } finally {
    await Promise.all(contexts.map(context=>context.close())); await browser.close();
  }
  console.log(`Sync browser checks: ${passed} passed, ${failures.length} failed; ${expectedConsoleErrors} expected transport/schema console errors. HTTP simulator only; live RLS and Apple hardware not proven.`);
  if (failures.length) process.exitCode=1;
}
module.exports={FakeCloud,platformContext,session,accounts,cloud,publicKey,password,base,openManagement,openAccount};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
