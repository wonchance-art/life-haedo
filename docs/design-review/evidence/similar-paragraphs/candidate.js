/* 비슷한 문단 실험 후보. 브라우저 실행면과 Node 평가기가 같은 파일을 쓴다.
 * 의미를 단정하지 않는다: 같은 문서·같은 본문 복제를 빼고 코사인 점수가 임계값 이상인
 * 다른 문서 문단을 최대 3개 후보로만 낸다. 외부 호출·저장 없음. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SimilarParagraphs = api;
})(globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ results: 3, pieceCharacters: 400, minimumCharacters: 10 });
  const VARIANTS = Object.freeze(['P', 'TP', 'W2']);
  const normalize = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  // 문장 끝: 마침표·물음표·느낌표·말줄임 뒤 공백. 한국어 종결 어미를 추정하지 않는다.
  function sentences(text) {
    const parts = [], pattern = /[^.!?。…]+(?:[.!?。…]+|$)/gu;
    for (const match of text.matchAll(pattern)) { const value = match[0].trim(); if (value) parts.push(value); }
    return parts.length ? parts : [text.trim()];
  }
  // 긴 문단은 문장 경계에서 400자 이하 조각으로 나눈다(무음 절단 없음). 한 문장이 400자를
  // 넘으면 그 문장만 400자 단위로 자른다. 기록에 조각 수를 남긴다.
  function pieces(text) {
    if (text.length <= LIMITS.pieceCharacters) return [text];
    const result = []; let current = '';
    for (const sentence of sentences(text)) {
      const units = [];
      for (let start = 0; start < sentence.length; start += LIMITS.pieceCharacters) units.push(sentence.slice(start, start + LIMITS.pieceCharacters));
      for (const unit of units) {
        if (current && current.length + 1 + unit.length > LIMITS.pieceCharacters) { result.push(current); current = ''; }
        current = current ? current + ' ' + unit : unit;
      }
    }
    if (current) result.push(current);
    return result;
  }
  // 기본 문단: 빈 줄로 나눈 덩어리. 10자 미만(제목·구분선)은 색인하지 않는다.
  function paragraphs(document) {
    const result = [], pattern = /[^\n]+(?:\n(?![ \t]*\n)[^\n]*)*/gu;
    let index = 0;
    for (const match of document.text.matchAll(pattern)) {
      const raw = match[0], text = raw.trim();
      if (!text) continue;
      const start = match.index + raw.indexOf(text);
      const entry = { docId: document.id, index: index++, start, end: start + text.length, text };
      entry.indexed = normalize(text).length >= LIMITS.minimumCharacters;
      result.push(entry);
    }
    return result;
  }
  // 변형별 임베딩 입력. P: 문단 그대로, TP: 문서 제목 + 줄바꿈 + 문단, W2: 두 문장 창(보폭 1).
  function embeddingInputs(document, paragraph, variant) {
    if (!VARIANTS.includes(variant)) throw new Error('unknown variant');
    if (variant === 'P') return pieces(paragraph.text);
    if (variant === 'TP') return pieces(paragraph.text).map(piece => document.title + '\n' + piece);
    const list = sentences(paragraph.text);
    if (list.length <= 2) return pieces(paragraph.text);
    const windows = [];
    for (let index = 0; index + 1 < list.length; index++) windows.push(...pieces(list[index] + ' ' + list[index + 1]));
    return windows;
  }
  function dot(a, b) { let total = 0; for (let index = 0; index < a.length; index++) total += a[index] * b[index]; return total; }
  // 문단 점수 = 두 문단 조각 벡터 쌍의 최대 코사인(벡터는 워커가 정규화해 돌려준다).
  function score(seedVectors, candidateVectors) {
    let best = -Infinity;
    for (const a of seedVectors) for (const b of candidateVectors) { const value = dot(a, b); if (value > best) best = value; }
    return best;
  }
  /* index: [{ id, docId, normalized, vectors }] (색인 대상만). seed는 같은 형식.
   * 같은 문서와 정규화 본문이 같은 복제를 빼고, threshold 이상만 점수순 최대 3개. */
  function similar(index, seed, threshold, limit = LIMITS.results) {
    const results = [];
    for (const entry of index) {
      if (entry.id === seed.id || entry.docId === seed.docId || entry.normalized === seed.normalized) continue;
      const value = score(seed.vectors, entry.vectors);
      if (value >= threshold) results.push({ id: entry.id, score: value });
    }
    results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return results.slice(0, limit);
  }
  // 저장 형식(크기 기준): 문단 id·본문 SHA-256·Float32 리틀엔디언 벡터의 base64를 담은 JSON.
  function float32Base64(vectors) {
    const flat = new Float32Array(vectors.length * (vectors[0]?.length || 0));
    vectors.forEach((vector, row) => flat.set(vector, row * vector.length));
    const bytes = new Uint8Array(flat.buffer);
    let binary = '';
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(start, start + 0x8000));
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  }
  function decodeFloat32(base64, dimensions) {
    const bytes = typeof atob === 'function' ? Uint8Array.from(atob(base64), char => char.charCodeAt(0)) : new Uint8Array(Buffer.from(base64, 'base64'));
    const flat = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), rows = [];
    for (let start = 0; start < flat.length; start += dimensions) rows.push(Array.from(flat.subarray(start, start + dimensions)));
    return rows;
  }
  return Object.freeze({ LIMITS, VARIANTS, normalize, sentences, pieces, paragraphs, embeddingInputs, score, similar, float32Base64, decodeFloat32 });
});
