/* Dedicated module worker. Nothing is fetched until the explicit prepare message.
 * MODEL-01 provenance + official standalone runtime; all model paths pin one SHA. */
'use strict';
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const UPSTREAM = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const UPSTREAM_REVISION = 'b8ef00830037f9868450f778081ea683e900fe39';
const BYTES = 118308126, SHA256 = '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc';
const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
const MODEL_META = 'https://huggingface.co/api/models/' + MODEL + '/revision/' + REVISION + '?blobs=true';
const LICENSE_META = 'https://huggingface.co/api/models/' + UPSTREAM + '/revision/' + UPSTREAM_REVISION;
const ASSETS = new Set([MODEL_META, LICENSE_META, RUNTIME_URL,
  ...FILES.map(file => 'https://huggingface.co/' + MODEL + '/resolve/' + REVISION + '/' + file),
  ...['.asyncify', ''].flatMap(suffix => ['.mjs', '.wasm'].map(ext => ORT_BASE + 'ort-wasm-simd-threaded' + suffix + ext))]);
const fail = code => Object.assign(new Error('Local model operation failed'), { code });
const nativeFetch = globalThis.fetch.bind(globalThis);
let pipeline = null, busy = false;
// Even the runtime's internal metadata/weight/WASM fetches cannot send cookies,
// authorization, bodies, custom endpoints, or private texts over the network.
globalThis.fetch = async function publicAssetFetch(input, init = {}) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  if (!ASSETS.has(url) || method !== 'GET' || init.body != null || input?.body != null) throw fail('interest_model_download_failed');
  const incoming = new Headers(init.headers || input?.headers), headers = new Headers();
  const range = incoming.get('Range');
  if (range) {
    if (!/^bytes=\d+-\d*$/.test(range)) throw fail('interest_model_download_failed');
    headers.set('Range', range);
  }
  return nativeFetch(url, { method: 'GET', headers, credentials: 'omit', referrerPolicy: 'no-referrer',
    signal: init.signal, cache: init.cache || 'default' });
};
function emit(id, type, value) { globalThis.postMessage({ id, type, value }); }
function progress(id, value) {
  const safe = {};
  for (const key of ['phase', 'status']) if (/^[a-z_-]{1,32}$/.test(value?.[key] || '')) safe[key] = value[key];
  for (const key of ['progress', 'loaded', 'total', 'completed', 'bytes']) if (Number.isFinite(value?.[key]) && value[key] >= 0) safe[key] = value[key];
  if (FILES.includes(value?.file)) safe.file = value.file;
  emit(id, 'progress', safe);
}
async function json(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw fail('interest_model_download_failed');
  return response.json();
}
async function prepare(id, data) {
  if (data.modelId !== MODEL || data.modelRevision !== REVISION) throw fail('interest_model_unverified');
  if (pipeline) return { modelId: MODEL, modelRevision: REVISION };
  const metadata = await json(MODEL_META);
  const weight = metadata.siblings?.find(file => file.rfilename === 'onnx/model_quantized.onnx');
  if (metadata.sha !== REVISION || metadata.cardData?.base_model !== UPSTREAM ||
      weight?.lfs?.size !== BYTES || weight?.lfs?.sha256 !== SHA256) throw fail('interest_model_unverified');
  const license = await json(LICENSE_META);
  if (license.sha !== UPSTREAM_REVISION || license.cardData?.license !== 'apache-2.0') throw fail('interest_model_unverified');
  progress(id, { phase: 'verified', bytes: BYTES });
  const runtime = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');
  runtime.env.allowLocalModels = false;
  runtime.env.remotePathTemplate = '{model}/resolve/' + REVISION + '/';
  runtime.env.backends.onnx.wasm.numThreads = 1;
  runtime.env.backends.onnx.wasm.proxy = false;
  runtime.env.fetch = globalThis.fetch;
  pipeline = await runtime.pipeline('feature-extraction', MODEL, { revision: REVISION, device: 'wasm', dtype: 'q8',
    progress_callback: value => progress(id, value) });
  return { modelId: MODEL, modelRevision: REVISION };
}
async function embed(id, texts) {
  if (!pipeline) throw fail('interest_model_unavailable');
  if (!Array.isArray(texts) || !texts.length || texts.length > 32 || Array.from(texts).some(text =>
      typeof text !== 'string' || !text.trim() || text.length > 4000) ||
      texts.reduce((total, text) => total + text.length, 0) > 32000) throw fail('interest_embedding_invalid');
  const vectors = [];
  for (let start = 0; start < texts.length; start += 8) {
    const rows = (await pipeline(texts.slice(start, start + 8), { pooling: 'mean', normalize: true })).tolist();
    if (!Array.isArray(rows) || rows.length !== Math.min(8, texts.length - start) || Array.from(rows).some(row =>
        !Array.isArray(row) || row.length !== 384 || Array.from(row).some(value => !Number.isFinite(value)) || !Math.hypot(...row))) throw fail('interest_embedding_invalid');
    vectors.push(...rows);
    progress(id, { phase: 'analysis', completed: vectors.length, total: texts.length });
  }
  return vectors;
}
globalThis.onmessage = async event => {
  const data = event.data;
  if (!data || !Number.isSafeInteger(data.id) || data.id < 1 || !['prepare', 'embed'].includes(data.type)) return;
  if (busy) { globalThis.postMessage({ id: data.id, type: 'error', code: 'interest_model_busy' }); return; }
  busy = true;
  try { emit(data.id, 'result', data.type === 'prepare' ? await prepare(data.id, data) : await embed(data.id, data.texts)); }
  catch (error) {
    const code = ['interest_model_unverified', 'interest_model_download_failed', 'interest_model_unavailable', 'interest_embedding_invalid'].includes(error?.code)
      ? error.code : data.type === 'prepare' ? 'interest_model_download_failed' : 'interest_embedding_invalid';
    globalThis.postMessage({ id: data.id, type: 'error', code });
  } finally { busy = false; }
};
