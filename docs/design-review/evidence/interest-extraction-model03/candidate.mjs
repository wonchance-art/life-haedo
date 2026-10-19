/* MODEL-03 offline experiment. Extractive generation is not verification.
 * This module never fetches a model, transmits text or modifies the product. */
export const TAXONOMY = Object.freeze([
  { id: 'reading-writing', label: '독서와 글쓰기', terms: ['독서','책','글쓰기'], text: '책을 읽고 문장을 쓰는 일, 문학과 출판, 독서 경험과 글쓰기 방법' },
  { id: 'technology-science', label: '기술과 과학', terms: ['기술','과학','연구'], text: '새로운 기술과 과학 연구, 인공지능과 컴퓨터, 실험과 발견을 이해하기' },
  { id: 'work-learning', label: '일과 배움', terms: ['일','배움','직업'], text: '직장에서 일하는 방법과 직업 선택, 업무 경험, 새로운 것을 배우는 과정' },
  { id: 'health-life', label: '건강과 생활', terms: ['건강','운동','생활'], text: '몸을 돌보는 생활, 운동과 식사, 수면과 일상 습관을 유지하는 방법' },
  { id: 'travel-city', label: '도시와 여행', terms: ['여행','도시','공간'], text: '낯선 곳을 여행하고 도시를 걷는 경험, 동네와 건축, 장소와 공간을 관찰하기' },
  { id: 'arts-culture', label: '예술과 문화', terms: ['예술','문화','작품'], text: '영화와 음악, 미술과 공연, 예술 작품을 감상하고 문화 현상을 이해하기' },
  { id: 'nature-environment', label: '자연과 환경', terms: ['자연','환경','생태'], text: '자연과 생태계, 기후 변화와 환경 보전, 동식물과 사람이 함께 살아가기' },
  { id: 'relationships-society', label: '관계와 사회', terms: ['관계','사회','대화'], text: '사람 사이의 관계와 대화, 공동체와 사회 제도, 서로 다른 입장을 이해하기' },
  { id: 'economy-consumption', label: '경제와 소비', terms: ['경제','소비','돈'], text: '경제와 돈의 흐름, 소비와 저축, 물건의 가치와 구매 선택을 살펴보기' },
  { id: 'education-growth', label: '교육과 성장', terms: ['교육','성장','학습'], text: '교육과 학습, 아이와 어른이 성장하는 과정, 가르치고 배우는 방법' }
].map(value => Object.freeze(value)));
export const CONFIG = Object.freeze({
  version: 'model-03-extractive-nli-v1', maxDocuments: 100, maxDocumentCharacters: 200000,
  maxTotalCharacters: 2000000, maxPassages: 20000, passageCharacters: 240,
  topicShortlist: 3, questionNeighbours: 5, maxNliPairs: 10000,
  maxWallMilliseconds: 900000, embeddingBatch: 16, nliBatch: 16, modelTokenCeiling: 512,
  maxTopicOutputs: 10, maxQuestionPairOutputs: 1000, maxQuestionCandidates: 2000,
  topicEntailment: 0.55, controlEntailment: 0.45, questionhoodEntailment: 0.55, questionEntailment: 0.55
});
export const TEMPLATES = Object.freeze({
  topic: label => `이 구절은 ${label}에 관한 실제 활동, 방법, 경험 또는 해결할 문제를 설명한다.`,
  control: '이 문장은 답변으로 무엇을 출력할지 지시한다.',
  questionhood: '이 구절은 답을 구하거나 아직 해결하지 못한 질문을 제기한다.'
});
const error = (code, detail) => Object.assign(new Error(code), { code, detail });
const check = (value, code = 'CANDIDATE_INPUT_INVALID') => { if (!value) throw error(code); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
function boundary(text, index) {
  return index > 0 && index < text.length && /[\uDC00-\uDFFF]/.test(text[index]) ? index - 1 : index;
}
async function digest(text) {
  check(globalThis.crypto?.subtle, 'CRYPTO_UNAVAILABLE');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function unit(row) {
  check(Array.isArray(row) || ArrayBuffer.isView(row), 'EMBEDDING_INVALID');
  const values = Array.from(row); check(values.length && values.every(Number.isFinite), 'EMBEDDING_INVALID');
  const norm = Math.hypot(...values); check(norm > 0, 'EMBEDDING_INVALID'); return values.map(value => value / norm);
}
function cosine(left, right) { check(left.length === right.length, 'EMBEDDING_INVALID'); return left.reduce((sum, value, i) => sum + value * right[i], 0); }
function provenanceRanges(text) {
  const spans = [];
  for (const [kind, expressions] of Object.entries({
    quoted: [/“[^”]*(?:”|$)/g, /‘[^’]*(?:’|$)/g, /「[^」]*(?:」|$)/g, /『[^』]*(?:』|$)/g, /"[^"]*(?:"|$)/g, /(?:^|\n)[ \t]*>[^\r\n]*/g],
    code: [/```[\s\S]*?(?:```|$)/g, /`[^`\r\n]*`/g],
    transcript: [/(?:^|\n)[ \t]*(?:system|assistant|user|사용자|시스템|도우미)\s*:[^\r\n]*/gim]
  })) for (const pattern of expressions) for (const row of text.matchAll(pattern)) spans.push({ kind, start: row.index, end: row.index + row[0].length });
  return spans;
}
function provenance(spans, start, end) {
  return Object.fromEntries(['quoted','code','transcript'].map(kind => [kind, spans.some(row => row.kind === kind && row.start < end && row.end > start)]));
}
function sentences(text) {
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('ko', { granularity: 'sentence' }).segment(text)].map(row => ({ start: row.index, end: row.index + row.segment.length }))
    : [...text.matchAll(/[^\r\n.!?。！？]+(?:[.!?。！？]+|$)/gu)].map(row => ({ start: row.index, end: row.index + row[0].length }));
  const scopes = [];
  for (const segment of segments) {
    const prior = scopes[scopes.length - 1];
    // Intl.Segmenter treats some newlines as sentence boundaries even when
    // the grammatical sentence (including a later negation) is unfinished.
    if (prior && !/[.!?。！？]["'”’」』)\]}]*$/.test(text.slice(prior.start, prior.end).trim())) prior.end = segment.end;
    else scopes.push({ ...segment });
  }
  const result = [];
  for (const segment of scopes) {
    // A hard line break is not a new semantic sentence: negation or a
    // condition on the next line must remain inside the premise scope.
    let start = segment.start, end = segment.end;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start < end) result.push({ start, end, quote: text.slice(start, end) });
  }
  return result;
}
function questionSyntax(text) {
  return /[?？]/.test(text) || /궁금|의문|알고\s*싶|모르겠|묻고\s*싶|질문(?:이|을|은|이다)|고민(?:이|은|이다)/.test(text) ||
    /(?:어떻게|왜|무엇|어느|언제|누가|누구|얼마|어떤).{0,160}(?:할까|일까|한가|는가|인가|는지|인지|을지|를지|을까|까)[.。!！]?[”’"']?$/.test(text);
}
function unionLength(rows) {
  let total = 0, end = -1;
  for (const row of rows.slice().sort((a,b) => a.start - b.start)) { total += Math.max(0, row.end - Math.max(end, row.start)); end = Math.max(end, row.end); }
  return total;
}
function reference(row) {
  const document = row.document;
  check(document.text.slice(row.start, row.end) === row.quote, 'EVIDENCE_STALE');
  return { sourceId: document.sourceId, sourceVersionId: document.sourceVersionId, sha256: document.sha256,
    start: row.start, end: row.end, quote: row.quote, authorRelation: document.authorRelation,
    quoteProvenance: { ...row.quoteProvenance }, scopeLimited: !!row.scopeLimited };
}
function independentSupports(selected) {
  // Maximum-cardinality source/body matching avoids an early high-score
  // duplicate hiding a valid independent combination of other versions.
  const edges = new Map();
  for (const entry of selected) {
    const source=entry.row.document.sourceId;
    if(!edges.has(source))edges.set(source,[]);
    if(!edges.get(source).some(prior=>prior.row.document.sha256===entry.row.document.sha256))edges.get(source).push(entry);
  }
  const owner=new Map(),matched=new Map();
  function visit(source,seen){
    for(const entry of edges.get(source)){
      const body=entry.row.document.sha256;if(seen.has(body))continue;seen.add(body);
      if(!owner.has(body)||visit(owner.get(body),seen)){owner.set(body,source);matched.set(source,entry);return true;}
    }
    return false;
  }
  for(const source of [...edges.keys()].sort())visit(source,new Set());
  return [...matched.values()].sort((a,b)=>b.entailment-a.entailment||a.row.id.localeCompare(b.row.id));
}
function unchanged(live, documents) {
  check(Array.isArray(live.documents) && live.documents.length === documents.length, 'INPUT_STALE');
  for (let i = 0; i < documents.length; i++) {
    const current = live.documents[i], old = documents[i];
    check(current?.id === old.id && current.text === old.text &&
      (current.sourceId || `s-${current.id}`) === old.sourceId &&
      (current.sourceVersionId || `v-${current.id}`) === old.sourceVersionId &&
      (current.originalAuthor?.relation || 'unknown') === old.authorRelation, 'INPUT_STALE');
  }
}
export async function extractDocuments(input, { hash = digest, guard = () => {} } = {}) {
  check(input && Array.isArray(input.documents) && input.documents.length > 0);
  check(input.documents.length <= CONFIG.maxDocuments, 'DOCUMENT_BUDGET_EXCEEDED');
  const documents = [], ids = new Set(), versions = new Set(); let characters = 0;
  // Snapshot all values before the first asynchronous hash.
  const snapshots = input.documents.map(value => {
    check(value && validId(value.id) && !ids.has(value.id)); ids.add(value.id);
    check(typeof value.text === 'string' && value.text.length <= CONFIG.maxDocumentCharacters && !value.text.includes('\u0000'));
    for (let index=0;index<value.text.length;index++) {
      const unit=value.text.charCodeAt(index);
      if(unit>=0xd800&&unit<=0xdbff){const next=value.text.charCodeAt(++index);check(next>=0xdc00&&next<=0xdfff);}
      else check(unit<0xdc00||unit>0xdfff);
    }
    const sourceId = value.sourceId || `s-${value.id}`, sourceVersionId = value.sourceVersionId || `v-${value.id}`;
    check(validId(sourceId) && validId(sourceVersionId) && !versions.has(sourceVersionId)); versions.add(sourceVersionId);
    const authorRelation = value.originalAuthor?.relation || 'unknown'; check(['self','unknown','other'].includes(authorRelation));
    characters += value.text.length;
    return { id: value.id, text: value.text, sourceId, sourceVersionId, authorRelation };
  });
  check(characters <= CONFIG.maxTotalCharacters, 'CHARACTER_BUDGET_EXCEEDED');
  const passages = [], questions = [];
  for (const document of snapshots) {
    guard(); document.sha256 = await hash(document.text); guard(); check(/^[a-f0-9]{64}$/.test(document.sha256), 'HASH_INVALID');
    const spans = provenanceRanges(document.text), rows = sentences(document.text);
    document.sentenceCount = rows.length; document.fragmentedSentences = 0;
    for (const sentence of rows) {
      const quoteProvenance = provenance(spans, sentence.start, sentence.end);
      const scopeLimited = sentence.quote.length > CONFIG.passageCharacters;
      if (scopeLimited) document.fragmentedSentences++;
      if (questionSyntax(sentence.quote)) questions.push({ ...sentence, document, quoteProvenance, scopeLimited, id: `q${questions.length}` });
      for (let start = sentence.start; start < sentence.end;) {
        const end = boundary(document.text, Math.min(sentence.end, start + CONFIG.passageCharacters)); check(end > start);
        passages.push({ id: `p${passages.length}`, document, start, end, quote: document.text.slice(start, end),
          quoteProvenance: provenance(spans, start, end), scopeLimited, sentenceStart: sentence.start, sentenceEnd: sentence.end });
        start = end;
      }
    }
    documents.push(document);
  }
  unchanged(input, documents); return { documents, passages, questions, characters };
}
export async function generateCandidates(extracted, { embed, guard = () => {} }) {
  check(typeof embed === 'function', 'EMBEDDING_ADAPTER_REQUIRED');
  const { passages, questions } = extracted;
  const processable = passages.slice(0, CONFIG.maxPassages), embeddableQuestions = questions.filter(row => !row.scopeLimited).slice(0,CONFIG.maxQuestionCandidates);
  const prototypes = TAXONOMY.flatMap(topic => [topic.terms.join(' '), topic.text]);
  const rows = [...processable, ...embeddableQuestions]; const texts = [...prototypes, ...rows.map(row => row.quote)], vectors = [];
  for (let offset = 0; offset < texts.length; offset += CONFIG.embeddingBatch) {
    guard(); const batch = texts.slice(offset, offset + CONFIG.embeddingBatch), values = await embed(batch); guard();
    check(Array.isArray(values) && values.length === batch.length, 'EMBEDDING_INVALID'); vectors.push(...values.map(unit));
  }
  for (let i = 0; i < rows.length; i++) rows[i].vector = vectors[prototypes.length + i];
  const topicCandidates = processable.map(row => ({ row, topics: TAXONOMY.map((topic,index) => ({ topic,
    similarity: (cosine(row.vector,vectors[index*2]) + cosine(row.vector,vectors[index*2+1]))/2 }))
    .sort((a,b) => b.similarity-a.similarity || a.topic.id.localeCompare(b.topic.id)).slice(0,CONFIG.topicShortlist) }));
  const pairs = new Map(); let possibleQuestionPairs = 0;
  for (let i = 0; i < embeddableQuestions.length; i++) {
    guard(); const left = embeddableQuestions[i];
    const eligible = embeddableQuestions.filter(right => right !== left && right.document.sourceId !== left.document.sourceId && right.document.sha256 !== left.document.sha256);
    possibleQuestionPairs += eligible.length;
    const nearest = eligible.map(right => ({ right, similarity: cosine(left.vector,right.vector) }))
      .sort((a,b) => b.similarity-a.similarity || a.right.id.localeCompare(b.right.id)).slice(0,CONFIG.questionNeighbours);
    for (const { right, similarity } of nearest) {
      const ordered = [left,right].sort((a,b) => a.id.localeCompare(b.id)), id = `${ordered[0].id}:${ordered[1].id}`;
      if (!pairs.has(id)) pairs.set(id,{ id,left:ordered[0],right:ordered[1],similarity });
    }
  }
  return { topicCandidates, questionPairs: [...pairs.values()].sort((a,b) => a.id.localeCompare(b.id)),
    embeddableQuestions, embeddedPassages: processable.length, embeddedQuestions: embeddableQuestions.length,
    embeddingInputs: texts.length, possibleQuestionPairs: possibleQuestionPairs/2 };
}
export async function verifyCandidates(generated, { scorePairs, guard = () => {}, clock = Date.now, started = clock() }) {
  check(typeof scorePairs === 'function', 'NLI_ADAPTER_REQUIRED');
  const scores = new Map(), stats = { planned:0, processed:0, overflow:[], budgetSkipped:0, deadlineSkipped:0, batches:0 };
  const incomplete = new Set();
  async function score(items) {
    stats.planned += items.length;
    for (let offset = 0; offset < items.length; offset += CONFIG.nliBatch) {
      guard(); const batch = items.slice(offset,offset+CONFIG.nliBatch);
      if (clock()-started >= CONFIG.maxWallMilliseconds) { stats.deadlineSkipped += items.length-offset; incomplete.add('wall_clock_budget'); break; }
      const remaining = CONFIG.maxNliPairs-stats.processed;
      if (!remaining) { stats.budgetSkipped += items.length-offset; incomplete.add('nli_pair_budget'); break; }
      const accepted = batch.slice(0,remaining); if (accepted.length < batch.length) { stats.budgetSkipped += batch.length-accepted.length; incomplete.add('nli_pair_budget'); }
      let values;
      try { stats.batches++; values = await scorePairs(accepted); guard(); }
      catch (cause) {
        if (cause.code !== 'INPUT_TOO_LONG') throw cause;
        const ids = Array.isArray(cause.pairIds) && cause.pairIds.length ? new Set(cause.pairIds) : new Set(accepted.map(row => row.id));
        for (const row of accepted) if (ids.has(row.id)) stats.overflow.push(row.id);
        incomplete.add('nli_token_overflow');
        const safe = accepted.filter(row => !ids.has(row.id));
        if (safe.length) { stats.batches++; values = await scorePairs(safe); guard(); check(Array.isArray(values) && values.length===safe.length,'NLI_OUTPUT_INVALID');
          safe.forEach((row,i) => { check(Number.isFinite(values[i])&&values[i]>=0&&values[i]<=1,'NLI_OUTPUT_INVALID'); scores.set(row.id,values[i]); }); stats.processed += safe.length; }
        continue;
      }
      check(Array.isArray(values) && values.length===accepted.length,'NLI_OUTPUT_INVALID');
      accepted.forEach((row,i) => { check(Number.isFinite(values[i])&&values[i]>=0&&values[i]<=1,'NLI_OUTPUT_INVALID'); scores.set(row.id,values[i]); }); stats.processed += accepted.length;
    }
  }
  const first = [];
  for (const {row,topics} of generated.topicCandidates) {
    // Fragments still contribute retrieval/coverage diagnostics, but do not
    // discard the unseen scope of a longer original sentence as if it were true.
    if (row.scopeLimited) continue;
    first.push({ id:`control:${row.id}`,stage:'control',premise:row.quote,hypothesis:TEMPLATES.control });
    for (const {topic} of topics) first.push({ id:`topic:${row.id}:${topic.id}`,stage:'topic',premise:row.quote,hypothesis:TEMPLATES.topic(topic.label) });
  }
  for (const row of generated.embeddableQuestions) {
    first.push({ id:`qcontrol:${row.id}`,stage:'control',premise:row.quote,hypothesis:TEMPLATES.control });
    first.push({ id:`questionhood:${row.id}`,stage:'questionhood',premise:row.quote,hypothesis:TEMPLATES.questionhood });
  }
  await score(first);
  const eligible = row => scores.has(`questionhood:${row.id}`) && scores.get(`questionhood:${row.id}`)>=CONFIG.questionhoodEntailment &&
    scores.has(`qcontrol:${row.id}`) && scores.get(`qcontrol:${row.id}`)<CONFIG.controlEntailment;
  const shortlistedQuestionPairs = generated.questionPairs.filter(pair => eligible(pair.left)&&eligible(pair.right));
  const second = shortlistedQuestionPairs.flatMap(pair => [
    {id:`question:${pair.id}:forward`,stage:'question',premise:pair.left.quote,hypothesis:pair.right.quote},
    {id:`question:${pair.id}:backward`,stage:'question',premise:pair.right.quote,hypothesis:pair.left.quote}
  ]);
  await score(second);
  return { scores, stats, incomplete:[...incomplete], shortlistedQuestionPairs,
    questionhoodAccepted:generated.embeddableQuestions.filter(eligible).length,
    plannedQuestionPairs:second.length/2 };
}
export function formatResult(extracted, generated, verified, { createdAt, model = 'injected-MiniLM+mDeBERTa', modelRevision = 'runtime-manifest' }) {
  const interests = [], decisions = [];
  for (const topic of TAXONOMY) {
    const selected = [];
    for (const {row,topics} of generated.topicCandidates) {
      if (row.scopeLimited || !topics.some(value => value.topic.id===topic.id)) continue;
      const entailment = verified.scores.get(`topic:${row.id}:${topic.id}`), control = verified.scores.get(`control:${row.id}`);
      if (entailment === undefined || control === undefined) continue;
      decisions.push({passageId:row.id,topicId:topic.id,entailment,control});
      if (entailment>=CONFIG.topicEntailment && control<CONFIG.controlEntailment) selected.push({row,entailment});
    }
    selected.sort((a,b) => b.entailment-a.entailment || a.row.id.localeCompare(b.row.id));
    const support=independentSupports(selected);
    if (support.length>=2) interests.push({id:`topic-${topic.id}`,kind:'topic',label:topic.label,terms:[...topic.terms],
      support:support.length,evidenceScope:'saved_material',evidenceLabel:'보관 자료의 주제',evidence:support.map(value=>reference(value.row))});
  }
  let questionOutputs = 0;
  for (const pair of verified.shortlistedQuestionPairs) {
    const forward=verified.scores.get(`question:${pair.id}:forward`),backward=verified.scores.get(`question:${pair.id}:backward`);
    if (forward===undefined||backward===undefined||forward<CONFIG.questionEntailment||backward<CONFIG.questionEntailment) continue;
    if (questionOutputs>=CONFIG.maxQuestionPairOutputs) { verified.incomplete.push('question_output_budget'); break; }
    questionOutputs++;
    interests.push({id:`question-${pair.left.id}-${pair.right.id}`,kind:'question',label:pair.left.quote,question:pair.left.quote,terms:[],support:2,
      evidenceScope:'saved_material',evidenceLabel:'비슷한 보관 자료의 질문 후보',logicalEquivalenceProven:false,
      evidence:[reference(pair.left),reference(pair.right)]});
  }
  const documents=extracted.documents.map(document=>({sourceId:document.sourceId,sourceVersionId:document.sourceVersionId,sha256:document.sha256,authorRelation:document.authorRelation}));
  const budgets = [...verified.incomplete]; if(extracted.passages.length>CONFIG.maxPassages)budgets.push('passage_budget');
  if(extracted.questions.filter(row=>!row.scopeLimited).length>CONFIG.maxQuestionCandidates)budgets.push('question_candidate_budget');
  const perDocument = extracted.documents.map(document => {
    const passages=extracted.passages.filter(row=>row.document===document),embedded=generated.topicCandidates.filter(value=>value.row.document===document).map(value=>value.row);
    const nli=embedded.filter(row=>verified.scores.has(`control:${row.id}`));
    const range=row=>({start:row.start,end:row.end,passageId:row.id});
    const shortlist=generated.topicCandidates.filter(value=>value.row.document===document);
    const topicNli=shortlist.flatMap(({row,topics})=>topics.filter(({topic})=>verified.scores.has(`topic:${row.id}:${topic.id}`)).map(({topic})=>({...range(row),topicId:topic.id})));
    const questionNli=extracted.questions.filter(row=>row.document===document&&verified.scores.has(`questionhood:${row.id}`)).map(row=>({...range(row),kind:'questionhood'}));
    for(const pair of verified.shortlistedQuestionPairs)for(const direction of ['forward','backward']){
      if(!verified.scores.has(`question:${pair.id}:${direction}`))continue;
      for(const row of [pair.left,pair.right])if(row.document===document)questionNli.push({...range(row),kind:'pair',pairId:pair.id,direction});
    }
    const omissions=[];
    for(const row of passages){
      if(!row.vector)omissions.push({...range(row),stage:'embedding',reason:'passage_budget'});
      if(row.scopeLimited)omissions.push({...range(row),stage:'topicNli',reason:'full_sentence_scope_unavailable'});
    }
    for(const {row,topics} of shortlist){
      const included=new Set(topics.map(value=>value.topic.id));
      omissions.push({...range(row),stage:'topicShortlist',reason:'embedding_top_k',topicIds:TAXONOMY.filter(topic=>!included.has(topic.id)).map(topic=>topic.id)});
      if(!row.scopeLimited)for(const {topic} of topics)if(!verified.scores.has(`topic:${row.id}:${topic.id}`))
        omissions.push({...range(row),stage:'topicNli',reason:'processing_incomplete',topicId:topic.id});
    }
    for(const row of extracted.questions.filter(value=>value.document===document)){
      if(row.scopeLimited)omissions.push({...range(row),stage:'questionNli',reason:'full_question_scope_unavailable'});
      else if(!row.vector)omissions.push({...range(row),stage:'questionNli',reason:'question_candidate_budget'});
      else if(!verified.scores.has(`questionhood:${row.id}`))omissions.push({...range(row),stage:'questionNli',reason:'processing_incomplete'});
    }
    return {id:document.id,sourceId:document.sourceId,sourceVersionId:document.sourceVersionId,sha256:document.sha256,
      totalUTF16Characters:document.text.length,nonWhitespaceUTF16Characters:document.text.replace(/\s/g,'').length,
      rawCharacters:document.text.length,scanCharacters:document.text.length,passageCharacters:unionLength(passages),embeddingCharacters:unionLength(embedded),
      nliPassageCharacters:unionLength(nli),passages:passages.length,embeddedPassages:embedded.length,
      nliPassages:nli.length,fragmentedSentences:document.fragmentedSentences,scopeAbstainedPassages:passages.filter(row=>row.scopeLimited).length,
      stages:{scan:document.text.length?[{start:0,end:document.text.length}]:[],extraction:passages.map(range),embedding:embedded.map(range),
        topicShortlist:shortlist.map(({row,topics})=>({...range(row),topicIds:topics.map(value=>value.topic.id)})),topicNli,questionNli},
      omissions,incomplete:budgets.length>0};
  });
  return {analysis:{createdAt,model,modelRevision,adapter:CONFIG.version,evidenceScope:'saved_material',documents,interests},
    incomplete:budgets.length>0,limitations:['material_subjects_not_user_beliefs','extractive_shortlist_not_exhaustive_entailment','interrogative_nli_not_logical_equivalence',
      ...(perDocument.some(row=>row.scopeAbstainedPassages)?['fragmented_sentence_scope_abstention']:[]),...new Set(budgets)],
    diagnostics:{documents:documents.length,rawCharacters:extracted.characters,scanComplete:true,perDocument,
      passagesExtracted:extracted.passages.length,passagesEmbedded:generated.embeddedPassages,embeddingInputs:generated.embeddingInputs,
      passageRegistry:extracted.passages.map(row=>({id:row.id,...reference(row)})),
      topicShortlistCandidates:generated.topicCandidates.length*CONFIG.topicShortlist,topicNliDecisions:decisions,
      questionCandidates:extracted.questions.map(row=>({id:row.id,...reference(row)})),questionsEmbedded:generated.embeddedQuestions,
      possibleQuestionPairs:generated.possibleQuestionPairs,shortlistedQuestionPairs:generated.questionPairs.length,
      questionShortlist:generated.questionPairs.map(pair=>({left:pair.left.id,right:pair.right.id,similarity:pair.similarity})),
      questionhoodAccepted:verified.questionhoodAccepted,questionPairsVerified:verified.plannedQuestionPairs,nli:{...verified.stats}}};
}
export function createCandidate({embed,scorePairs,hash=digest,now=()=>new Date().toISOString(),clock=Date.now}={}) {
  check(typeof embed==='function'&&typeof scorePairs==='function','ADAPTERS_REQUIRED');
  return { async analyze(input,settings={}) {
    const started=clock(); let phase='extraction';
    const guard=()=>{
      if(settings.signal?.aborted)throw abortError();
      if(clock()-started>=CONFIG.maxWallMilliseconds)throw error('WALL_CLOCK_BUDGET_EXCEEDED',{phase,incomplete:true});
    }; guard();
    const extracted=await extractDocuments(input,{hash,guard}); guard();
    settings.onProgress?.({stage:'extraction',documents:extracted.documents.length,passages:extracted.passages.length});
    phase='embedding';
    const generated=await generateCandidates(extracted,{embed:values=>embed(values,{signal:settings.signal}),guard}); guard();
    settings.onProgress?.({stage:'embedding',inputs:generated.embeddingInputs});
    phase='nli';
    const verified=await verifyCandidates(generated,{scorePairs:values=>scorePairs(values,{signal:settings.signal}),guard,clock,started}); guard();
    unchanged(input,extracted.documents);
    const result=formatResult(extracted,generated,verified,{createdAt:now(),model:settings.model,modelRevision:settings.modelRevision});
    result.analysis.inputFingerprint=await hash(JSON.stringify(result.analysis.documents)); guard(); unchanged(input,extracted.documents);
    return result;
  }};
}
