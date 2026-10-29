'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Discovery = require('../assets/life/discovery.js');
const Core = require('../assets/life/core.js');
const NOW = '2026-10-19T00:00:00.000Z';
const rights = mode => ({ label: '합성 공개 권리 표기', url: 'https://d2.naver.com/', mode });
function article(id, title, extra = {}) {
  return { id, sourceId: 'naver-d2', url: `https://d2.naver.com/helloworld/${id}`, title, publishedAt: '2026-10-18T00:00:00.000Z',
    author: '공개 작성자', language: 'ko', summary: '', coverage: 'link_only', rights: rights('metadata_only'), fetchedAt: NOW, tags: [], ...extra };
}
function feed(articles) {
  return { schemaVersion: 1, generatedAt: NOW, sources: [{ id: 'naver-d2', name: 'NAVER D2', url: 'https://d2.naver.com/', feedUrl: 'https://d2.naver.com/d2.atom',
    language: 'ko', rights: rights('metadata_only'), status: 'ok', lastSuccessAt: NOW, lastAttemptAt: NOW, error: null, stale: false }], articles };
}
const profile = label => ({ manual: [{ id: 'manual-1', label }] });
const rank = (catalog, label = '인공지능', extra = {}) => Discovery.rank(catalog, { profile: profile(label), now: NOW, ...extra });
const response = (catalog, headers) => new Response(JSON.stringify(catalog), { headers: { 'content-type': 'application/json', ...headers } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
function rasterHeader(mimeType, width = 1, height = 1, variant = 'VP8X') {
  if (mimeType === 'image/png') {
    const bytes = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
  }
  if (mimeType === 'image/jpeg') {
    const bytes = Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217]);
    bytes.writeUInt16BE(height, 13); bytes.writeUInt16BE(width, 15); return bytes;
  }
  const bytes = Buffer.alloc(variant === 'VP8L' ? 26 : 30); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8); bytes.write(variant, 12);
  bytes.writeUInt32LE(variant === 'VP8L' ? 5 : 10, 16);
  if (variant === 'VP8X') { bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); }
  else if (variant === 'VP8L') { bytes[20] = 0x2f; bytes.writeUInt32LE((width - 1) + (height - 1) * 16384, 21); }
  else { Buffer.from([157, 1, 42]).copy(bytes, 23); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); }
  return bytes;
}
function picture(extra = {}) {
  return { mimeType: 'image/png', dataBase64: rasterHeader('image/png').toString('base64'),
    alt: '합성 그림', caption: '합성 설명', credit: '합성 작성자', license: { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    sourceUrl: 'https://d2.naver.com/images/synthetic.png', ...extra };
}
test('canonical identity removes only tracking and fragments while preserving raw meaningful query spelling and order', () => {
  assert.equal(Discovery.canonicalUrl('https://D2.NAVER.COM:443/a?newsId=17&q=one%20two&x=~&x=2&utm_source=r&ref=book#section'), 'https://d2.naver.com/a?newsId=17&q=one%20two&x=~&x=2&ref=book');
  assert.notEqual(Discovery.canonicalUrl('https://d2.naver.com/a?id=1'), Discovery.canonicalUrl('https://d2.naver.com/a?id=2'));
  for (const url of ['javascript:alert(1)', 'http://d2.naver.com/a', 'https://u:p@d2.naver.com/a', 'https://d2.naver.com:8443/a']) assert.equal(Discovery.canonicalUrl(url), null);
});
test('only approved exact HTTPS hosts are accepted; malformed entries are explained and never ranked', () => {
  const catalog = feed([article('good', '인공지능 연구'), article('evil', '인공지능 연구', { url: 'https://d2.naver.com.evil.example/a' })]);
  const validated = Discovery.validateFeed(catalog, { now: NOW }); assert.equal(validated.articles.length, 1); assert.equal(validated.validation.invalid.length, 1);
  const result = rank(validated); assert.equal(result.items.length, 1); assert.equal(result.metadata.excluded.invalid, 1);
  catalog.sources[0].url = 'https://unapproved.example/'; assert.throws(() => Discovery.validateFeed(catalog), { code: 'discovery_feed_invalid' });
});
test('manual labels alone drive retrieval; inferred interests and positive words extracted from negated labels are not used', () => {
  const catalog = feed([article('ai', '인공지능을 활용하는 방법')]);
  assert.equal(Discovery.rank(catalog, { profile: { manual: [], analysis: { interests: [{ label: '인공지능' }] } }, now: NOW }).items.length, 0);
  assert.equal(rank(catalog, '인공지능에는 관심이 없다').items.length, 0);
  assert.equal(rank(catalog, '기술과 과학').items.length, 0);
});
test('reviewed book, environment and psychology sources accept their exact HTTPS hosts while rejecting lookalikes', () => {
  for (const [sourceId, host] of [['readersnews-books', 'www.readersnews.com'], ['seoul-environment', 'news.seoul.go.kr'], ['frontiers-psychology', 'www.frontiersin.org']]) {
    const catalog = feed([article('new-public', '신간 소개')]);
    Object.assign(catalog.sources[0], { id: sourceId, name: '검토한 공개 출처', url: `https://${host}/`, feedUrl: `https://${host}/feed` });
    Object.assign(catalog.articles[0], { sourceId, url: `https://${host}/article?id=1` });
    assert.equal(rank(catalog, '신간').items.length, 1);
    catalog.articles[0].url = `https://${host}.evil.example/article?id=1`;
    assert.equal(rank(catalog, '신간').items.length, 0);
  }
});
test('Korean particles are boundaries while unrelated word substrings and English substrings are rejected', () => {
  const catalog = feed([article('actor', '배우와 배경을 살펴본다'), article('pear', '배를 기르는 방법'), article('rail', 'RAIL PAID details'), article('ai', 'AI tools')]);
  const korean = rank(catalog, '배'); assert.deepEqual(korean.items.map(row => row.article.id), ['pear']); assert.equal(korean.items[0].reasons[0].quote, '배');
  const english = rank(catalog, '인공지능'); assert.deepEqual(english.items.map(row => row.article.id), ['ai']); assert.equal(english.items[0].reasons[0].via, 'alias');
});
test('ambiguous broad translations are not silently added to a manual topic', () => {
  const result = rank(feed([article('city', 'Reading city railway guide')]), '독서'); assert.equal(result.items.length, 0);
  assert(Discovery.ALIASES.some(group => group.includes('artificial intelligence')));
});
test('Latin interest terms accept complete Korean particles without admitting arbitrary continuations', () => {
  const catalog = feed([
    article('ai-subject', '😀 AI가 분석한 결과'), article('ai-object', 'AI에게 실패를 묻다'),
    article('ai-chain', 'AI에서도 확인한 표현'), article('wrong-word', 'RAIL PAID details'),
    article('wrong-tail', 'AI가나다 이야기'), article('performance-brand', '공연봄날 운영 안내')
  ]);
  const result = rank(catalog, 'AI');
  assert.deepEqual(result.items.map(row => row.article.id).sort(), ['ai-chain', 'ai-object', 'ai-subject']);
  for (const row of result.items) for (const reason of row.reasons) {
    assert.equal(reason.field, 'title'); assert.equal(reason.quote, 'AI');
    assert.equal(row.article.title.slice(reason.start, reason.end), reason.quote);
  }
  assert.equal(rank(catalog, '공연').items.length, 0);
});
test('word boundaries use complete Unicode code points while evidence stays in exact UTF16 offsets', () => {
  const catalog = feed([article('prefix', '𐐀AI'), article('suffix', 'AI𐐀'), article('valid', '😀 AI가 분석한 표현')]);
  const result = rank(catalog, 'AI'); assert.deepEqual(result.items.map(row => row.article.id), ['valid']);
  const reason = result.items[0].reasons[0]; assert.equal(reason.start, 3); assert.equal(reason.end, 5); assert.equal(reason.quote, 'AI');
  const astral = rank(feed([article('inside', '𐐀𐐁'), article('astral-valid', '😀 𐐀의 자료')]), '𐐀');
  assert.deepEqual(astral.items.map(row => row.article.id), ['astral-valid']);
  const span = astral.items[0].reasons[0]; assert.equal(span.start, 3); assert.equal(span.end, 5);
  assert.equal(astral.items[0].article.title.slice(span.start, span.end), span.quote);
});
test('only the reviewed linguistics label crosses Korean/English and longer interests retain their literal scope', () => {
  const catalog = feed([article('english', 'A research update', { language: 'en', tags: ['Linguistics'] }), article('korean', '언어학의 공개 연구')]);
  const korean = rank(catalog, '언어학'), english = rank(catalog, 'linguistics');
  assert.deepEqual(korean.items.map(row => row.article.id), ['korean', 'english']);
  assert.deepEqual(english.items.map(row => row.article.id), ['korean', 'english']);
  assert.equal(korean.items.find(row => row.article.id === 'english').reasons[0].via, 'alias');
  for (const label of ['언어', '언어 관련 연구 및 조언', '언어 학습', '언어학에는 관심이 없다']) assert.equal(rank(catalog, label).items.length, 0);
});
test('every reason reproduces the exact public field span including emoji and CRLF offsets', () => {
  const catalog = feed([article('offsets', '😀 인공지능의 연구\r\n이야기', { tags: ['인공지능'] })]); const result = rank(catalog);
  for (const reason of result.items[0].reasons) { const item = result.items[0].article; const raw = reason.field === 'tags' ? item.tags[reason.tagIndex] : item[reason.field]; assert.equal(raw.slice(reason.start, reason.end), reason.quote); assert.equal(reason.interestLabel, '인공지능'); }
});
test('reviewed language learning and education expressions stay separate with exact original spans', () => {
  const catalog = feed([
    article('learn-english', '😀 Language learning\r\nresearch'),
    article('learn-korean', '언어학습을 기록한다'),
    article('education-english', '공개 자료', { tags: ['LANGUAGE EDUCATION'] }),
    article('education-korean', '언어 교육의 연구'),
    article('not-a-phrase', 'Languages learning and language learners')
  ]), before = JSON.stringify(catalog);
  for (const [labels, ids] of [
    [['언어 학습', '언어학습', 'language learning'], ['learn-english', 'learn-korean']],
    [['언어 교육', '언어교육', 'language education'], ['education-english', 'education-korean']]
  ]) for (const label of labels) {
    const result = rank(catalog, label);
    assert.deepEqual(result.items.map(row => row.article.id).sort(), ids);
    for (const row of result.items) for (const reason of row.reasons) {
      const original = reason.field === 'tags' ? row.article.tags[reason.tagIndex] : row.article[reason.field];
      assert.equal(original.slice(reason.start, reason.end), reason.quote);
      assert.equal(reason.interestLabel, label);
    }
  }
  const english = rank(catalog, '언어학습').items.find(row => row.article.id === 'learn-english');
  assert.deepEqual(english.reasons.map(({ start, end, quote, via }) => ({ start, end, quote, via })),
    [{ start: 3, end: 20, quote: 'Language learning', via: 'alias' }]);
  for (const label of ['언어 관련 연구 및 조언', '언어 학습에는 관심이 없다', 'second language acquisition']) assert.equal(rank(catalog, label).eligibleCount, 0);
  assert.equal(JSON.stringify(catalog), before, 'aliases never rewrite the publisher title or tags');
});
test('reviewed foreign-language, book-reading and grit aliases preserve narrow phrases and exact UTF16 evidence', () => {
  const catalog = feed([
    article('foreign', '😀 Foreign language learning\r\nresearch'), article('book', 'Book reading study'), article('grit', '😀 GRIT의 연구'),
    article('generic', 'Reading instruments, concentration chemistry and attention models'), article('substring', 'gritty grits book readings'),
    article('second', 'Second language learning study')
  ]), before = JSON.stringify(catalog);
  for (const [labels, expected] of [
    [['외국어 학습', '외국어학습', 'foreign language learning'], 'foreign'],
    [['독서', '책 읽기', 'book reading'], 'book'], [['그릿', 'grit'], 'grit']
  ]) for (const label of labels) {
    const result = rank(catalog, label), row = result.items.find(item => item.article.id === expected);
    assert(row, label); assert(!result.items.some(item => ['generic', 'substring'].includes(item.article.id)));
    for (const reason of row.reasons) { assert.equal(row.article.title.slice(reason.start, reason.end), reason.quote); assert.equal(reason.interestLabel, label); }
  }
  const span = rank(catalog, '외국어학습').items.find(item => item.article.id === 'foreign').reasons[0];
  assert.deepEqual({ start: span.start, end: span.end, quote: span.quote, via: span.via }, { start: 3, end: 28, quote: 'Foreign language learning', via: 'alias' });
  assert.equal(rank(catalog, 'foreign language learning').items.some(item => item.article.id === 'second'), false, 'English equivalent never inherits Korean directional terms');
  for (const label of ['집중력', '외국어 학습에는 관심이 없다', '독서와 집중력', '그릿은 원하지 않는다']) assert.equal(rank(catalog, label).eligibleCount, 0);
  assert.equal(JSON.stringify(catalog), before);
});
test('directional related phrases apply only to exact manual labels and actual title spans', () => {
  const catalog = feed([
    article('efl', '😀 The impact on EFL/ESL learning'), article('reading', '😀 L2 reading comprehension\r\nresearch'),
    article('esl', 'ESL learning study'), article('second', 'Second language learning study'),
    article('attention', '😀 Sustained attention improves in this study'), article('wandering', 'When readers’ minds wander'),
    article('mind-wandering', 'Research on mind wandering'),
    article('tag-only', 'Another study', { tags: ['sustained attention', 'reading comprehension', 'EFL/ESL learning'] }),
    article('summary-only', 'Another study', { summary: 'sustained attention', coverage: 'summary', rights: rights('summary_allowed') }),
    article('body-only', 'Another study', { bodyText: 'sustained attention', coverage: 'full_text', rights: rights('full_text_allowed') }),
    article('generic', 'EFL ESL L2 reading attention concentration persistence'), article('longer', 'minds wanderers and sustained attentional study')
  ]), before = JSON.stringify(catalog);
  for (const [label, expected] of [['외국어 학습', ['efl', 'esl', 'second']], ['외국어학습', ['efl', 'esl', 'second']], ['독서', ['reading']], ['책 읽기', ['reading']], ['집중력', ['attention', 'mind-wandering', 'wandering']]]) {
    const result = rank(catalog, label); assert.deepEqual(result.items.map(row => row.article.id).sort(), expected);
    for (const row of result.items) for (const reason of row.reasons) {
      assert.equal(reason.field, 'title'); assert.equal(reason.via, 'related'); assert.equal(reason.interestLabel, label);
      assert.equal(row.article.title.slice(reason.start, reason.end), reason.quote);
    }
  }
  const attention = rank(catalog, '집중력').items.find(row => row.article.id === 'attention').reasons[0];
  assert.equal(attention.start, 3); assert.equal(attention.end, 22); assert.equal(attention.quote, 'Sustained attention');
  assert.equal(rank(feed([article('reverse', '집중력 독서 외국어 학습')]), 'sustained attention').eligibleCount, 0);
  assert.equal(rank(feed([article('reverse', '독서')]), 'reading comprehension').eligibleCount, 0);
  assert.equal(rank(feed([article('reverse', '외국어 학습')]), 'ESL learning').eligibleCount, 0);
  assert.equal(rank(catalog, 'book reading').eligibleCount, 0, 'alias expansion does not chain into related phrases');
  assert.equal(JSON.stringify(catalog), before);
});
test('related title evidence does not duplicate overlapping phrases or displace stronger exact and alias evidence', () => {
  const catalog = feed([
    article('overlap', '😀 EFL/ESL learning'), article('alias', 'Foreign language learning'),
    article('tag', 'Another title', { tags: ['외국어 학습'] }), article('exact', '외국어 학습의 연구')
  ]);
  const result = rank(catalog, '외국어 학습');
  assert.deepEqual(result.items.map(row => row.article.id), ['alias', 'exact', 'tag', 'overlap']);
  const overlap = result.items.find(row => row.article.id === 'overlap');
  assert.deepEqual(overlap.reasons.map(({ quote, via }) => ({ quote, via })), [{ quote: 'EFL/ESL learning', via: 'related' }]);
  const alias = result.items.find(row => row.article.id === 'alias'); assert.equal(alias.reasons.length, 1); assert.equal(alias.reasons[0].via, 'alias');
  const pool = Discovery.candidatePool(catalog, { profile: profile('외국어 학습'), now: NOW });
  const related = pool.pool.find(row => row.article.id === 'overlap'); assert.equal(related.strength, 4); assert.equal(related.interests, 1);
  assert(pool.pool.filter(row => row.article.id !== 'overlap').every(row => row.strength > related.strength));
  assert(Discovery.RELATED_TERMS['외국어 학습'].includes('EFL/ESL learning'));
  assert(!Discovery.ALIASES.flat().includes('EFL/ESL learning'), 'directional terms never enter the personal alias feature table');
});
test('two distinct publisher-title fixtures are reachable without broadening a topic into generic words', () => {
  const catalog = feed([
    article('meta-analysis', 'The cognitive-affective impact of generative AI on EFL/ESL learning: A meta-analysis'),
    article('l2-reading', 'When readers’ minds wander: How cognitive and affective variables shape mobile-assisted L2 reading comprehension')
  ]), before = JSON.stringify(catalog);
  const result = Discovery.rank(catalog, { now: NOW, profile: { manual: ['외국어 학습', '독서', '집중력', 'Grit'].map((label, i) => ({ id: 'explicit-' + i, label })) } });
  assert.equal(new Set(result.items.map(row => row.article.canonicalUrl)).size, 2); assert.equal(result.eligibleCount, 2);
  assert(result.items.every(row => row.reasons.every(reason => reason.via === 'related' && reason.field === 'title')));
  assert.equal(JSON.stringify(catalog), before);
});
test('actual matching fields and coverage are used without fabricating missing summary or body', () => {
  const catalog = feed([
    article('none', '다른 주제의 글'),
    article('summary', '공개 자료', { summary: '인공지능 사례를 비교합니다.', coverage: 'summary', rights: rights('summary_allowed') }),
    article('body', '공개 본문', { bodyText: '인공지능의 실제 사례를 설명합니다.', coverage: 'full_text', rights: rights('full_text_allowed') }),
    article('fake', '다른 제목', { bodyText: '인공지능', coverage: 'link_only' })
  ]);
  const result = rank(catalog); assert.deepEqual(result.items.map(row => row.article.id), ['summary', 'body']);
  assert.equal(result.items[0].reasons[0].field, 'summary'); assert.equal(result.items[1].reasons[0].field, 'bodyText'); assert.equal(result.metadata.coverage.linkOnly, 1);
});
test('rights and coverage mismatches do not turn metadata into fetched body evidence', () => {
  const result = rank(feed([article('body', '인공지능', { coverage: 'full_text', bodyText: '실제 본문', rights: rights('metadata_only') }), article('sum', '인공지능', { coverage: 'summary', summary: '요약', rights: rights('metadata_only') })]));
  assert.equal(result.items.length, 0); assert.equal(result.metadata.excluded.invalid, 2);
});
test('related results stop when fewer than five actually match and latest uses the same filtered whole public pool', () => {
  const catalog = feed([article('older', '인공지능 실험', { publishedAt: '2026-10-10T00:00:00.000Z' }), article('newest', '음악 공연', { publishedAt: '2026-10-18T00:00:00.000Z' }), article('middle', '인공지능 도구', { publishedAt: '2026-10-16T00:00:00.000Z' })]);
  const related = rank(catalog); const latest = rank(catalog, '인공지능', { mode: 'latest' }); assert.equal(related.items.length, 2); assert.equal(related.poolCount, latest.poolCount); assert.equal(latest.items[0].article.id, 'newest');
  assert.equal(rank(catalog, '천문 관측').items.length, 0);
});
test('existing URLs, equivalent tracking URLs, feedback identities and duplicate canonical URLs are excluded', () => {
  const catalog = feed([article('known', '인공지능'), article('hide', '인공지능'), article('copy', '인공지능', { url: 'https://d2.naver.com/helloworld/hide?utm_source=r#x' }), article('remain', '인공지능')]);
  const feedback = { feedback: [{ articleId: 'old-id', canonicalUrl: 'https://d2.naver.com/helloworld/hide', kind: 'not_relevant' }] };
  const result = rank(catalog, '인공지능', { knownUrls: ['https://d2.naver.com/helloworld/known?fbclid=x#y'], feedback });
  assert.deepEqual(result.items.map(row => row.article.id), ['remain']); assert.deepEqual(result.metadata.excluded, { known: 1, feedback: 1, duplicate: 1, invalid: 0 });
  assert.equal(rank(catalog, '인공지능', { feedback: { feedback: [] } }).items.length, 3);
});
test('same explicit word in different contexts remains a disclosed lexical limitation, not an inferred belief or similarity percentage', () => {
  const result = rank(feed([article('boat', '배를 타고 떠나는 여행'), article('pear', '배를 수확하는 계절')]), '배'); assert.equal(result.items.length, 2);
  assert(result.metadata.limitation.includes('같은 단어라도 문맥은 다를 수')); assert(result.items.every(item => item.reasons.every(reason => !('similarity' in reason) && !('belief' in reason))));
});
test('invalid and future publication dates are never fabricated as fresh dates; official updated dates remain labeled separately', () => {
  const catalog = feed([article('invalid', '인공지능', { publishedAt: '2026-02-30T00:00:00Z' }), article('future', '인공지능', { publishedAt: '2099-01-01T00:00:00Z' }), article('updated', '인공지능', { publishedAt: null, updatedAt: '2026-10-18T23:00:00Z', dateBasis: 'updated' })]);
  const result = rank(catalog, '인공지능', { mode: 'latest' }); assert.equal(result.items[0].article.id, 'updated'); assert.equal(result.items[0].article.publishedAt, null); assert.equal(result.items[0].article.dateBasis, 'updated');
  const invalid = result.items.find(row => row.article.id === 'invalid').article; assert.equal(invalid.publishedAt, null); assert.equal(invalid.dateStatus, 'invalid');
});
test('source refresh failure retains last-good public material with explicit stale/source failure metadata', () => {
  const catalog = feed([article('old', '인공지능')]); Object.assign(catalog.sources[0], { status: 'error', stale: true, error: '공개 공급 갱신 실패', lastSuccessAt: '2026-10-10T00:00:00Z' });
  const result = rank(catalog); assert.equal(result.items.length, 1); assert(result.metadata.stale); assert.equal(result.metadata.sources[0].status, 'error');
});
test('import review preserves permitted exact body or summary and states the media omission', async () => {
  const original = '\r\n공개 😀 본문\r\n\r\n마지막 줄\n', item = article('body', '인공지능 연구', { bodyText: original, coverage: 'full_text', rights: rights('full_text_allowed') });
  const input = Discovery.toImportInput(item);
  assert.equal(input.text.slice(0, original.length), original); assert.equal(input.authorRelation, 'other'); assert.equal(input.coverage.status, 'full_text');
  const footer = input.text.slice(original.length); assert(footer.startsWith('\n\n[해도 출처 정보]\n'));
  for (const line of ['원문 본문에 포함되지 않습니다.', '제목: 인공지능 연구', '원저자: 공개 작성자', '원문 URL: ' + item.url,
    '권리: ' + item.rights.label, '권리 URL: ' + item.rights.url, '서식을 평문으로 단순화했습니다.', '사진·영상은 보관하지 않았습니다.']) assert(footer.includes(line), line);
  assert.deepEqual(input.coverage.omissions, ['사진·영상 미보관']);
  const bundle = Core.createWorkspace(); const prepared = await Core.prepareImport(input, bundle); assert.equal(prepared.version.contentText, input.text); assert.equal(prepared.version.coverage.status, 'full_text');
  const summary = Discovery.toImportInput(article('summary', '요약', { summary: '공개 요약\n\n두 번째 문단', coverage: 'summary', rights: rights('summary_allowed') }));
  const partial = await Core.prepareImport(summary, bundle); assert(partial.version.contentText.startsWith('공개 요약\n\n두 번째 문단\n\n[해도 출처 정보]\n')); assert.equal(partial.version.coverage.status, 'partial');
  assert(partial.version.contentText.includes('보관 범위: 공개 요약 · 원문 전체 미확보'));
  assert.deepEqual(partial.version.coverage.omissions, ['원문 전체 미확보', '사진·영상 미보관']);
  const link = await Core.prepareImport(Discovery.toImportInput(article('link', '제목')), bundle);
  assert.equal(link.version.contentText, null); assert.equal(link.version.coverage.status, 'link_only');
  for (const invalid of [{ coverage: 'full_text', bodyText: '권한 없는 본문' }, { coverage: 'summary', summary: '권한 없는 요약' }]) {
    assert.throws(() => Discovery.toImportInput(article('invalid', '제목', invalid)), { code: 'discovery_feed_invalid' });
  }
});
test('optional embedded pictures preserve old feeds and normalize safe licensed bytes without body mutation', () => {
  const bodyText = '첫째 문단\n\n둘째 문단', original = article('body', '본문', { bodyText, coverage: 'full_text', rights: rights('full_text_allowed') });
  const prior = Discovery.validateFeed(feed([original]), { now: NOW }); assert(!Object.hasOwn(prior.articles[0], 'images'));
  const input = feed([{ ...original, images: [picture({ afterParagraph: 1, alt: '<img onerror=alert(1)>' })] }]);
  const before = structuredClone(input), normalized = Discovery.validateFeed(input, { now: NOW });
  assert.deepEqual(input, before); assert.equal(normalized.articles[0].bodyText, bodyText);
  assert.equal(normalized.articles[0].images[0].afterParagraph, 1); assert.equal(normalized.articles[0].images[0].alt, '<img onerror=alert(1)>');
  assert.deepEqual(Discovery.validateFeed(normalized, { now: NOW }), normalized);
});
test('unsafe, oversized or malformed optional images are removed while readable text survives', () => {
  const oversized = Buffer.alloc(Discovery.LIMITS.imageBytes + 1); rasterHeader('image/png').copy(oversized);
  const bad = [picture({ mimeType: 'image/svg+xml' }), picture({ mimeType: 'image/jpeg' }), picture({ dataBase64: '<svg/>' }),
    picture({ dataBase64: Buffer.concat([rasterHeader('image/png'), Buffer.from([0])]).toString('base64').replace('A==', 'B==') }), picture({ dataBase64: picture().dataBase64 + '\n' }),
    picture({ dataBase64: oversized.toString('base64') }), picture({ license: { label: 'CC BY 4.0', url: 'https://evil.example/by/4.0/' } }),
    picture({ sourceUrl: 'https://d2.naver.com.evil.example/p.png' }), picture({ sourceUrl: 'https://u:p@d2.naver.com/p.png' }),
    picture({ sourceUrl: 'data:image/png;base64,AAAA' }), picture({ sourceUrl: 'https://d2.naver.com/p.png#x' }),
    picture({ afterParagraph: -1 }), picture({ afterParagraph: 1.5 }), picture({ afterParagraph: 1 }), picture({ credit: '' }),
    picture({ path: 'https://evil.example/p.png' })];
  for (const image of bad) {
    const normalized = Discovery.validateFeed(feed([article('body', '본문', { bodyText: '안전한 본문', coverage: 'full_text', rights: rights('full_text_allowed'), images: [image] })]), { now: NOW });
    assert.equal(normalized.articles.length, 1); assert.equal(normalized.articles[0].bodyText, '안전한 본문');
    assert(!Object.hasOwn(normalized.articles[0], 'images'), JSON.stringify(image).slice(0, 150)); assert.equal(normalized.validation.invalid.length, 0);
  }
  for (const images of [null, {}, [picture(), picture(), picture()]]) {
    const normalized = Discovery.validateFeed(feed([article('a', '제목', { images })]), { now: NOW });
    assert.equal(normalized.articles.length, 1); assert(!Object.hasOwn(normalized.articles[0], 'images'));
  }
});
test('decoded image budgets span the feed and accept only declared raster signatures', () => {
  const large = Buffer.alloc(Discovery.LIMITS.imageBytes); rasterHeader('image/png').copy(large);
  const image = picture({ dataBase64: large.toString('base64') });
  const normalized = Discovery.validateFeed(feed([article('a', '제목', { images: [image, image] }), article('b', '제목', { images: [image, image] })]), { now: NOW });
  assert.equal(normalized.articles[0].images.length, 2); assert.equal(normalized.articles[1].images.length, 1);
  const rasters = [picture({ mimeType: 'image/jpeg', dataBase64: rasterHeader('image/jpeg').toString('base64') }),
    picture({ mimeType: 'image/webp', dataBase64: rasterHeader('image/webp').toString('base64') })];
  assert.equal(Discovery.validateFeed(feed([article('a', '제목', { images: rasters })]), { now: NOW }).articles[0].images.length, 2);
});
test('raster header dimensions reject decompression-sized images and truncated headers before rendering', () => {
  for (const [mimeType, variant] of [['image/png'], ['image/jpeg'], ['image/webp', 'VP8X'], ['image/webp', 'VP8L'], ['image/webp', 'VP8 ']]) {
    for (const [width, height, accepted] of [[1, 1, true], [4096, 4096, true], [4097, 2, false], [2, 4097, false]]) {
      const dataBase64 = rasterHeader(mimeType, width, height, variant).toString('base64');
      const normalized = Discovery.validateFeed(feed([article('a', '제목', { images: [picture({ mimeType, dataBase64 })] })]), { now: NOW });
      assert.equal(!!normalized.articles[0].images, accepted, mimeType + ':' + variant + ':' + width + 'x' + height);
    }
    const truncated = rasterHeader(mimeType, 1, 1, variant).subarray(0, 22).toString('base64');
    const normalized = Discovery.validateFeed(feed([article('a', '본문 유지', { images: [picture({ mimeType, dataBase64: truncated })] })]), { now: NOW });
    assert.equal(normalized.articles.length, 1); assert(!normalized.articles[0].images);
  }
  const malformed = [rasterHeader('image/png', 0, 1), rasterHeader('image/png', 1, 0), rasterHeader('image/png', 0xffffffff, 1)];
  for (const bytes of malformed) assert(!Discovery.validateFeed(feed([article('a', '제목', { images: [picture({ dataBase64: bytes.toString('base64') })] })]), { now: NOW }).articles[0].images);
});
test('client requests nothing until explicit load and fetches only fixed public same-origin GET with no credentials, body or query', async () => {
  const requests = []; const client = Discovery.create({ now: () => NOW, fetch: async (url, options) => { requests.push({ url, options }); return response(feed([article('a', '인공지능')])); } });
  assert.equal(requests.length, 0); const result = await client.load(); assert.equal(result.status, 'ready'); assert.equal(requests.length, 1);
  const request = requests[0]; assert.equal(new URL(request.url).pathname, '/assets/life/discovery-feed.json'); assert.equal(new URL(request.url).search, ''); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.referrerPolicy, 'no-referrer'); assert(!('body' in request.options)); assert(!('headers' in request.options));
  client.dispose(); assert.throws(() => Discovery.create({ feedUrl: 'https://private.example/feed.json' }), { code: 'discovery_feed_invalid' });
});
test('SW cache fallback and client fallback are explicitly stale while browser fetch and catalog times remain distinct', async () => {
  let attempt = 0; const fetchedAt = '2026-10-18T12:34:00.000Z';
  const client = Discovery.create({ now: () => NOW, fetch: async () => { if (attempt++) throw new Error('offline'); return response(feed([article('a', '인공지능')]), { 'X-Haedo-Discovery-Cache': 'stale', 'X-Haedo-Discovery-Fetched-At': fetchedAt }); } });
  const first = await client.load(); assert(first.stale); assert.equal(first.browserFetchedAt, fetchedAt); assert.equal(first.feed.generatedAt, NOW);
  const second = await client.load(); assert(second.stale); assert.equal(second.status, 'ready'); assert(second.error); assert.equal(second.feed.articles.length, 1); client.dispose();
});
test('empty initial error, cancellation and late superseded loads cannot replace the latest public snapshot', async () => {
  const failed = Discovery.create({ fetch: async () => { throw new Error('offline'); } }); const failure = await failed.load(); assert.equal(failure.status, 'error'); assert.equal(failure.feed, null); failed.dispose();
  const old = deferred(); let calls = 0; const client = Discovery.create({ now: () => NOW, fetch: async () => calls++ ? response(feed([article('new', '인공지능')])) : old.promise });
  const prior = client.load().catch(cause => cause); const latest = await client.load(); old.resolve(response(feed([article('old', '인공지능')]))); assert.equal((await prior).name, 'AbortError'); assert.equal(latest.feed.articles[0].id, 'new'); client.dispose();
});
