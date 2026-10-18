/* Explicit local embeddings only. Analysis is a proposed interpretation, never
 * authorship, agreement or a diagnosis. No model is fetched on module import. */
(function (root, factory) {
  'use strict';
  const api = factory(root, root.crypto || (typeof require === 'function' && require('node:crypto').webcrypto));
  root.HaedoLife ||= {}; root.HaedoLife.InterestAnalysis = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root, crypto) {
  'use strict';
  const RUNTIME_VERSION = '4.3.1';
  // A download candidate, not a claim that this model has passed Korean quality
  // evaluation. prepare() verifies its official card/license/revision first.
  const DEFAULT_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' + RUNTIME_VERSION + '/dist/transformers.web.min.js';
  const LIMITS = Object.freeze({ documents: 50, totalCharacters: 1000000, documentCharacters: 100000,
    windowsPerDocument: 3, windowCharacters: 280, questionsPerDocument: 3, candidates: 8,
    evidencePerCandidate: 5, embeddingBatch: 8, topicSimilarity: 0.42, questionSimilarity: 0.78 });
  const TOPICS = Object.freeze([
    { id: 'reading-writing', label: '독서와 글쓰기', terms: ['독서', '책', '글쓰기'], text: '책을 읽고 문장을 쓰는 일, 문학과 출판, 독서 경험과 글쓰기 방법' },
    { id: 'technology-science', label: '기술과 과학', terms: ['기술', '과학', '연구'], text: '새로운 기술과 과학 연구, 인공지능과 컴퓨터, 실험과 발견을 이해하기' },
    { id: 'work-learning', label: '일과 배움', terms: ['일', '배움', '직업'], text: '직장에서 일하는 방법과 직업 선택, 업무 경험, 새로운 것을 배우는 과정' },
    { id: 'health-life', label: '건강과 생활', terms: ['건강', '운동', '생활'], text: '몸을 돌보는 생활, 운동과 식사, 수면과 일상 습관을 유지하는 방법' },
    { id: 'travel-city', label: '도시와 여행', terms: ['여행', '도시', '공간'], text: '낯선 곳을 여행하고 도시를 걷는 경험, 동네와 건축, 장소와 공간을 관찰하기' },
    { id: 'arts-culture', label: '예술과 문화', terms: ['예술', '문화', '작품'], text: '영화와 음악, 미술과 공연, 예술 작품을 감상하고 문화 현상을 이해하기' },
    { id: 'nature-environment', label: '자연과 환경', terms: ['자연', '환경', '생태'], text: '자연과 생태계, 기후 변화와 환경 보전, 동식물과 사람이 함께 살아가기' },
    { id: 'relationships-society', label: '관계와 사회', terms: ['관계', '사회', '대화'], text: '사람 사이의 관계와 대화, 공동체와 사회 제도, 서로 다른 입장을 이해하기' },
    { id: 'economy-consumption', label: '경제와 소비', terms: ['경제', '소비', '돈'], text: '경제와 돈의 흐름, 소비와 저축, 물건의 가치와 구매 선택을 살펴보기' },
    { id: 'education-growth', label: '교육과 성장', terms: ['교육', '성장', '학습'], text: '교육과 학습, 아이와 어른이 성장하는 과정, 가르치고 배우는 방법' }
  ]);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const string = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  function fail(code) {
    const messages = {
      interest_analysis_invalid: '분석할 자료와 선택 범위를 다시 확인해 주세요.',
      interest_analysis_unavailable: '로컬 의미 분석 모델을 사용할 수 없습니다. 직접 입력한 관심과 분석 결과는 구분됩니다.',
      interest_model_not_prepared: '의미 분석 전에 로컬 모델을 명시적으로 준비해 주세요.',
      interest_model_download_failed: '공식 모델을 받지 못했습니다. 자료는 전송하지 않았으며 다시 시도할 수 있습니다.',
      interest_model_unverified: '공식 모델의 라이선스와 고정 버전을 확인하지 못했습니다.',
      interest_embedding_invalid: '모델의 의미 벡터를 확인하지 못했습니다. 분석 완료로 처리하지 않았습니다.',
      interest_analysis_stale: '선택한 원문이 바뀌었습니다. 최신 자료에서 분석 범위를 다시 선택해 주세요.'
    };
    return Object.assign(new Error(messages[code] || messages.interest_analysis_invalid), { code });
  }
  const check = (condition, code = 'interest_analysis_invalid') => { if (!condition) throw fail(code); };
  function aborted() { const error = new Error('분석을 취소했습니다.'); error.name = 'AbortError'; return error; }
  function boundary(text, index) {
    if (index > 0 && index < text.length && /[\uDC00-\uDFFF]/.test(text[index])) return index - 1;
    return index;
  }
  async function hash(text) {
    check(crypto?.subtle, 'interest_analysis_unavailable');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  function cosine(a, b) { let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i]; return Math.max(-1, Math.min(1, dot)); }
  function vectors(value, count, dimensions) {
    const rows = value?.vectors || value;
    check(Array.isArray(rows) && rows.length === count, 'interest_embedding_invalid');
    const normalized = rows.map(row => {
      check(Array.isArray(row) || ArrayBuffer.isView(row), 'interest_embedding_invalid');
      check(row.length > 0 && row.length <= 4096 && (!dimensions || row.length === dimensions), 'interest_embedding_invalid');
      dimensions ||= row.length;
      const values = Array.from(row);
      check(values.every(Number.isFinite), 'interest_embedding_invalid');
      const norm = Math.hypot(...values); check(norm > 0, 'interest_embedding_invalid');
      return values.map(value => value / norm);
    });
    return { vectors: normalized, dimensions };
  }
  function ranges(text) {
    let segments;
    if (typeof Intl.Segmenter === 'function') {
      segments = [...new Intl.Segmenter('ko', { granularity: 'sentence' }).segment(text)].map(row => ({ start: row.index, end: row.index + row.segment.length }));
    } else {
      segments = [...text.matchAll(/[^\r\n.!?。！？]+(?:[.!?。！？]+|$)/gu)].map(row => ({ start: row.index, end: row.index + row[0].length }));
    }
    return segments.map(row => {
      while (row.start < row.end && /\s/.test(text[row.start])) row.start++;
      while (row.end > row.start && /\s/.test(text[row.end - 1])) row.end--;
      row.end = boundary(text, Math.min(row.end, row.start + LIMITS.windowCharacters));
      return { ...row, quote: text.slice(row.start, row.end) };
    }).filter(row => row.quote.length >= 8);
  }
  function sampled(rows, maximum) {
    if (rows.length <= maximum) return rows;
    const result = [];
    for (let i = 0; i < maximum; i++) result.push(rows[Math.round(i * (rows.length - 1) / (maximum - 1))]);
    return result;
  }
  function evidence(document, range) {
    // Offsets always refer to the original UTF-16 string, including BOM/CRLF.
    check(document.text.slice(range.start, range.end) === range.quote, 'interest_analysis_stale');
    return { sourceId: document.sourceId, sourceVersionId: document.sourceVersionId, sha256: document.sha256,
      start: range.start, end: range.end, quote: range.quote };
  }
  async function select(bundle, options, guard) {
    check(plain(bundle) && id(bundle.workspaceId) && Array.isArray(bundle.sources) && Array.isArray(bundle.sourceVersions));
    check(plain(options) && Array.isArray(options.sourceVersionIds) && options.sourceVersionIds.length > 0 &&
      options.sourceVersionIds.length <= LIMITS.documents && options.sourceVersionIds.every(id) && new Set(options.sourceVersionIds).size === options.sourceVersionIds.length);
    const wanted = new Set(options.sourceVersionIds), sources = new Map(bundle.sources.map(source => [source.id, source]));
    const selected = new Map(), found = new Set(), selectedVersions = [], limitations = new Set(['sampled_selected_documents_only', 'proposed_interests_not_beliefs', 'model_quality_not_a_probability']);
    let characters = 0;
    for (const version of bundle.sourceVersions) {
      if (!wanted.has(version.id)) continue;
      check(!found.has(version.id), 'interest_analysis_stale');
      found.add(version.id); const source = sources.get(version.sourceId);
      check(plain(source) && plain(version) && id(source.id) && typeof source.title === 'string');
      selectedVersions.push({ id: version.id, sourceId: version.sourceId,
        contentText: version.contentText, contentHash: version.contentHash });
      if (version.contentText === null) { limitations.add('link_only_excluded'); continue; }
      check(typeof version.contentText === 'string' && version.contentText.length <= LIMITS.documentCharacters);
      characters += version.contentText.length; check(characters <= LIMITS.totalCharacters);
      if (!version.contentText.trim()) { limitations.add('empty_body_excluded'); continue; }
      check(typeof version.contentHash === 'string' && /^[a-f0-9]{64}$/.test(version.contentHash), 'interest_analysis_stale');
      if (version.originalAuthor?.relation !== 'self') limitations.add('saved_material_does_not_prove_authorship_or_agreement');
      if (version.coverage?.status !== 'full_text') limitations.add('incomplete_body_evidence_only');
      // The last selected version for a source follows Core's append order;
      // it never silently substitutes an unselected newer version.
      if (selected.has(source.id)) limitations.add('selected_versions_collapsed_by_source');
      selected.set(source.id, { sourceId: source.id, sourceVersionId: version.id, text: version.contentText,
        expectedHash: version.contentHash, authorRelation: version.originalAuthor?.relation || 'unknown',
        coverage: version.coverage?.status || 'unknown' });
    }
    check(found.size === wanted.size, 'interest_analysis_stale');
    const documents = [], hashes = new Set();
    for (const document of selected.values()) {
      guard(); document.sha256 = await hash(document.text); guard();
      check(document.expectedHash === document.sha256, 'interest_analysis_stale');
      if (hashes.has(document.sha256)) { limitations.add('identical_bodies_counted_once'); continue; }
      hashes.add(document.sha256);
      document.ranges = ranges(document.text); documents.push(document);
    }
    check(documents.length > 0);
    return { documents, limitations, selectedVersions };
  }
  function assertSelectedUnchanged(bundle, snapshots) {
    check(Array.isArray(bundle.sourceVersions) && Array.isArray(bundle.sources), 'interest_analysis_stale');
    for (const snapshot of snapshots) {
      const current = bundle.sourceVersions.filter(version => version?.id === snapshot.id);
      check(current.length === 1 && current[0].sourceId === snapshot.sourceId &&
        current[0].contentText === snapshot.contentText && current[0].contentHash === snapshot.contentHash &&
        bundle.sources.filter(source => source?.id === snapshot.sourceId).length === 1, 'interest_analysis_stale');
    }
  }
  async function loadDefault({ modelId, modelRevision, signal, onProgress }) {
    check(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(modelId), 'interest_model_unverified');
    let metadata;
    try {
      const revision = modelRevision && modelRevision !== 'main' ? '/revision/' + encodeURIComponent(modelRevision) : '';
      const response = await root.fetch('https://huggingface.co/api/models/' + modelId + revision + '?blobs=true', { signal });
      check(response.ok, 'interest_model_download_failed'); metadata = await response.json();
    } catch (error) { if (signal.aborted || error.name === 'AbortError') throw aborted(); throw fail('interest_model_download_failed'); }
    const license = metadata.cardData?.license || metadata.tags?.find(tag => tag.startsWith('license:'))?.slice(8);
    check(['apache-2.0', 'mit'].includes(license) && /^[a-f0-9]{40}$/.test(metadata.sha), 'interest_model_unverified');
    if (modelRevision && modelRevision !== 'main') check(metadata.sha === modelRevision, 'interest_model_unverified');
    const files = (metadata.siblings || []).filter(file => /(?:model_quantized|model_q8)\.onnx$/.test(file.rfilename));
    const knownModelBytes = files.reduce((sum, file) => sum + (file.lfs?.size || file.size || 0), 0);
    onProgress({ phase: 'download', model: modelId, modelRevision: metadata.sha, knownModelBytes, license });
    let pipeline;
    try {
      const runtime = await import(RUNTIME_URL);
      if (signal.aborted) throw aborted();
      runtime.env.allowLocalModels = false;
      runtime.env.backends.onnx.wasm.numThreads = 1;
      pipeline = await runtime.pipeline('feature-extraction', modelId, { revision: metadata.sha, device: 'wasm', dtype: 'q8',
        progress_callback: progress => { if (!signal.aborted) onProgress({ phase: 'download', ...progress }); } });
      if (signal.aborted) { await pipeline.dispose?.(); throw aborted(); }
    } catch (error) { if (signal.aborted || error.name === 'AbortError') throw aborted(); throw fail('interest_model_download_failed'); }
    return { modelId, modelRevision: metadata.sha,
      embed: async texts => (await pipeline(texts, { pooling: 'mean', normalize: true })).tolist(),
      dispose: () => pipeline.dispose?.() };
  }
  function create(options = {}) {
    check(plain(options));
    let embed = options.embed, modelId = options.modelId || DEFAULT_MODEL_ID, modelRevision = options.modelRevision || 'main';
    check(string(modelId) && string(modelRevision) && (embed === undefined || typeof embed === 'function'));
    const loader = options.loadModel || loadDefault, now = options.now || (() => new Date().toISOString());
    check(typeof loader === 'function' && typeof now === 'function');
    let epoch = 0, disposed = false, controller = null, adapter = null, preparation = null;
    let status = embed ? 'ready' : 'idle', dimension = 0;
    function cancel() { epoch++; controller?.abort(); controller = null; preparation = null; if (status === 'loading') status = 'idle'; }
    function operation(signal) {
      check(!disposed, 'interest_analysis_unavailable'); cancel();
      const token = epoch, own = new AbortController(); controller = own;
      const abort = () => { if (controller === own) cancel(); else own.abort(); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) own.abort();
      const guard = () => { if (disposed || token !== epoch || own.signal.aborted) throw aborted(); };
      return { signal: own.signal, guard, isCurrent: () => !disposed && token === epoch,
        finish: () => { signal?.removeEventListener('abort', abort); if (controller === own) controller = null; } };
    }
    async function prepare(settings = {}) {
      check(plain(settings)); if (settings.signal?.aborted) throw aborted();
      check(!disposed, 'interest_analysis_unavailable');
      if (status === 'ready') return { model: modelId, modelRevision, status };
      if (preparation) return preparation;
      const job = operation(settings.signal); status = 'loading';
      const progress = value => { job.guard(); settings.onProgress?.(value); };
      const task = (async () => {
        let loaded;
        try {
          loaded = await loader({ modelId, modelRevision, signal: job.signal, onProgress: progress }); job.guard();
          check(plain(loaded) && typeof loaded.embed === 'function' && string(loaded.modelId || modelId) && string(loaded.modelRevision || modelRevision), 'interest_embedding_invalid');
          embed = loaded.embed; modelId = loaded.modelId || modelId; modelRevision = loaded.modelRevision || modelRevision;
          adapter = loaded; status = 'ready'; return { model: modelId, modelRevision, status };
        } catch (error) {
          // A rejected cleanup must not replace the load/cancellation cause or
          // prevent state recovery. A superseded job cannot reset its retry.
          try { await loaded?.dispose?.(); } catch (_) {}
          if (job.isCurrent()) status = 'idle';
          if (!job.isCurrent() || job.signal.aborted) throw aborted();
          throw error;
        }
        finally { job.finish(); if (preparation === task) preparation = null; }
      })(); if (job.isCurrent() && !job.signal.aborted) preparation = task; return task;
    }
    async function encodeInternal(texts, job, onProgress) {
      check(status === 'ready' && typeof embed === 'function', 'interest_model_not_prepared');
      const output = [];
      for (let offset = 0; offset < texts.length; offset += LIMITS.embeddingBatch) {
        job.guard(); const batch = texts.slice(offset, offset + LIMITS.embeddingBatch);
        const value = vectors(await embed(batch, { signal: job.signal }), batch.length, dimension); job.guard();
        dimension = value.dimensions; output.push(...value.vectors);
        onProgress?.({ phase: 'analysis', completed: output.length, total: texts.length }); job.guard();
        // Let paint, input and AbortSignal handlers run between CPU batches.
        await new Promise(resolve => root.setTimeout(resolve, 0)); job.guard();
      }
      return output;
    }
    async function encode(texts, settings = {}) {
      check(Array.isArray(texts) && texts.length > 0 && texts.length <= 500 && texts.every(text => string(text, 4000)));
      const job = operation(settings.signal);
      try { const result = await encodeInternal(texts, job, settings.onProgress); return { model: modelId, modelRevision, dimensions: dimension, vectors: result }; }
      finally { job.finish(); }
    }
    async function analyze(bundle, settings = {}) {
      check(status === 'ready', 'interest_model_not_prepared');
      const job = operation(settings.signal);
      try {
        const workspaceId = bundle?.workspaceId, revision = bundle?.revision;
        const { documents, limitations, selectedVersions } = await select(bundle, settings, job.guard);
        const windows = documents.flatMap(document => sampled(document.ranges, LIMITS.windowsPerDocument).map(range => ({ document, range })));
        check(windows.length > 0);
        const questions = documents.flatMap(document => sampled(document.ranges.filter(range => /[?？]/.test(range.quote)), LIMITS.questionsPerDocument).map(range => ({ document, range })));
        limitations.add('explicit_question_passages_only');
        const texts = [...TOPICS.map(topic => topic.text), ...windows.map(row => row.range.quote), ...questions.map(row => row.range.quote)];
        const encoded = await encodeInternal(texts, job, settings.onProgress);
        const topicVectors = encoded.slice(0, TOPICS.length);
        windows.forEach((row, i) => { row.vector = encoded[TOPICS.length + i]; });
        questions.forEach((row, i) => { row.vector = encoded[TOPICS.length + windows.length + i]; });
        const interests = [];
        TOPICS.forEach((topic, index) => {
          const matches = new Map();
          for (const window of windows) {
            const score = cosine(window.vector, topicVectors[index]);
            const bestOther = Math.max(...topicVectors.map((vector, other) => other === index ? -1 : cosine(window.vector, vector)));
            if (score < LIMITS.topicSimilarity || score < bestOther + 0.02) continue;
            const prior = matches.get(window.document.sha256);
            if (!prior || score > prior.score) matches.set(window.document.sha256, { window, score });
          }
          if (matches.size < 2) return;
          const support = [...matches.values()].sort((a, b) => b.score - a.score || a.window.document.sourceId.localeCompare(b.window.document.sourceId));
          interests.push({ id: 'topic-' + topic.id, label: topic.label, terms: [...topic.terms], kind: 'topic',
            evidence: support.slice(0, LIMITS.evidencePerCandidate).map(row => evidence(row.window.document, row.window.range)), support: matches.size });
        });
        const clusters = [];
        for (const question of questions) {
          const cluster = clusters.find(rows => rows.every(row => cosine(row.vector, question.vector) >= LIMITS.questionSimilarity));
          if (cluster) cluster.push(question); else clusters.push([question]);
        }
        for (const rows of clusters) {
          const distinct = new Map();
          for (const row of rows) if (!distinct.has(row.document.sha256)) distinct.set(row.document.sha256, row);
          if (distinct.size < 2) continue;
          const support = [...distinct.values()];
          const quote = support[0].range.quote;
          interests.push({ id: 'question-' + (interests.filter(item => item.kind === 'question').length + 1),
            label: quote, question: quote, terms: [], kind: 'question', support: support.length,
            evidence: support.slice(0, LIMITS.evidencePerCandidate).map(row => evidence(row.document, row.range)) });
        }
        job.guard();
        const references = documents.map(document => ({ sourceId: document.sourceId,
          sourceVersionId: document.sourceVersionId, sha256: document.sha256 }));
        const inputFingerprint = await hash(JSON.stringify({ workspaceId, documents: references })); job.guard();
        const analysis = { createdAt: now(), model: modelId, modelRevision,
          adapter: 'local-embeddings-reconstructed-candidate', inputFingerprint,
          documents: references, interests: interests.sort((a, b) => b.support - a.support || a.id.localeCompare(b.id)).slice(0, LIMITS.candidates) };
        job.guard();
        check(bundle.workspaceId === workspaceId && bundle.revision === revision &&
          (settings.scopeRevision === undefined || settings.scopeRevision === revision), 'interest_analysis_stale');
        assertSelectedUnchanged(bundle, selectedVersions);
        return { workspaceId, scopeRevision: revision, analysis, limitations: [...limitations] };
      } finally { job.finish(); }
    }
    async function dispose() {
      if (disposed) return;
      disposed = true; cancel(); status = 'disposed';
      const prior = adapter; adapter = null; embed = undefined;
      await prior?.dispose?.();
    }
    return { prepare, encode, analyze, cancel, dispose,
      get status() { return status; } };
  }
  return Object.freeze({ create, LIMITS, TOPICS, DEFAULT_MODEL_ID, RUNTIME_VERSION });
});
