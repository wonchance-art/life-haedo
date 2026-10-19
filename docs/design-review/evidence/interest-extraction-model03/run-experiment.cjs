/* MODEL-03 isolated CPU browser execution. Reads input-only data after explicit
 * source/input hash verification; never reads evaluation labels or app storage.
 * Run: node run-experiment.cjs --input PATH --input-sha SHA --candidate PATH
 *      --candidate-sha SHA --runner-sha SHA [--name heldout]
 * Public calibration: --calibration PATH --input-sha SHA --name public-calibration
 */
'use strict';
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const crypto = require('node:crypto'), { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const ROOT = __dirname, BASE = 'http://127.0.0.1:4173';
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
const MODELS = Object.freeze({
  embedding: { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
    bytes: 118308126, sha256: '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
    upstream: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', upstreamRevision: 'b8ef00830037f9868450f778081ea683e900fe39', license: 'apache-2.0', dimensions: 384, ceiling: 512 },
  nli: { id: 'onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX', revision: 'cdc8277b4682665e2f2e87cd83da7da07b153d75',
    bytes: 338341610, sha256: 'f1920d10296efd121a601b2161e8de9fa0c934a6c0331cd1764fd09a06a83041', license: 'mit', ceiling: 512,
    id2label: { '0': 'entailment', '1': 'neutral', '2': 'contradiction' }, entailmentIndex: 0 }
});
function args() {
  const values = {};
  for (let i = 2; i < process.argv.length; i += 2) { if (!process.argv[i]?.startsWith('--') || process.argv[i + 1] === undefined) throw Error('Expected --key value arguments'); values[process.argv[i].slice(2)] = process.argv[i + 1]; }
  values.name ||= values.calibration ? 'public-calibration' : 'heldout';
  if (!/^[a-z0-9_-]{1,60}$/.test(values.name)) throw Error('Invalid output name');
  return values;
}
const options = args(), prefix = path.join(ROOT, options.name);
const report = { startedAt: new Date().toISOString(), mode: options.calibration ? 'public-calibration' : 'frozen-candidate', runtime: { version: '4.3.1', url: RUNTIME_URL, device: 'wasm', dtype: 'q8', numThreads: 1, models: MODELS },
  requests: [], responses: [], errors: [], checkpoints: [], modelPhases: [], counts: { embeddingRequested: 0, embeddingCacheHits: 0, embeddingInferred: 0, nliRequested: 0, nliCacheHits: 0, nliInferred: 0 },
  networkViolations: [], provenanceMethod: {onnx: 'Expected byte count and SHA256 are matched against fixed official Hub LFS metadata; the browser weight byte stream is not separately digested.', wasm: 'Exact ORT versioned public URL is executed; binary byte digest is not measured.', jsonAndRuntime: 'Actual fetched JSON assets and standalone runtime script are SHA256 digested.'}, tokenMeasurements: [], memory: { method: '250ms samples of /proc browser process tree VmRSS; sum includes shared pages more than once, misses sub-interval peaks, excludes runner Node. Per-process VmHWM is lifetime, not a simultaneous unique-memory measurement.', samples: [], sampledPeakSummedRSSBytes: 0, observedMaxProcessVmHWMBytes: 0 },
  truncationPolicy: 'Use tokenizer truncation:false tensors directly for inference. Any measured input above the fixed 512-token ceiling throws INPUT_TOO_LONG; no slicing or truncation fallback.',
  scope: 'Real headless Linux Chromium CPU inference, synthetic input-only corpus, no evaluation labels, no real documents/account/app storage; not Apple-device or product quality evidence.' };
let server, browser, context, page, stage = 'idle', sampler, interval, checkpointInterval, stopped = false, stageStarted = 0, stageInferredMs = 0, deadlineTimer, deadlineExceeded = false;
const cache = new Map(), coverageIndex = new Map(); let extractedCoverage = null; let cachePath, inputSnapshot, inputValue, ledger = [], attemptIndex = -1;
const write = async (file, value) => { await fsp.writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); await fsp.rename(file + '.tmp', file); };
let saving = Promise.resolve();
function save() { const snapshot = JSON.parse(JSON.stringify(report)); saving = saving.then(() => write(prefix + '-runtime.json', snapshot)); return saving; }
async function checkpoint(value) { const entry = { at: new Date().toISOString(), ...value }; report.checkpoints.push(entry); await save(); console.log(JSON.stringify(entry)); }
function abortError() { return Object.assign(Error('Experiment interrupted; completed exact-input cache entries are retained'), { name: 'AbortError' }); }
const controller = new AbortController();
process.once('SIGINT', () => { stopped = true; controller.abort(); browser?.close().catch(() => {}); });
process.once('SIGTERM', () => { stopped = true; controller.abort(); browser?.close().catch(() => {}); });
async function procTree(pid, found = new Set()) {
  if (!pid || found.has(pid)) return found; found.add(pid);
  try { const children = (await fsp.readFile('/proc/' + pid + '/task/' + pid + '/children', 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number); for (const child of children) await procTree(child, found); } catch (_) {}
  return found;
}
let sampling = false;
async function sampleMemory() {
  if (sampling || !server) return; sampling = true;
  try {
    let rss = 0, hwm = 0, processes = 0;
    for (const pid of await procTree(server.process().pid)) {
      try { const status = await fsp.readFile('/proc/' + pid + '/status', 'utf8'); const current = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024, peak = Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] || 0) * 1024; rss += current; hwm = Math.max(hwm, peak); processes++; } catch (_) {}
    }
    const row = { elapsedMs: Date.now() - sampler, stage, processes, summedRSSBytes: rss, maxProcessVmHWMBytes: hwm };
    report.memory.samples.push(row); report.memory.sampledPeakSummedRSSBytes = Math.max(report.memory.sampledPeakSummedRSSBytes, rss); report.memory.observedMaxProcessVmHWMBytes = Math.max(report.memory.observedMaxProcessVmHWMBytes, hwm);
    const phase = report.modelPhases.at(-1); if (phase && stage === phase.kind) phase.sampledPeakSummedRSSBytes = Math.max(phase.sampledPeakSummedRSSBytes || 0, rss);
  } finally { sampling = false; }
}
function validateHash(file, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error(label + ' freeze SHA256 must be supplied before opening input');
  const bytes = fs.readFileSync(file), actual = HASH(bytes);
  if (actual !== expected) throw Error(label + ' freeze SHA256 mismatch');
  return bytes;
}
async function closeStage() {
  if (!context) return;
  try { const details = await page.evaluate(async () => { const hashes = window.__assetHashes || []; const blocked = window.__blocked || []; const id2label = window.__model?.config?.id2label || null; const tokenizerMaxLength = window.__tokenizer?.model_max_length || null; await window.__model?.dispose(); return { hashes, blocked, id2label, tokenizerMaxLength, heapUsed: performance.memory?.usedJSHeapSize ?? null }; }); Object.assign(report.modelPhases.at(-1), details, { inferenceMs: stageInferredMs, totalPhaseMs: Date.now() - stageStarted, disposed: true }); }
  catch (error) { report.errors.push({ stage, type: 'dispose', message: error.message.split('\n')[0] }); }
  await context.close(); context = null; page = null;
  await sampleMemory(); stage = 'between-models'; await save();
}
async function ensureStage(kind) {
  if (stopped) throw abortError();
  if (stage === kind && page) return;
  if (kind === 'embedding' && report.modelPhases.some(phase => phase.kind === 'nli')) throw Error('PHASE_ORDER: embedding requested after NLI phase began');
  await closeStage(); stage = kind; stageStarted = Date.now(); stageInferredMs = 0;
  const model = MODELS[kind];
  report.modelPhases.push({ kind, modelId: model.id, revision: model.revision, startedAt: new Date().toISOString() });
  context = await browser.newContext({ serviceWorkers: 'block' });
  const safe = url => { const parsed = new URL(url); return parsed.origin + parsed.pathname; };
  const modelBase = 'https://huggingface.co/' + model.id + '/resolve/' + model.revision + '/';
  const exactAssets = new Set([RUNTIME_URL, 'https://huggingface.co/api/models/' + model.id + '/revision/' + model.revision + '?blobs=true',
    ...(model.upstream ? ['https://huggingface.co/api/models/' + model.upstream + '/revision/' + model.upstreamRevision] : []),
    ...['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx'].map(file => modelBase + file),
    ...['','.asyncify'].flatMap(suffix => ['.mjs','.wasm'].map(ext => 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded' + suffix + ext))]);
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol !== 'https:') return;
    let initial = request; while (initial.redirectedFrom()) initial = initial.redirectedFrom();
    const approvedInitial = exactAssets.has(initial.url());
    const permittedRedirect = initial !== request && approvedInitial && (url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co') || url.hostname === 'cdn.jsdelivr.net');
    const approved = exactAssets.has(request.url()) || permittedRedirect;
    const headers = request.headers();
    if (!approved || request.method() !== 'GET' || request.postData() || headers.authorization || headers.cookie)
      report.networkViolations.push({stage:kind,origin:url.origin,pathSHA256:HASH(url.pathname),queryKeys:[...url.searchParams.keys()],approvedInitial,approved,method:request.method(),hasBody:!!request.postData(),hasAuthorization:!!headers.authorization,hasCookie:!!headers.cookie});
    report.requests.push({stage:kind,url:approved?safe(request.url()):url.origin+'/[unapproved-path-hash:'+HASH(url.pathname).slice(0,16)+']',method:request.method(),hasBody:!!request.postData(),approved,redirect:initial!==request});
  });
  context.on('response', response => { if (response.url().startsWith('https:')) report.responses.push({ stage: kind, url: safe(response.url()), status: response.status() }); });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.errors.push({ stage: kind, type: 'page', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ stage: kind, type: 'console', message: message.text() }); });
  await page.goto(BASE + '/privacy.html');
  await checkpoint({ phase: 'preparing', kind });
  const prepared = await page.evaluate(async ({ kind, spec, runtimeURL }) => {
    const started = performance.now(), nativeFetch = window.fetch.bind(window);
    const metadataURL = 'https://huggingface.co/api/models/' + spec.id + '/revision/' + spec.revision + '?blobs=true';
    const sourceURL = spec.upstream && 'https://huggingface.co/api/models/' + spec.upstream + '/revision/' + spec.upstreamRevision;
    const base = 'https://huggingface.co/' + spec.id + '/resolve/' + spec.revision + '/';
    const ortBase = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
    const allowed = new Set([metadataURL, sourceURL, runtimeURL, ...['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'].map(file => base + file),
      ...['', '.asyncify'].flatMap(suffix => ['.mjs', '.wasm'].map(ext => ortBase + 'ort-wasm-simd-threaded' + suffix + ext))]);
    window.__assetHashes = []; window.__blocked = [];
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      if (!allowed.has(url) || method !== 'GET' || init.body != null || input?.body != null) { window.__blocked.push({ url: url ? new URL(url).origin + new URL(url).pathname : null, method }); throw Error('PUBLIC_ASSET_GET_ONLY'); }
      const range = new Headers(init.headers || input?.headers).get('range'), headers = new Headers();
      if (range) { if (!/^bytes=\d+-\d*$/.test(range)) throw Error('INVALID_RANGE'); headers.set('range', range); }
      const response = await nativeFetch(url, { method: 'GET', headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: init.cache || 'default' });
      if (response.ok && !range && (url.endsWith('.json') || url === runtimeURL)) {
        const bytes = await response.clone().arrayBuffer(), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        window.__assetHashes.push({ url, sha256: hash, bytes: bytes.byteLength });
      }
      return response;
    };
    const metadataResponse = await fetch(metadataURL); if (!metadataResponse.ok) throw Error('MODEL_METADATA_REQUEST_FAILED');
    const metadata = await metadataResponse.json(), file = metadata.siblings?.find(item => item.rfilename === 'onnx/model_quantized.onnx');
    if (metadata.sha !== spec.revision || file?.lfs?.size !== spec.bytes || file?.lfs?.sha256 !== spec.sha256) throw Error('MODEL_PROVENANCE_MISMATCH');
    if (kind === 'embedding') { const licenseResponse = await fetch(sourceURL); if (!licenseResponse.ok) throw Error('LICENSE_REQUEST_FAILED'); const license = await licenseResponse.json(); if (metadata.cardData?.base_model !== spec.upstream || license.sha !== spec.upstreamRevision || license.cardData?.license !== spec.license) throw Error('LICENSE_PROVENANCE_MISMATCH'); }
    else if (metadata.cardData?.license !== spec.license) throw Error('LICENSE_PROVENANCE_MISMATCH');
    const runtimeResponse = await fetch(runtimeURL); if (!runtimeResponse.ok) throw Error('RUNTIME_REQUEST_FAILED');
    const runtime = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');
    runtime.env.allowLocalModels = false; runtime.env.remotePathTemplate = '{model}/resolve/' + spec.revision + '/'; runtime.env.backends.onnx.wasm.numThreads = 1; runtime.env.backends.onnx.wasm.proxy = false; runtime.env.fetch = window.fetch;
    const tokenizer = await runtime.AutoTokenizer.from_pretrained(spec.id, { revision: spec.revision });
    const model = await (kind === 'embedding' ? runtime.AutoModel : runtime.AutoModelForSequenceClassification).from_pretrained(spec.id, { revision: spec.revision, device: 'wasm', dtype: 'q8' });
    if (kind === 'nli' && JSON.stringify(model.config.id2label) !== JSON.stringify(spec.id2label)) throw Error('NLI_LABEL_MAPPING_MISMATCH');
    window.__runtime = runtime; window.__tokenizer = tokenizer; window.__model = model;
    return { preparedMs: performance.now() - started, id2label: model.config.id2label || null, tokenizerMaxLength: tokenizer.model_max_length, hashes: window.__assetHashes, metadataBytes: file.lfs.size };
  }, { kind, spec: model, runtimeURL: RUNTIME_URL });
  Object.assign(report.modelPhases.at(-1), prepared);
  if(inputValue.documents){const whole=await page.evaluate(docs=>{const started=performance.now();return{rows:docs.map(doc=>({id:doc.id,utf16Characters:doc.text.length,untruncatedTokens:window.__tokenizer(doc.text,{truncation:false,padding:false}).input_ids.dims[1],truncation:false,forLengthOnly:true,notInferred:true})),elapsedMs:performance.now()-started};},inputValue.documents.map(({id,text})=>({id,text})));report.wholeDocumentTokenCounts||={};report.wholeDocumentTokenCounts[kind]=whole; }
  await checkpoint({ phase: 'prepared', kind, preparedMs: prepared.preparedMs });
}
function keyFor(kind, input) { return kind + ':' + HASH(JSON.stringify(input)); }
async function record(kind, key, record) {
  cache.set(key, record); await fsp.appendFile(cachePath, JSON.stringify({ kind, key, recordSHA256: HASH(JSON.stringify(record)), record }) + '\n');
  report.tokenMeasurements.push({ kind, key, ...Object.fromEntries(Object.entries(record).filter(([name]) => !['vectors', 'logits', 'probabilities'].includes(name))) });
}
function observeCoverage(text, kind) {
  for (const row of coverageIndex.get(text) || []) {
    row.observed[kind] = true;
  }
}
function unionRanges(rows) {
  const merged=[];
  for(const row of rows.slice().sort((a,b)=>a.start-b.start||a.end-b.end)) { const last=merged.at(-1); if(last&&row.start<=last.end)last.end=Math.max(last.end,row.end);else merged.push({start:row.start,end:row.end}); }
  return merged;
}
function coverageOutput() {
  if(!extractedCoverage)return null;
  return {method:'Successful exact-text model callbacks (fresh inference or fingerprint-verified cache) mapped to ranges from the same frozen extractor. Scanning, embedding and NLI coverage are distinct; independent evaluation must verify source unions.',documents:inputValue.documents.map(doc=>{
    const rows=extractedCoverage.filter(row=>row.document.id===doc.id), source=rows[0]?.document;
    const describe=selected=>{const ranges=unionRanges(selected),coveredCharacters=ranges.reduce((sum,row)=>sum+row.end-row.start,0);let end=0,uncoveredNonWhitespaceCharacters=0;for(const row of ranges){uncoveredNonWhitespaceCharacters+=doc.text.slice(end,row.start).replace(/\s/gu,'').length;end=row.end;}uncoveredNonWhitespaceCharacters+=doc.text.slice(end).replace(/\s/gu,'').length;return{ranges,coveredCharacters,uncoveredNonWhitespaceCharacters};};
    return{id:doc.id,sourceId:source?.sourceId||doc.sourceId||'s-'+doc.id,sourceVersionId:source?.sourceVersionId||doc.sourceVersionId||'v-'+doc.id,rawUTF8SHA256:HASH(doc.text),rawUTF16Characters:doc.text.length,
      extracted:describe(rows),embedding:describe(rows.filter(row=>row.observed.embedding)),nliPremise:describe(rows.filter(row=>row.observed.nliPremise)),nliAnyInput:describe(rows.filter(row=>row.observed.nliPremise||row.observed.nliHypothesis))};
  })};
}
async function embed(texts) {
  if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) throw Error('Invalid embedding input');
  report.counts.embeddingRequested += texts.length;
  const output = new Array(texts.length), groups = new Map();
  for (let index = 0; index < texts.length; index++) { const key = keyFor('embedding', texts[index]); if (cache.has(key)) { output[index] = cache.get(key).vectors; report.counts.embeddingCacheHits++; } else if (groups.has(key)) groups.get(key).indices.push(index); else groups.set(key, { key, text: texts[index], indices: [index] }); }
  const rows = [...groups.values()];
  if (rows.length) await ensureStage('embedding');
  for (let offset = 0; offset < rows.length; offset += 8) {
    if (stopped) throw abortError(); const batch = rows.slice(offset, offset + 8);
    const value = await page.evaluate(async ({ texts, ceiling }) => {
      const tokenizer = window.__tokenizer, counts = texts.map(text => tokenizer.encode(text).length);
      if (counts.some(count => count > ceiling)) return { overflow: true, counts };
      const inputs = tokenizer(texts, { padding: true, truncation: false }), started = performance.now();
      const output = await window.__model(inputs), tensor = output.last_hidden_state ?? output.logits ?? output.token_embeddings;
      const vectors = window.__runtime.mean_pooling(tensor, inputs.attention_mask).normalize(2, -1).tolist();
      const actual = inputs.attention_mask.tolist().map(row => row.reduce((sum, value) => sum + Number(value), 0));
      return { vectors, counts, actual, paddedTokens: inputs.input_ids.dims[1], elapsedMs: performance.now() - started };
    }, { texts: batch.map(row => row.text), ceiling: MODELS.embedding.ceiling });
    if (value.overflow) throw Object.assign(Error('Embedding input exceeds frozen token ceiling'), { code: 'INPUT_TOO_LONG', tokenCounts: value.counts });
    stageInferredMs += value.elapsedMs;
    for (let index = 0; index < batch.length; index++) {
      const row = batch[index], vector = value.vectors[index];
      if (value.counts[index] !== value.actual[index] || vector.length !== 384 || vector.some(v => !Number.isFinite(v))) throw Error('Embedding length/output verification failed');
      const data = { vectors: vector, textCharacters: row.text.length, untruncatedTokens: value.counts[index], actualInputTokens: value.actual[index], paddedBatchTokens: value.paddedTokens, batchId: HASH(JSON.stringify(batch.map(item=>item.key))), tokenLimit: 512, truncated: false, elapsedBatchMs: value.elapsedMs };
      await record('embedding', row.key, data); for (const slot of row.indices) output[slot] = vector; report.counts.embeddingInferred++;
    }
    await checkpoint({ phase: 'embedding', completedUnique: report.counts.embeddingInferred, requested: report.counts.embeddingRequested });
  }
  for(const text of texts)observeCoverage(text,'embedding');
  return output;
}
async function scorePairs(pairs, settings = {}) {
  if (!Array.isArray(pairs) || pairs.some(pair => typeof pair.premise !== 'string' || typeof pair.hypothesis !== 'string')) throw Error('Invalid NLI pair input');
  if (settings.signal?.aborted || stopped) throw abortError();
  report.counts.nliRequested += pairs.length;
  const scores = new Array(pairs.length);
  for (let index = 0; index < pairs.length; index++) {
    if (settings.signal?.aborted || stopped) throw abortError();
    const pair = pairs[index], key = keyFor('nli', [pair.premise, pair.hypothesis]);
    if (cache.has(key)) { scores[index] = cache.get(key).entailment; report.counts.nliCacheHits++; observeCoverage(pair.premise,'nliPremise');observeCoverage(pair.hypothesis,'nliHypothesis');continue; }
    await ensureStage('nli');
    const value = await page.evaluate(async ({ premise, hypothesis, ceiling }) => {
      const inputs = window.__tokenizer(premise, { text_pair: hypothesis, truncation: false, padding: false });
      const count = inputs.input_ids.dims[1]; if (count > ceiling) return { overflow: true, count };
      const started = performance.now(), output = await window.__model(inputs), logits = output.logits.tolist()[0];
      const maximum = Math.max(...logits), exps = logits.map(value => Math.exp(value - maximum)), sum = exps.reduce((a, b) => a + b, 0), probabilities = exps.map(value => value / sum);
      return { logits, probabilities, count, actual: inputs.attention_mask.tolist()[0].reduce((sum, value) => sum + Number(value), 0), elapsedMs: performance.now() - started };
    }, { premise: pair.premise, hypothesis: pair.hypothesis, ceiling: MODELS.nli.ceiling });
    if (value.overflow) throw Object.assign(Error('NLI pair exceeds frozen token ceiling'), { code: 'INPUT_TOO_LONG', pairIds: [pair.id], tokenCounts: [value.count] });
    if (value.count !== value.actual || value.logits.length !== 3 || value.logits.some(v => !Number.isFinite(v))) throw Error('NLI length/output verification failed');
    stageInferredMs += value.elapsedMs;
    const data = { pairId: pair.id, stage: pair.stage || null, premiseCharacters: pair.premise.length, hypothesisCharacters: pair.hypothesis.length, logits: value.logits, probabilities: value.probabilities, entailment: value.probabilities[0], entailmentIndex: 0,
      untruncatedTokens: value.count, actualInputTokens: value.actual, tokenLimit: 512, truncated: false, elapsedMs: value.elapsedMs };
    await record('nli', key, data); scores[index] = data.entailment; report.counts.nliInferred++;observeCoverage(pair.premise,'nliPremise');observeCoverage(pair.hypothesis,'nliHypothesis');
    if (report.counts.nliInferred % 8 === 0 || index === pairs.length - 1) await checkpoint({ phase: 'nli', completedUnique: report.counts.nliInferred, requested: report.counts.nliRequested, cacheHits: report.counts.nliCacheHits });
  }
  return scores;
}
async function main() {
  const inputPath = path.resolve(options.calibration || options.input || ''), candidatePath = options.candidate && path.resolve(options.candidate);
  // Source freeze is validated before opening the sealed input-only corpus.
  if (!options.calibration) validateHash(__filename, options['runner-sha'], 'Runner source');
  if (!options.calibration) report.candidateSHA256 = HASH(validateHash(candidatePath, options['candidate-sha'], 'Candidate source'));
  const inputBytes = validateHash(inputPath, options['input-sha'], options.calibration ? 'Public calibration' : 'Sealed input-only');
  report.inputSHA256 = HASH(inputBytes); report.runnerSHA256 = HASH(fs.readFileSync(__filename));
  inputValue = JSON.parse(inputBytes); inputSnapshot = JSON.stringify(inputValue);
  if (!options.calibration && !Array.isArray(inputValue.documents)) throw Error('Input-only document array required');
  if (options.calibration && !Array.isArray(inputValue.pairs)) throw Error('Public calibration pairs required');
  const forbidden = ['expected', 'labels', 'answers', 'gold', 'groundTruth', 'expectedTopics', 'expectedQuestions'];
  if (forbidden.some(key => key in inputValue) || inputValue.documents?.some(row => forbidden.some(key => key in row))) throw Error('Label-like input fields rejected; supply an input-only export');
  report.inputDocuments = inputValue.documents?.map(row => ({ id: row.id, utf16Characters: row.text.length, utf8SHA256: HASH(row.text) })) || [];
  const fingerprint = HASH(JSON.stringify({ runner: report.runnerSHA256, input: report.inputSHA256, candidate: report.candidateSHA256 || null, runtime: report.runtime, nliRule: 'full3way_softmax_entailment_index0' }));
  report.runFingerprint = fingerprint;
  // Preserve prior observations before latest-report checkpoints replace them.
  // Only matching frozen runs may supply prior tokenizer/memory observations.
  const previousReportPath=prefix+'-runtime.json';
  if(fs.existsSync(previousReportPath)){
    const bytes=await fsp.readFile(previousReportPath), sha256=HASH(bytes), previous=JSON.parse(bytes);
    const archive=prefix+'-prior-runtime-'+sha256.slice(0,16)+'.json';
    if(!fs.existsSync(archive))await fsp.writeFile(archive,bytes);
    report.previousRuntimeArtifact={file:path.basename(archive),sha256,sameFingerprint:previous.runFingerprint===fingerprint};
    if(previous.runFingerprint===fingerprint){
      report.wholeDocumentTokenCounts=previous.wholeDocumentTokenCounts||{};
      report.previousSampledPeakSummedRSSBytes=Math.max(previous.memory?.sampledPeakSummedRSSBytes||0,previous.previousSampledPeakSummedRSSBytes||0);
    }
  }
  const ledgerPath = prefix + '-attempts.json';
  ledger = fs.existsSync(ledgerPath) ? JSON.parse(await fsp.readFile(ledgerPath,'utf8')) : [];
  report.previousAttempts = ledger.filter(row=>row.fingerprint===fingerprint);
  report.firstAttemptStartedAt = report.previousAttempts[0]?.startedAt || report.startedAt;
  attemptIndex = ledger.length; ledger.push({fingerprint,startedAt:report.startedAt,status:'running'}); await write(ledgerPath,ledger);
  cachePath = prefix + '-cache-' + fingerprint.slice(0, 16) + '.jsonl';
  if (fs.existsSync(cachePath)) {
    const lines = (await fsp.readFile(cachePath, 'utf8')).split('\n').filter(Boolean);
    for (let index = 0; index < lines.length; index++) { let row; try { row = JSON.parse(lines[index]); } catch (error) { if (index === lines.length - 1) { report.cacheTruncatedFinalRecord = true; await fsp.writeFile(cachePath, lines.slice(0,index).join('\n') + '\n'); break; } throw error; } if (index === 0) { if (row.fingerprint !== fingerprint) throw Error('Cache fingerprint mismatch'); } else { if(row.recordSHA256 !== HASH(JSON.stringify(row.record))) throw Error('Cache record SHA256 mismatch'); cache.set(row.key, row.record); report.tokenMeasurements.push({kind:row.kind,key:row.key,fromResumedCache:true,...Object.fromEntries(Object.entries(row.record).filter(([name])=>!['vectors','logits','probabilities'].includes(name)))}); } }
    report.resumedCacheEntries = cache.size;
  } else await fsp.writeFile(cachePath, JSON.stringify({ fingerprint, inputSHA256: report.inputSHA256, candidateSHA256: report.candidateSHA256 || null }) + '\n');
  let candidate;
  if (candidatePath) {
    candidate = await import(pathToFileURL(candidatePath).href + '?sha=' + report.candidateSHA256);
    report.candidateConfig = candidate.CONFIG;
    report.templateManifest={topic:candidate.TAXONOMY.map(topic=>({id:topic.id,text:candidate.TEMPLATES.topic(topic.label)})),control:candidate.TEMPLATES.control,questionhood:candidate.TEMPLATES.questionhood};report.templateSHA256=HASH(JSON.stringify(report.templateManifest));
    const extracted=await candidate.extractDocuments(inputValue,{hash:async text=>HASH(text)});
    extractedCoverage=[...extracted.passages,...extracted.questions].map(row=>({...row,observed:{}}));
    for(const row of extractedCoverage){const rows=coverageIndex.get(row.quote)||[];rows.push(row);coverageIndex.set(row.quote,rows);} report.taxonomySHA256 = HASH(JSON.stringify(candidate.TAXONOMY));
  }
  await write(prefix + '-runner-freeze.json', { runnerSHA256: report.runnerSHA256, inputSHA256: report.inputSHA256, candidateSHA256: report.candidateSHA256 || null, runFingerprint: fingerprint, runtime: report.runtime, config: report.candidateConfig || null, taxonomySHA256: report.taxonomySHA256 || null, templateSHA256:report.templateSHA256||null });
  await checkpoint({ phase: 'frozen', inputDocuments: report.inputDocuments.length, cacheEntries: cache.size });
  const budgetMs=candidate?.CONFIG?.maxWallMilliseconds||900000;
  const previousBudgetMs=report.previousAttempts.reduce((sum,row)=>sum+(row.wallMs??Math.min(budgetMs,Date.parse(report.startedAt)-Date.parse(row.startedAt))),0);
  report.budget={milliseconds:budgetMs,scope:'Same heldout fingerprint attempts only; includes source/input initialization, model preparation, inference and candidate orchestration. Public development experiments have separate ledgers. External Node timer kills Chromium; synchronous Node code can delay timer until its next yield.',previousAttemptWallMs:previousBudgetMs,remainingAtLaunchMs:budgetMs-previousBudgetMs-(Date.now()-Date.parse(report.startedAt))};
  if(report.budget.remainingAtLaunchMs<=0)throw Object.assign(Error('Cumulative experiment deadline exhausted'),{code:'RUNTIME_DEADLINE'});
  deadlineTimer=setTimeout(()=>{deadlineExceeded=true;stopped=true;controller.abort();server?.kill().catch(()=>{});},report.budget.remainingAtLaunchMs);
  server = await chromium.launchServer({ executablePath: '/usr/bin/chromium', headless: true, proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' }, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  browser = await chromium.connect(server.wsEndpoint()); report.browser = browser.version(); report.browserRootPID = server.process().pid;
  sampler = Date.now(); interval = setInterval(() => sampleMemory().catch(() => {}), 250); checkpointInterval = setInterval(() => save().catch(() => {}), 5000); await sampleMemory();
  const started = Date.now();
  let output;
  if (options.calibration) {
    const values = await scorePairs(inputValue.pairs, { signal: controller.signal });
    output = { pairs: inputValue.pairs.map((pair, index) => ({ id: pair.id, entailment: values[index], ...cache.get(keyFor('nli', [pair.premise, pair.hypothesis])) })) };
  } else {
    const adapter = candidate.createCandidate({ embed, scorePairs, hash: async text => HASH(text), now: () => report.startedAt });
    output = await adapter.analyze(inputValue, {model:MODELS.embedding.id+' + '+MODELS.nli.id,modelRevision:MODELS.embedding.revision+' + '+MODELS.nli.revision, signal: controller.signal, onProgress: value => { report.candidateProgress = value; } });
    if (typeof adapter.dispose === 'function') await adapter.dispose();
  }
  report.inferenceAndCandidateMs = Date.now() - started;
  if (!options.calibration && HASH(fs.readFileSync(__filename)) !== report.runnerSHA256) throw Error('Runner source changed during frozen execution');
  if (JSON.stringify(inputValue) !== inputSnapshot) throw Error('Input-only bundle mutated');
  report.inputBundleUnchanged = true;
  await closeStage();
  report.cacheSHA256 = HASH(await fsp.readFile(cachePath));
  const embeddingBatches = new Map([...cache.values()].filter(row=>row.batchId).map(row=>[row.batchId,row.elapsedBatchMs]));
  report.cacheOriginalInferenceMs = {embedding:[...embeddingBatches.values()].reduce((a,b)=>a+b,0),nli:[...cache.values()].filter(row=>row.entailmentIndex===0).reduce((a,row)=>a+(row.elapsedMs||0),0)};
  report.outputSHA256 = HASH(JSON.stringify(output)); await write(prefix + '-output.json', output);
  const coverage=coverageOutput();if(coverage){await write(prefix+'-coverage.json',coverage);report.coverageSHA256=HASH(JSON.stringify(coverage));report.coverage=coverage.documents.map(({id,rawUTF16Characters,embedding,nliPremise,nliAnyInput})=>({id,rawUTF16Characters,embeddingCharacters:embedding.coveredCharacters,nliPremiseCharacters:nliPremise.coveredCharacters,nliAnyInputCharacters:nliAnyInput.coveredCharacters,embeddingUncoveredNonWhitespace:embedding.uncoveredNonWhitespaceCharacters,nliUncoveredNonWhitespace:nliAnyInput.uncoveredNonWhitespaceCharacters}));}
  report.mutableRevisionRequests = report.requests.filter(row => row.url.includes('/resolve/main/'));
  report.bodyRequests = report.requests.filter(row => row.hasBody || row.method !== 'GET');
  report.truncatedInputs = report.tokenMeasurements.filter(row => row.truncated || row.actualInputTokens !== row.untruncatedTokens).length;
  if (report.mutableRevisionRequests.length || report.bodyRequests.length || report.errors.length || report.truncatedInputs || report.networkViolations.length || report.modelPhases.some(phase => phase.blocked?.length)) throw Error('Runtime integrity check failed');
  report.pass = true; await checkpoint({ phase: 'complete', inferenceAndCandidateMs: report.inferenceAndCandidateMs, counts: report.counts, sampledPeakSummedRSSBytes: report.memory.sampledPeakSummedRSSBytes });
}
main().catch(async error => { if(deadlineExceeded)error=Object.assign(Error('Cumulative experiment deadline exceeded; no candidate completion is claimed'),{name:'RuntimeDeadlineError',code:'RUNTIME_DEADLINE'});
  const partial=coverageOutput();if(partial){await write(prefix+'-partial-coverage.json',partial);report.partialCoverageSHA256=HASH(JSON.stringify(partial));}if(cachePath&&fs.existsSync(cachePath))report.cacheSHA256=HASH(await fsp.readFile(cachePath));
  report.failure = { name: error.name, code: error.code || null, message: error.message, stack: error.stack, pairIds: error.pairIds, tokenCounts: error.tokenCounts }; report.interrupted = stopped; await save(); console.error(error.message); process.exitCode = 1; })
.finally(async () => { clearTimeout(deadlineTimer);clearInterval(interval); clearInterval(checkpointInterval); await sampleMemory(); await browser?.close().catch(() => {}); await server?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  if(attemptIndex>=0){ledger[attemptIndex]={...ledger[attemptIndex],finishedAt:report.finishedAt,status:report.pass?'completed':report.interrupted?'interrupted':'failed',wallMs:Date.parse(report.finishedAt)-Date.parse(report.startedAt),phases:report.modelPhases.map(phase=>({kind:phase.kind,preparedMs:phase.preparedMs||0,inferenceMs:phase.inferenceMs||0})),counts:report.counts};await write(prefix+'-attempts.json',ledger);report.cumulativeAttemptWallMs=ledger.filter(row=>row.fingerprint===report.runFingerprint).reduce((sum,row)=>sum+(row.wallMs||0),0);}
  await save(); });
