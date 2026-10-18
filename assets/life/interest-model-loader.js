/* Explicit preparation only. Each owner has one isolated CPU model worker.
 * Cancellation terminates WASM; a retained adapter prepares again on retry. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {}; root.HaedoLife.InterestModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const manifest = Object.freeze({
    modelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    modelRevision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
    upstream: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    upstreamRevision: 'b8ef00830037f9868450f778081ea683e900fe39',
    bytes: 118308126, sha256: '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
    license: 'apache-2.0', runtimeVersion: '4.3.1', device: 'wasm', dtype: 'q8',
    dimensions: 384, modelMaxTokens: 512
  });
  const limits = Object.freeze({ texts: 32, textCharacters: 4000, totalCharacters: 32000, batch: 8 });
  const scriptUrl = root.document?.currentScript?.src;
  const workerUrl = scriptUrl ? new URL('interest-model-worker.js', scriptUrl).href : 'assets/life/interest-model-worker.js';
  const messages = {
    interest_model_unverified: '공식 모델의 라이선스와 고정 버전을 확인하지 못했습니다.',
    interest_model_download_failed: '공식 모델을 받지 못했습니다. 다시 준비할 수 있습니다.',
    interest_model_unavailable: '이 브라우저에서 로컬 분석을 준비하지 못했습니다.',
    interest_model_disposed: '종료한 모델입니다. 모델을 다시 준비해 주세요.',
    interest_model_busy: '모델의 이전 작업이 끝난 뒤 다시 시도해 주세요.',
    interest_embedding_invalid: '분석 입력이나 모델 결과를 확인하지 못했습니다.'
  };
  const failure = code => Object.assign(new Error(messages[code] || messages.interest_model_unavailable), { code: messages[code] ? code : 'interest_model_unavailable' });
  const aborted = () => Object.assign(new Error('분석을 취소했습니다.'), { name: 'AbortError' });
  function progress(value, callback) {
    if (typeof callback !== 'function' || !value || typeof value !== 'object') return;
    const safe = {};
    for (const key of ['phase', 'status']) if (/^[a-z_-]{1,32}$/.test(value[key] || '')) safe[key] = value[key];
    for (const key of ['progress', 'loaded', 'total', 'completed', 'bytes']) if (Number.isFinite(value[key]) && value[key] >= 0) safe[key] = value[key];
    if (['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].includes(value.file)) safe.file = value.file;
    try { callback(safe); } catch (_) { /* An observer cannot interrupt model ownership. */ }
  }
  function validateTexts(texts) {
    if (!Array.isArray(texts) || !texts.length || texts.length > limits.texts ||
        Array.from(texts).some(text => typeof text !== 'string' || !text.trim() || text.length > limits.textCharacters) ||
        texts.reduce((total, text) => total + text.length, 0) > limits.totalCharacters) throw failure('interest_embedding_invalid');
    return texts.slice();
  }
  function validateVectors(rows, count) {
    if (!Array.isArray(rows) || rows.length !== count || Array.from(rows).some(row => !Array.isArray(row) ||
        row.length !== manifest.dimensions || Array.from(row).some(value => !Number.isFinite(value)) || !Math.hypot(...row))) throw failure('interest_embedding_invalid');
    return rows;
  }
  function create() {
    let worker = null, generation = 0, nextId = 0, ready = false, adapter = null, active = null, lifetime = 0;
    const pending = new Map();
    function stop(error, invalidate = false) {
      const old = worker; worker = null; ready = false; active = null; generation++;
      if (old) { old.onmessage = null; old.onerror = null; old.onmessageerror = null; old.terminate(); }
      for (const job of [...pending.values()]) job.reject(error);
      if (invalidate) { adapter = null; active = null; lifetime++; }
    }
    function spawn() {
      if (worker) return;
      if (typeof root.Worker !== 'function') throw failure('interest_model_unavailable');
      try { worker = new root.Worker(workerUrl, { type: 'module', name: 'haedo-interest-model' }); }
      catch (_) { throw failure('interest_model_unavailable'); }
      const own = worker, token = ++generation;
      worker.onmessage = event => {
        if (worker !== own || generation !== token) return;
        const data = event.data, job = data && pending.get(data.id);
        if (!job || job.generation !== token) return;
        if (data.type === 'progress') { progress(data.value, job.onProgress); return; }
        if (data.type === 'result') job.resolve(data.value);
        else if (data.type === 'error') job.reject(failure(data.code));
      };
      const crashed = () => { if (worker === own && generation === token) stop(failure('interest_model_unavailable')); };
      worker.onerror = event => { event.preventDefault?.(); crashed(); };
      worker.onmessageerror = crashed;
    }
    function request(type, payload, settings) {
      if (settings.signal?.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const id = ++nextId, token = generation;
        const cleanup = () => { pending.delete(id); settings.signal?.removeEventListener('abort', cancel); };
        const cancel = () => { if (generation === token && pending.has(id)) stop(aborted()); };
        const job = { generation: token, onProgress: settings.onProgress,
          resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } };
        pending.set(id, job); settings.signal?.addEventListener('abort', cancel, { once: true });
        if (settings.signal?.aborted) { cancel(); return; }
        try { worker.postMessage({ id, type, ...payload }); }
        catch (_) { stop(failure('interest_model_unavailable')); }
      });
    }
    async function prepared(settings) {
      if (settings.signal?.aborted) throw aborted();
      if (ready) return;
      spawn();
      const token = generation;
      try {
        const result = await request('prepare', { modelId: manifest.modelId, modelRevision: manifest.modelRevision }, settings);
        if (generation !== token || !worker || settings.signal?.aborted) throw aborted();
        if (result?.modelId !== manifest.modelId || result?.modelRevision !== manifest.modelRevision) throw failure('interest_model_unverified');
        ready = true;
      } catch (error) { if (generation === token) stop(error); throw error; }
    }
    async function exclusive(fn) {
      if (active) throw failure('interest_model_busy');
      const token = {}; active = token;
      try { return await fn(); } finally { if (active === token) active = null; }
    }
    async function loadModel(settings = {}) {
      if (settings.signal?.aborted) throw aborted();
      if ((settings.modelId && settings.modelId !== manifest.modelId) ||
          (settings.modelRevision && settings.modelRevision !== manifest.modelRevision)) throw failure('interest_model_unverified');
      const scope = lifetime;
      return exclusive(async () => {
        await prepared(settings);
        if (scope !== lifetime) throw failure('interest_model_disposed');
        if (!adapter) {
          const own = { modelId: manifest.modelId, modelRevision: manifest.modelRevision,
            async embed(texts, options = {}) {
              if (adapter !== own) throw failure('interest_model_disposed');
              if (options.signal?.aborted) throw aborted();
              const input = validateTexts(texts);
              return exclusive(async () => {
                if (adapter !== own) throw failure('interest_model_disposed');
                await prepared(options);
                if (adapter !== own) throw failure('interest_model_disposed');
                const token = generation;
                const result = await request('embed', { texts: input }, options);
                if (adapter !== own) throw failure('interest_model_disposed');
                if (generation !== token || options.signal?.aborted) throw aborted();
                return validateVectors(result, input.length);
              });
            },
            async dispose() { if (adapter === own) stop(failure('interest_model_disposed'), true); }
          };
          adapter = Object.freeze(own);
        }
        return adapter;
      });
    }
    return Object.freeze({ loadModel, async dispose() { stop(failure('interest_model_disposed'), true); } });
  }
  return Object.freeze({ create, manifest, limits });
});
