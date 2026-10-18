const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const loaderSource = fs.readFileSync(path.join(__dirname, '../assets/life/interest-model-loader.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '../assets/life/interest-model-worker.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = () => Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
function environment() {
  const instances = [];
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.sent = []; this.terminated = false; instances.push(this); }
    postMessage(value) { this.sent.push(value); }
    terminate() { this.terminated = true; }
    reply(value, type = 'result', id = this.sent.at(-1).id) { this.onmessage?.({ data: { id, type, value } }); }
    error(code) { this.onmessage?.({ data: { id: this.sent.at(-1).id, type: 'error', code } }); }
  }
  const context = vm.createContext({ Worker, URL, AbortController, module: { exports: {} },
    document: { currentScript: { src: 'https://app.example/project/assets/life/interest-model-loader.js' } },
    fetch() { throw Error('Unexpected main-thread fetch'); } });
  vm.runInContext(loaderSource, context);
  const api = context.module.exports;
  return { api, instances };
}
async function prepare(env, owner = env.api.create()) {
  const loading = owner.loadModel(), worker = env.instances.at(-1);
  worker.reply({ modelId: env.api.manifest.modelId, modelRevision: env.api.manifest.modelRevision });
  return { owner, adapter: await loading, worker };
}

test('import/create are inert; explicit prepare owns one module worker and verifies identity', async () => {
  const env = environment(), owner = env.api.create();
  assert.equal(env.instances.length, 0);
  await assert.rejects(owner.loadModel({ modelRevision: 'main' }), { code: 'interest_model_unverified' });
  assert.equal(env.instances.length, 0);
  const { adapter, worker } = await prepare(env, owner);
  assert.equal(worker.url, 'https://app.example/project/assets/life/interest-model-worker.js');
  assert.equal(worker.options.type, 'module');
  assert.equal(worker.sent[0].type, 'prepare');
  assert.equal(worker.sent[0].modelRevision, env.api.manifest.modelRevision);
  assert.equal(await owner.loadModel(), adapter);
  assert.equal(env.instances.length, 1);
  await owner.dispose();
  assert.equal(worker.terminated, true);
});

test('abort during preparation terminates and permits retry; old messages cannot settle new load', async () => {
  const env = environment(), owner = env.api.create(), controller = new AbortController();
  const loading = owner.loadModel({ signal: controller.signal });
  const old = env.instances[0], late = old.onmessage, oldId = old.sent[0].id;
  controller.abort();
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  const retry = owner.loadModel(); // Old rejected continuations must not terminate this replacement.
  const current = env.instances[1];
  await rejected;
  assert.equal(old.terminated, true);
  late({ data: { id: oldId, type: 'result', value: { modelId: env.api.manifest.modelId, modelRevision: env.api.manifest.modelRevision } } });
  await flush();
  assert.equal(current.terminated, false);
  current.reply({ modelId: env.api.manifest.modelId, modelRevision: env.api.manifest.modelRevision });
  await retry;
  await owner.dispose();
});

test('abort active embedding interrupts WASM and the same adapter lazily prepares on retry', async () => {
  const env = environment(), { owner, adapter, worker } = await prepare(env);
  const controller = new AbortController(), embedding = adapter.embed(['비공개 합성 문장'], { signal: controller.signal });
  await flush();
  assert.equal(worker.sent.at(-1).type, 'embed');
  controller.abort();
  await assert.rejects(embedding, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  const retry = adapter.embed(['다시 읽을 문장']);
  const replacement = env.instances[1];
  assert.equal(replacement.sent[0].type, 'prepare');
  replacement.reply({ modelId: env.api.manifest.modelId, modelRevision: env.api.manifest.modelRevision });
  await flush();
  assert.equal(replacement.sent.at(-1).type, 'embed');
  replacement.reply([row()]);
  assert.equal((await retry)[0].length, 384);
  await owner.dispose();
});

test('disposed adapters cannot run or terminate a replacement; invalid and concurrent inputs are bounded', async () => {
  const env = environment(), { owner, adapter, worker } = await prepare(env);
  await assert.rejects(adapter.embed(Array(1)), { code: 'interest_embedding_invalid' });
  await assert.rejects(adapter.embed(['a'.repeat(4001)]), { code: 'interest_embedding_invalid' });
  await assert.rejects(adapter.embed(Array(33).fill('text')), { code: 'interest_embedding_invalid' });
  await assert.rejects(adapter.embed(Array(9).fill('a'.repeat(4000))), { code: 'interest_embedding_invalid' });
  assert.equal(worker.sent.length, 1);
  const first = adapter.embed(['text']); await flush();
  await assert.rejects(adapter.embed(['other']), { code: 'interest_model_busy' });
  const rejected = assert.rejects(first, { code: 'interest_model_disposed' });
  await adapter.dispose(); await rejected;
  const second = await prepare(env, owner);
  await adapter.dispose();
  assert.equal(second.worker.terminated, false);
  await assert.rejects(adapter.embed(['old']), { code: 'interest_model_disposed' });
  await owner.dispose();
});

test('observer exceptions and untrusted progress fields cannot break preparation; invalid vectors fail closed', async () => {
  const env = environment(), owner = env.api.create(), received = [];
  const loading = owner.loadModel({ onProgress(value) { received.push(value); throw Error('observer'); } });
  const worker = env.instances[0];
  worker.reply({ phase: 'verified', loaded: 12, file: 'private text', text: 'secret', url: 'https://private.example' }, 'progress');
  assert.equal(received.length, 1);
  assert.equal(received[0].text, undefined);
  assert.equal(received[0].file, undefined);
  worker.reply({ modelId: env.api.manifest.modelId, modelRevision: env.api.manifest.modelRevision });
  const adapter = await loading;
  const embedding = adapter.embed(['text']); await flush();
  worker.reply([[1, NaN]]);
  await assert.rejects(embedding, { code: 'interest_embedding_invalid' });
  await owner.dispose();
});

test('dispose or abort after a worker reply still discards its unsettled result', async () => {
  const env = environment(), { owner, adapter, worker } = await prepare(env);
  const first = adapter.embed(['synthetic']); await flush();
  worker.reply([row()]);
  const rejected = assert.rejects(first, { code: 'interest_model_disposed' });
  await owner.dispose(); await rejected;
  const next = await prepare(env, owner), controller = new AbortController();
  const embedding = next.adapter.embed(['synthetic'], { signal: controller.signal }); await flush();
  next.worker.reply([row()]); controller.abort();
  await assert.rejects(embedding, { name: 'AbortError' });
  await owner.dispose();
});

test('worker load/crash and provenance failures are recoverable without accepting foreign model identity', async () => {
  const env = environment(), owner = env.api.create();
  const load = owner.loadModel(), worker = env.instances[0];
  worker.reply({ modelId: 'foreign/model', modelRevision: env.api.manifest.modelRevision });
  await assert.rejects(load, { code: 'interest_model_unverified' });
  assert.equal(worker.terminated, true);
  const retry = owner.loadModel(), next = env.instances[1];
  next.onerror({ preventDefault() {} });
  await assert.rejects(retry, { code: 'interest_model_unavailable' });
  const good = await prepare(env, owner); await good.owner.dispose();
});

function workerEnvironment(options = {}) {
  const env = environment(), m = env.api.manifest, requests = [], messages = [], runtimeCalls = [], embedded = [];
  const runtime = { env: { backends: { onnx: { wasm: {} } } }, async pipeline(task, modelId, settings) {
    runtimeCalls.push({ task, modelId, settings });
    return async texts => { embedded.push(texts.slice()); return { tolist: () => texts.map(row) }; };
  } };
  let imports = 0;
  const context = vm.createContext({ URL, Headers, fetch: async (url, init) => {
    requests.push({ url, init });
    const body = url.includes('?blobs=true')
      ? { sha: m.modelRevision, cardData: { base_model: m.upstream }, siblings: [{ rfilename: 'onnx/model_quantized.onnx', lfs: { size: m.bytes, sha256: options.badHash ? 'wrong' : m.sha256 } }] }
      : { sha: m.upstreamRevision, cardData: { license: 'apache-2.0' } };
    return { ok: true, json: async () => body };
  }, postMessage(value) { messages.push(value); }, async __importRuntime() { imports++; return runtime; } });
  const importExpression = "await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js')";
  assert.ok(workerSource.includes(importExpression));
  // Replace only the remote module boundary; the real worker validation/network code runs unchanged.
  vm.runInContext(workerSource.replace(importExpression, 'await globalThis.__importRuntime()'), context);
  return { context, requests, messages, runtime, runtimeCalls, embedded, manifest: m, imports: () => imports };
}

test('worker verifies provenance before importing runtime and pins internal URLs on one CPU thread', async () => {
  const env = workerEnvironment(), m = env.manifest;
  assert.equal(env.requests.length, 0); assert.equal(env.imports(), 0);
  await env.context.onmessage({ data: { id: 1, type: 'prepare', modelId: m.modelId, modelRevision: m.modelRevision } });
  assert.equal(env.imports(), 1);
  assert.equal(env.requests.length, 2);
  assert.ok(env.requests.every(r => r.init.method === 'GET' && r.init.credentials === 'omit' && r.init.referrerPolicy === 'no-referrer' && !r.init.body));
  assert.equal(env.runtime.env.remotePathTemplate, '{model}/resolve/' + m.modelRevision + '/');
  assert.equal(env.runtime.env.backends.onnx.wasm.numThreads, 1);
  assert.equal(env.runtimeCalls[0].settings.dtype, 'q8');
  await env.context.onmessage({ data: { id: 2, type: 'embed', texts: Array(10).fill('합성 문장') } });
  assert.deepEqual(env.embedded.map(batch => batch.length), [8, 2]);
  assert.equal(env.requests.length, 2); // Input is sent only to the local pipeline.
  const result = env.messages.find(message => message.id === 2 && message.type === 'result');
  assert.equal(result.value.length, 10);
  const bad = workerEnvironment({ badHash: true });
  await bad.context.onmessage({ data: { id: 1, type: 'prepare', modelId: m.modelId, modelRevision: m.modelRevision } });
  assert.equal(bad.imports(), 0);
  assert.equal(bad.messages.at(-1).code, 'interest_model_unverified');
});

test('worker fetch rejects private hosts/main revisions/body requests and strips authorization/cookies', async () => {
  const env = workerEnvironment(), m = env.manifest;
  for (const [url, init] of [
    ['https://private.example/upload', {}],
    ['https://huggingface.co/' + m.modelId + '/resolve/main/config.json', {}],
    ['https://huggingface.co/' + m.modelId + '/resolve/' + m.modelRevision + '/config.json', { method: 'POST', body: 'private' }]
  ]) await assert.rejects(env.context.fetch(url, init), { code: 'interest_model_download_failed' });
  assert.equal(env.requests.length, 0);
  await env.context.fetch('https://huggingface.co/' + m.modelId + '/resolve/' + m.modelRevision + '/config.json', {
    headers: { Authorization: 'Bearer synthetic', Cookie: 'synthetic', Range: 'bytes=0-0' }, credentials: 'include'
  });
  const request = env.requests[0];
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.headers.get('authorization'), null);
  assert.equal(request.init.headers.get('cookie'), null);
  assert.equal(request.init.headers.get('range'), 'bytes=0-0');
});
