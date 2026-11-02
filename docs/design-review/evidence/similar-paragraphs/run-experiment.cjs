/* 비슷한 문단 실험 실행기. 정답(gold) 파일을 읽지 않는다.
 * node run-experiment.cjs --mode smoke [--fresh 1]
 * node run-experiment.cjs --mode dev
 * node run-experiment.cjs --mode eval --freeze-sha <freeze.json SHA-256>
 * 실제 Linux Chromium(Playwright) 실행이며 Apple 기기 측정이 아니다. 개발 서버는 127.0.0.1:4189에서
 * 이 저장소를 그대로 제공한다. 모델·캐시는 커밋 제외 경로 .local/similar-paragraphs/에 둔다. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const candidate = require('./candidate.js');
const HERE = __dirname, REPO = path.resolve(HERE, '../../../..');
const LOCAL = path.join(REPO, '.local/similar-paragraphs');
const PORT = 4189, BASE = 'http://127.0.0.1:' + PORT;
const HARNESS = BASE + '/docs/design-review/evidence/similar-paragraphs/harness.html';
const CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const shaFile = file => sha(fs.readFileSync(file));
const PRODUCT_FILES = ['assets/life/interest-model-worker.js', 'assets/life/interest-model-loader.js', 'assets/life/rediscovery.js', 'assets/life/core.js', 'sw.js', 'manifest.webmanifest'];
// 워커가 허용하는 공개 자산과 같은 목록. 최초 요청이 이 밖이거나 본문 있는 요청은 위반으로 기록한다.
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
const APPROVED = new Set(['https://huggingface.co/api/models/' + MODEL + '/revision/' + REVISION,
  'https://huggingface.co/api/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/revision/b8ef00830037f9868450f778081ea683e900fe39',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
  ...['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(file => 'https://huggingface.co/' + MODEL + '/resolve/' + REVISION + '/' + file),
  ...['.asyncify', ''].flatMap(suffix => ['.mjs', '.wasm'].map(ext => ORT + 'ort-wasm-simd-threaded' + suffix + ext))]);

function args() {
  const values = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    if (!process.argv[index].startsWith('--') || process.argv[index + 1] === undefined) throw new Error('--key value 형식이어야 합니다');
    values[process.argv[index].slice(2)] = process.argv[index + 1];
  }
  if (!['smoke', 'dev', 'evaldry', 'eval'].includes(values.mode)) throw new Error('--mode smoke|dev|evaldry|eval');
  return values;
}
const options = args();
const report = { mode: options.mode, startedAt: new Date().toISOString(), environment: { platform: process.platform, node: process.version, chromiumExecutable: CHROME,
  scope: 'Linux headless Chromium 모사. Apple 기기·Safari 측정이 아니다.' }, network: { requests: [], violations: [], externalBytes: 0 },
  memory: { method: '250ms 간격 /proc 브라우저 프로세스 트리 VmRSS 합(공유 페이지 중복 포함, 표본 사이 최대치 누락 가능)', peakSummedRSSBytes: 0, samples: 0, byPhase: {} }, errors: [] };
const write = (name, value) => { const file = path.join(HERE, name); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); return file; };
let phase = 'start';
const setPhase = name => { phase = name; };

function productState() {
  return Object.fromEntries(PRODUCT_FILES.map(file => [file, shaFile(path.join(REPO, file))]));
}
function browserPids(profile) {
  const pids = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try { if (fs.readFileSync('/proc/' + entry + '/cmdline', 'utf8').includes(profile)) pids.push(Number(entry)); } catch (_) { /* 종료한 프로세스 */ }
  }
  return pids;
}
function sampleMemory(profile) {
  let total = 0;
  for (const pid of browserPids(profile)) {
    try { total += Number(fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024; } catch (_) { /* 종료한 프로세스 */ }
  }
  report.memory.samples++; report.memory.peakSummedRSSBytes = Math.max(report.memory.peakSummedRSSBytes, total);
  report.memory.byPhase[phase] = Math.max(report.memory.byPhase[phase] || 0, total);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const response = await fetch(BASE + '/docs/design-review/evidence/similar-paragraphs/worker-host.html'); if (response.ok) return; } catch (_) { /* 아직 시작 전 */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('개발 서버가 시작되지 않았습니다');
}
async function open(profile) {
  const server = spawn('python3', [path.join(REPO, 'scripts/dev-server.py'), '--port', String(PORT)], { stdio: 'ignore' });
  await waitForServer();
  const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  report.environment.chromiumVersion = context.browser()?.version() || null;
  context.on('requestfinished', async request => {
    const url = new URL(request.url());
    if (url.origin === BASE) return;
    let initial = request; while (initial.redirectedFrom()) initial = initial.redirectedFrom();
    const initialURL = new URL(initial.url()), key = initialURL.origin + initialURL.pathname;
    const approved = APPROVED.has(key);
    const sizes = await request.sizes().catch(() => null);
    const bytes = sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
    report.network.externalBytes += bytes;
    const response = await request.response().catch(() => null);
    report.network.requests.push({ phase, url: approved ? url.origin + url.pathname : url.origin + '/[미승인 경로]', initial: approved ? key : '[미승인]', method: request.method(),
      hasBody: !!request.postData(), status: response?.status() ?? null, bytes });
    if (!approved || request.method() !== 'GET' || request.postData()) report.network.violations.push({ origin: url.origin, method: request.method(), hasBody: !!request.postData() });
  });
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => report.errors.push({ type: 'page', message: String(error.message).split('\n')[0] }));
  page.on('response', response => { if (response.status() >= 400) report.errors.push({ type: 'http', status: response.status(), url: new URL(response.url()).pathname }); });
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text().split('\n')[0] }); });
  page.setDefaultTimeout(900000);
  await page.goto(HARNESS);
  const cdp = await context.newCDPSession(page);
  const sampler = setInterval(() => sampleMemory(profile), 250);
  return { server, context, page, cdp, close: async () => { clearInterval(sampler); await context.close(); server.kill(); } };
}
const throttle = async (cdp, rate) => { await cdp.send('Emulation.setCPUThrottlingRate', { rate }); };
async function calibrate(page, cdp) {
  // 같은 반복을 경로·감속별 3회 돌린 중앙값. 감속이 iframe 주 스레드에도 걸리는지 확인한다.
  const result = {}, median = values => values.sort((a, b) => a - b)[1];
  for (const rate of [1, 4]) {
    await throttle(cdp, rate);
    const pageRuns = [], frameRuns = [];
    for (let run = 0; run < 3; run++) {
      pageRuns.push((await page.evaluate(() => __harness.busyLoop())).elapsedMs);
      frameRuns.push((await page.evaluate(() => __harness.hostBusyLoop())).elapsedMs);
    }
    result['page' + rate] = median(pageRuns); result['iframe' + rate] = median(frameRuns);
  }
  await throttle(cdp, 1);
  result.pageRatio = result.page4 / result.page1; result.iframeRatio = result.iframe4 / result.iframe1;
  return result;
}
function corpusEntries(corpus, variant) {
  const entries = [];
  for (const document of corpus.documents) for (const paragraph of candidate.paragraphs(document)) {
    if (!paragraph.indexed) continue;
    entries.push({ id: document.id + ':' + paragraph.index, docId: document.id, textSHA256: sha(paragraph.text), normalized: candidate.normalize(paragraph.text),
      characters: paragraph.text.length, inputs: candidate.embeddingInputs(document, paragraph, variant) });
  }
  return entries;
}
// 비용 측정용 긴 문단: 한 문서의 문단 다섯 개를 시작 위치만 돌려 한 덩어리로 잇는다(약 250~300자).
function longEntries(corpora, variant) {
  const entries = [];
  for (const corpus of corpora) for (const document of corpus.documents) {
    const parts = candidate.paragraphs(document).map(paragraph => paragraph.text);
    for (let shift = 0; shift < parts.length; shift++) {
      const text = [...parts.slice(shift), ...parts.slice(0, shift)].join(' ');
      const paragraph = { docId: document.id, index: shift, start: 0, end: text.length, text, indexed: true };
      entries.push({ id: document.id + ':L' + shift, docId: document.id, textSHA256: sha(text), normalized: candidate.normalize(text),
        characters: text.length, inputs: candidate.embeddingInputs(document, paragraph, variant) });
    }
  }
  return entries;
}
async function embedUnique(page, pathName, texts) {
  const unique = [...new Set(texts)];
  const result = await page.evaluate(async ({ pathName, unique }) => {
    const out = await __harness.embedAll(__harness[pathName], unique);
    return { vectors: out.vectors, elapsedMs: out.elapsedMs, batchMs: out.batchMs, batchSizes: out.batchSizes };
  }, { pathName, unique });
  const map = new Map(unique.map((text, index) => [text, result.vectors[index]]));
  return { map, unique, uniqueCount: unique.length, elapsedMs: result.elapsedMs, batchMs: result.batchMs, batchSizes: result.batchSizes };
}
function readSealed(name, expected) {
  const bytes = fs.readFileSync(path.join(HERE, name));
  if (!expected || sha(bytes) !== expected) throw new Error(name + ' SHA 불일치: 봉인 뒤 바뀌었거나 봉인 값이 없습니다');
  return JSON.parse(bytes.toString('utf8'));
}
const serialize = (entries, vectors, variant) => {
  let cursor = 0;
  return JSON.stringify({ schemaVersion: 1, modelId: MODEL, modelRevision: REVISION, variant, dimensions: 384,
    entries: entries.map(entry => ({ id: entry.id, docId: entry.docId, textSHA256: entry.textSHA256,
      vectors: candidate.float32Base64(vectors.slice(cursor, cursor += entry.inputs.length)) })) });
};

async function smoke() {
  const profile = path.join(LOCAL, 'profile');
  if (options.fresh === '1') fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const session = await open(profile);
  try {
    const { page, cdp } = session;
    report.hostSourceSHA256 = await page.evaluate(() => __harness.hostPath.prepareHost());
    report.productWorkerSHA256 = shaFile(path.join(REPO, 'assets/life/interest-model-worker.js'));
    report.calibration = await calibrate(page, cdp);
    setPhase('worker-prepare');
    const before = report.network.externalBytes;
    report.workerPrepareMs = await page.evaluate(() => __harness.workerPath.prepare());
    await new Promise(resolve => setTimeout(resolve, 500));
    report.workerPrepareExternalBytes = report.network.externalBytes - before;
    // 말뭉치와 무관한 고정 점검 문장만 쓴다.
    const texts = ['점검 문장 하나입니다.', '모델이 같은 숫자를 돌려주는지 봅니다.', 'A short English check sentence.'];
    const worker = await page.evaluate(texts => __harness.workerPath.embed(texts), texts);
    setPhase('host-prepare');
    const before2 = report.network.externalBytes;
    report.hostPrepareMs = await page.evaluate(() => __harness.hostPath.prepare());
    await new Promise(resolve => setTimeout(resolve, 500));
    report.hostPrepareExternalBytes = report.network.externalBytes - before2;
    const host = await page.evaluate(texts => __harness.hostPath.embed(texts), texts);
    report.maxAbsDifference = Math.max(...worker.flatMap((row, i) => row.map((value, j) => Math.abs(value - host[i][j]))));
    report.dimensions = worker[0].length;
  } finally { await session.close(); }
  report.finishedAt = new Date().toISOString();
  console.log(write(options.fresh === '1' ? 'smoke-cold-output.json' : 'smoke-warm-output.json', report));
}

async function dev() {
  const seal = JSON.parse(fs.readFileSync(path.join(HERE, 'seal.json'), 'utf8'));
  if (options['seal-sha'] !== shaFile(path.join(HERE, 'seal.json'))) throw new Error('--seal-sha가 seal.json과 다릅니다');
  const corpus = readSealed('dev-corpus.json', seal.files['dev-corpus.json']);
  const profile = path.join(LOCAL, 'profile'); fs.mkdirSync(profile, { recursive: true });
  const session = await open(profile);
  const output = { mode: 'dev', sealSHA256: options['seal-sha'], runnerSHA256: shaFile(__filename), candidateSHA256: shaFile(path.join(HERE, 'candidate.js')), variants: {} };
  try {
    const { page } = session;
    setPhase('worker-prepare');
    output.workerPrepareMs = await page.evaluate(() => __harness.workerPath.prepare());
    setPhase('dev-embed');
    for (const variant of candidate.VARIANTS) {
      const entries = corpusEntries(corpus, variant);
      const embedded = await embedUnique(page, 'workerPath', entries.flatMap(entry => entry.inputs));
      output.variants[variant] = { inputCount: entries.reduce((total, entry) => total + entry.inputs.length, 0), uniqueInputs: embedded.uniqueCount, embedMs: embedded.elapsedMs,
        entries: entries.map(entry => ({ id: entry.id, docId: entry.docId, textSHA256: entry.textSHA256, normalized: entry.normalized, pieces: entry.inputs.length,
          vectors: candidate.float32Base64(entry.inputs.map(input => embedded.map.get(input))) })) };
    }
  } finally { await session.close(); }
  output.run = report; output.finishedAt = new Date().toISOString();
  console.log(write('dev-output.json', output));
}

async function costPool(page, cdp, entries, threshold, variant) {
  const inputs = entries.flatMap(entry => entry.inputs);
  await throttle(cdp, 4);
  // 중복 제거 없이 200문단의 모든 조각을 그대로 색인한다.
  const indexed = await page.evaluate(async inputs => {
    const out = await __harness.embedAll(__harness.hostPath, inputs);
    return { vectors: out.vectors, elapsedMs: out.elapsedMs, batchMs: out.batchMs };
  }, inputs);
  const storedJSON = serialize(entries, indexed.vectors, variant);
  // 감속한 페이지에서 저장 형식을 읽고 200문단 각각을 기준으로 1회씩 질의한다.
  const query = await page.evaluate(({ storedJSON, normalized, threshold }) => {
    const t0 = performance.now(), data = JSON.parse(storedJSON);
    const index = data.entries.map((entry, i) => ({ id: entry.id, docId: entry.docId, normalized: normalized[i], vectors: SimilarParagraphs.decodeFloat32(entry.vectors, data.dimensions) }));
    const decodeMs = performance.now() - t0, times = [];
    for (const seed of index) { const t = performance.now(); SimilarParagraphs.similar(index, seed, threshold); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    return { decodeMs, count: times.length, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times.at(-1) };
  }, { storedJSON, normalized: entries.map(entry => entry.normalized), threshold });
  await throttle(cdp, 1);
  const characters = entries.map(entry => entry.characters).sort((a, b) => a - b);
  return { paragraphs: entries.length, inputs: inputs.length, characters: { min: characters[0], median: characters[Math.floor(characters.length / 2)], max: characters.at(-1),
    total: characters.reduce((a, b) => a + b, 0) }, indexMs: indexed.elapsedMs, batchMs: indexed.batchMs, storageBytes: Buffer.byteLength(storedJSON, 'utf8'), query, vectors: indexed.vectors };
}

async function evaluation() {
  // --mode evaldry: 동결 전 점검. 평가 말뭉치를 열지 않고 개발 말뭉치로 같은 경로를 실행한다(판정 근거 아님).
  const dry = options.mode === 'evaldry';
  const seal = JSON.parse(fs.readFileSync(path.join(HERE, 'seal.json'), 'utf8'));
  let freeze;
  if (dry) freeze = { parameters: JSON.parse(fs.readFileSync(path.join(HERE, 'dev-report.json'), 'utf8')).chosen, product: seal.product };
  else {
    const freezeBytes = fs.readFileSync(path.join(HERE, 'freeze.json'));
    if (!/^[a-f0-9]{64}$/.test(options['freeze-sha'] || '') || sha(freezeBytes) !== options['freeze-sha']) throw new Error('freeze.json SHA가 주어지지 않았거나 다릅니다');
    freeze = JSON.parse(freezeBytes.toString('utf8'));
    for (const [name, expected] of Object.entries(freeze.files)) if (shaFile(path.join(HERE, name)) !== expected) throw new Error(name + ' 동결 SHA 불일치');
    // 성공한 평가 실행은 한 번뿐이다. 실행 오류로 끝난 시도는 eval-failure-*.json으로 남기고 같은 동결 값으로만 다시 시도한다.
    if (fs.existsSync(path.join(HERE, 'eval-output.json'))) throw new Error('평가 세트는 한 번만 실행합니다: eval-output.json이 이미 있습니다');
  }
  for (const [name, expected] of Object.entries(freeze.product)) if (shaFile(path.join(REPO, name)) !== expected) throw new Error(name + ' 제품 파일 SHA 불일치');
  const devCorpus = readSealed('dev-corpus.json', seal.files['dev-corpus.json']);
  const evalCorpus = dry ? devCorpus : readSealed('eval-corpus.json', seal.files['eval-corpus.json']);
  const { variant, threshold } = freeze.parameters;
  const profile = path.join(LOCAL, 'profile'); fs.mkdirSync(profile, { recursive: true });
  const output = { mode: options.mode, freezeSHA256: options['freeze-sha'] || null, parameters: freeze.parameters, productBefore: productState() };
  const session = await open(profile);
  try {
    const { page, cdp } = session;
    // 1) 품질 벡터: 제품 경로(전용 워커), 감속 없음. 후보 계산은 평가기가 Node에서 같은 candidate.js로 한다.
    setPhase('worker-prepare');
    output.workerPrepareMs = await page.evaluate(() => __harness.workerPath.prepare());
    setPhase('quality-embed');
    const evalEntries = corpusEntries(evalCorpus, variant);
    const quality = await embedUnique(page, 'workerPath', evalEntries.flatMap(entry => entry.inputs));
    output.quality = { unthrottledWorkerEmbedMs: quality.elapsedMs, paragraphs: evalEntries.length, uniqueInputs: quality.uniqueCount,
      entries: evalEntries.map(entry => ({ id: entry.id, docId: entry.docId, textSHA256: entry.textSHA256, normalized: entry.normalized, pieces: entry.inputs.length,
        vectors: candidate.float32Base64(entry.inputs.map(input => quality.map.get(input))) })) };
    await page.evaluate(() => __harness.workerPath.dispose());
    // 2) 비용: 같은 워커 소스를 iframe 주 스레드에서 CPU 4배 감속으로 실행, 390×844.
    setPhase('host-prepare-throttled');
    output.hostSourceSHA256 = await page.evaluate(() => __harness.hostPath.prepareHost());
    if (output.hostSourceSHA256 !== freeze.product['assets/life/interest-model-worker.js']) throw new Error('iframe에 넣은 워커 소스가 제품 파일과 다릅니다');
    output.calibration = await calibrate(page, cdp);
    await throttle(cdp, 4);
    output.cost = { cpuThrottlingRate: 4, viewport: '390x844', deviceScaleFactor: 3,
      hostPrepareMsThrottled: await page.evaluate(() => __harness.hostPath.prepare()) };
    await throttle(cdp, 1);
    // 유효성: 같은 배치 입력(품질 경로의 첫 배치)을 iframe 경로로 다시 임베딩해 워커 경로와 같은지 본다.
    // q8 모델은 활성값을 배치 단위로 동적 양자화하므로 배치 구성이 다르면 같은 문장도 값이 조금 달라진다(개발 점검에서 확인).
    const firstBatch = quality.unique.slice(0, quality.batchSizes[0]);
    const hostFirst = await page.evaluate(async texts => (await __harness.embedAll(__harness.hostPath, texts)).vectors, firstBatch);
    output.cost.sameBatchInputs = firstBatch.length;
    output.cost.sameBatchMaxAbsDifference = Math.max(...firstBatch.flatMap((text, i) => quality.map.get(text).map((value, j) => Math.abs(value - hostFirst[i][j]))));
    const corpusPool = [...evalEntries, ...corpusEntries(devCorpus, variant)].slice(0, 200);
    const longPool = longEntries([evalCorpus, devCorpus], variant).slice(0, 200);
    if (!dry && (corpusPool.length !== 200 || longPool.length !== 200)) throw new Error('비용 측정 문단이 200개가 아닙니다');
    setPhase('cost-corpus-throttled');
    const corpusCost = await costPool(page, cdp, corpusPool, threshold, variant);
    setPhase('cost-long-throttled');
    const longCost = await costPool(page, cdp, longPool, threshold, variant);
    // 사실 보고: 배치 구성이 다른 색인(중복 제거 없음, 개발 문단과 섞인 배치)과 품질 벡터의 차이.
    let diff = 0, minCosine = 1, cursor = 0;
    for (const entry of evalEntries) for (const input of entry.inputs) {
      const a = quality.map.get(input), b = corpusCost.vectors[cursor++];
      let dot = 0; for (let j = 0; j < a.length; j++) { diff = Math.max(diff, Math.abs(a[j] - b[j])); dot += a[j] * b[j]; }
      minCosine = Math.min(minCosine, dot);
    }
    delete corpusCost.vectors; delete longCost.vectors;
    output.cost.corpusPool = corpusCost; output.cost.longPool = longCost;
    output.cost.batchComposition = { maxAbsDifference: diff, minCosine };
    output.cost.storageFormat = 'JSON {schemaVersion, modelId, modelRevision, variant, dimensions, entries:[{id, docId, textSHA256, vectors: Float32 LE base64}]}';
    // 새로 쓴 문단 하나를 질의할 때의 임베딩 1회(사실 보고, 판정 기준 아님). 감속 상태 5회 중앙값.
    setPhase('single-embed-throttled');
    await throttle(cdp, 4);
    const single = [];
    for (let run = 0; run < 5; run++) single.push(await page.evaluate(async text => { const t = performance.now(); await __harness.hostPath.embed([text]); return performance.now() - t; }, longPool[run].inputs[0]));
    await throttle(cdp, 1);
    single.sort((a, b) => a - b); output.cost.singleLongParagraphEmbedMedianMs = single[2];
    output.cost.heap = await page.evaluate(() => __harness.heap());
  } finally { await session.close(); }
  output.productAfter = productState();
  output.run = report; output.finishedAt = new Date().toISOString();
  console.log(write(dry ? 'evaldry-output.json' : 'eval-output.json', output));
}

({ smoke, dev, evaldry: evaluation, eval: evaluation })[options.mode]().catch(error => { report.errors.push({ type: 'runner', message: error.message }); write(options.mode + '-failure' + (options.mode === 'eval' ? '-' + Date.now() : '') + '.json', report); console.error(error); process.exitCode = 1; });
