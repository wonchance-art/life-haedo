/* 넓게 찾기 주제 규칙: 화면의 검사(assets/life/discovery-wide-remote.js normalizeTopic)가 서버의 규칙
 * (supabase/functions/haedo-news-wide/topics.mjs normalizeTopic, 계약 ab94caf 10항)과 같은 답을 내는지.
 * 같은 말뭉치에 둘을 돌려 결과(정규화한 주제, 또는 실패 코드)가 하나도 다르지 않아야 한다.
 * 말뭉치: 서버 검사(tests/news-wide-edge.test.cjs)의 받는·받지 않는 목록, 시드를 고정한 무작위 주제,
 * 모든 코드 포인트를 몇 자리에 넣은 것. 네트워크·서버 실행 없음. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Wide = require('../assets/life/discovery-wide-remote.js');
const server = import('../supabase/functions/haedo-news-wide/topics.mjs');

// Millions of refusals: a refusal's stack trace is not part of the answer, so none is captured.
Error.stackTraceLimit = 0;
const outcome = (fn, value) => { try { return { topic: fn(value) }; } catch (error) { return { code: error?.code ?? String(error) }; } };
function compare(normalize, values, label) {
  let differences = 0; const examples = [];
  for (const value of values) {
    const a = outcome(normalize, value), b = outcome(Wide.normalizeTopic, value);
    if (a.topic !== b.topic || a.code !== b.code) { differences++; if (examples.length < 5) examples.push({ value: JSON.stringify(value), server: a, screen: b }); }
  }
  assert.equal(differences, 0, label + ': ' + JSON.stringify(examples));
  return values.length;
}

// The server test's own lists (tests/news-wide-edge.test.cjs, contract ab94caf), copied as they are.
const ACCEPTED = ['기후', 'climate change', 'K-pop', 'C++', 'C#', '.NET', 'R&D', 'AI/ML', "O'Reilly", 'O’Reilly', '3·1 운동', 'Node.js 22', '日本 経済', 'São Paulo',
  '10%', '10,000', '1,000원', 'Yahoo!', '왜?', '기후, 날씨', 'a,b', '50% 할인!', 'a%26b', '100%25',
  '3-1', 'e-mail', 'COVID-19', '서울-부산', '3.5', 'v1.2.3',
  'Oregon OR', 'Portland OR', 'OR 연산', 'OR', 'AND', 'NOT', 'NOT 기후', 'Rock AND', 'or', '기후 or 날씨', 'ORegon', 'a ORb c',
  '  기후   변화\u3000정책 ', '기후'.normalize('NFD'), '𠀀'.repeat(40)];
const REFUSED = [
  '𠀀'.repeat(41), '가'.repeat(41),
  '', '   ', '\u3000',
  '"기후"', '“기후”', '기후"', "'기후'", "기후'", '‘기후’', '’기후’', '기후’', '’a', 'a’ b', 'a ’b', 'a’', '«기후»', '＂기후＂', '`기후`',
  'a,-b', 'a/-b', 'a.-b', 'a&-b', 'a!-b', 'a?-b', 'a%-b', 'a#-b', 'a+-b', 'a·-b', "a'-b", 'a’-b', 'a-', '기후-', 'a- b', 'a--b', '1..10', 'a..b', '..NET', 'a...b',
  'site:example.com', 'site:example.com 기후', 'when:1d', '기후 when:7d', 'intitle:기후', 'allintitle:기후', 'inurl:x', 'source:x', 'after:2026-01-01', 'before:2026-01-01', '기후：변화',
  '-기후', '기후 -날씨', '+기후', '기후 +날씨', '기후 OR 날씨', '기후 AND 날씨', 'a NOT b', 'x OR OR y', 'OR OR OR', 'a AND b OR', '기후|날씨', '기후*', '(기후)', '기후~', '기후<1', 'a=b', '[기후]', '{기후}', '기후;날씨', '50:50', '@handle', '$100', 'a\\b', 'a_b', 'a^b', '-', 'a - b', '+ a',
  ...[0x115f, 0x1160, 0x3164, 0xffa0, 0x034f, 0x17b4, 0x180b, 0xfe0f, 0xe0101, 0xe0001, 0x061c, 0xfff9].flatMap(point => [String.fromCodePoint(point), '기' + String.fromCodePoint(point) + '후']),
  '기후\n변화', '기후\r\n변화', '기후\t변화', '기후\u0000', '기후\u001b[31m', '기\u200b후', '기\u200d후', '\u202e기후', '기후\u2028변화', '기후\u2029', '\ufeff기후', '기후\u0085', '기\u00ad후',
  '...', '& &', '#', '?!', ',', '% !', '🌿', '기후 🌿', '❤', '→', '「기후」', '기후。', '\ud800기후', '기후\udfff'];
const NOT_STRINGS = [null, undefined, 1, {}, ['기후'], true];

// A fixed-seed generator: the same corpus on every run.
function random(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Pieces that sit near the rule's edges: words, the allowed signs, refused signs, spaces of several kinds,
// combining marks, invisible and control characters, lone surrogates, emoji, operator words, repeated dots.
// Words and single spaces are drawn most often so that a good part of the topics pass.
const WORDS = ['기후', '날씨', 'a', 'B', 'z', '가', '힣', 'é', 'ß', 'Ω', 'ж', '日本', '𠀀', '٣', '7', '0', 'K', 'OR', 'AND', 'NOT', 'or', 'Or', ' ', ' ', 'ﬁ', 'Ａ', 'ＯＲ'];
const PIECES = [' ', '  ', '\u3000', '\u00a0', '\u2003', '\u202f', '\t', '\n',
  '.', '..', '&', '+', '#', "'", '’', '·', '/', ',', '%', '!', '?', '-', '--',
  '"', '“', '‘', '(', ')', '[', ']', '{', '}', ':', '：', '*', '|', '~', '<', '>', '=', ';', '@', '$', '_', '^', '\\', '`', '«', '「', '。',
  '\u0301', '\u0308', 'ि', '\u200b', '\u200d', '\u202e', '\ufeff', '\u00ad', '\u034f', '\u115f', '\u3164', '\ufe0f', '\u0000', '\u001b', '\u0085', '\u2028',
  '\ud800', '\udfff', '🌿', '❤', '→', '\ue000', '\u0378'];
function randomTopics(count, seed) {
  const next = random(seed), values = [];
  for (let i = 0; i < count; i++) {
    const length = 1 + Math.floor(next() * 9); let value = '';
    for (let j = 0; j < length; j++) { const pool = next() < 0.85 ? WORDS : PIECES; value += pool[Math.floor(next() * pool.length)]; }
    // Some long ones near the 40-code-point and the 320-unit raw limits.
    if (next() < 0.03) value = value.repeat(1 + Math.floor(next() * 60));
    values.push(value);
  }
  return values;
}

test('the screen\'s topic rule gives the server\'s answer on the server test\'s own lists', async () => {
  const { normalizeTopic } = await server;
  // The lists themselves still say what the server says about them.
  for (const value of ACCEPTED) assert.equal(typeof outcome(normalizeTopic, value).topic, 'string', 'accepted: ' + JSON.stringify(value));
  for (const value of REFUSED) assert.equal(outcome(normalizeTopic, value).code, 'invalid_topic', 'refused: ' + JSON.stringify(value));
  for (const value of NOT_STRINGS) assert.equal(outcome(normalizeTopic, value).code, 'invalid_request');
  compare(normalizeTopic, [...ACCEPTED, ...REFUSED, ...NOT_STRINGS], 'server lists');
  // The settings help's examples are judged the way the help says.
  for (const value of Wide.EXAMPLES.accepted) assert.equal(Wide.checkTopic(value).ok, true, value);
  for (const value of Wide.EXAMPLES.refused) assert.deepEqual(Wide.checkTopic(value), { ok: false, reason: 'rule' }, value);
});

test('the same answer on 20,000 random topics built from the rule\'s edge cases', async () => {
  const { normalizeTopic } = await server;
  const values = randomTopics(20000, 20261111);
  const accepted = values.filter(value => typeof outcome(normalizeTopic, value).topic === 'string').length;
  // The corpus holds both answers in quantity, so a difference on either side would show.
  assert.ok(accepted > 2000 && accepted < 18000, 'accepted ' + accepted);
  compare(normalizeTopic, values, 'random');
});

test('the same answer for every code point, alone and between letters, digits and spaces', async () => {
  const { normalizeTopic } = await server;
  const values = [];
  for (let point = 0; point <= 0x10ffff; point++) {
    const c = String.fromCodePoint(point);
    values.push(c, 'a' + c + 'b', '기후 ' + c, c + '1', '1' + c + '1');
  }
  assert.equal(compare(normalizeTopic, values, 'code points'), 0x110000 * 5);
});

test('settings reasons: what is not sent says why, and nothing outside the rule reaches the request', async () => {
  assert.deepEqual(Wide.checkTopic('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(Wide.checkTopic('가'.repeat(41)), { ok: false, reason: 'too_long' });
  assert.deepEqual(Wide.checkTopic('가'.repeat(400)), { ok: false, reason: 'too_long' });
  assert.deepEqual(Wide.checkTopic('기\u200b후'), { ok: false, reason: 'rule' });
  assert.deepEqual(Wide.checkTopic('site:example.com'), { ok: false, reason: 'rule' });
  assert.deepEqual(Wide.checkTopic('  기후   변화 '), { ok: true, topic: '기후 변화' });
  for (const reason of ['empty', 'too_long', 'rule', 'refused', 'duplicate', 'over_limit']) assert.ok(Wide.REASONS[reason].length > 5, reason);
  // The refusal key is the topic's own (case and spacing as the rule normalizes them), 16 hex digits, never the text.
  assert.match(Wide.refusalKey('기후'), /^[0-9a-f]{16}$/);
  assert.equal(Wide.refusalKey('Climate'), Wide.refusalKey('climate'));
  assert.notEqual(Wide.refusalKey('기후'), Wide.refusalKey('날씨'));
});
