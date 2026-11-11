/* Request validation for haedo-news-wide.
 *
 * The request is exactly { topics: string[], languages: ("ko"|"en")[] }. A topic
 * is what the owner typed into the news settings and it is the only personal
 * text that later leaves the server, so the rule is an allow list: letters,
 * digits, combining marks, single spaces and  . & + # ' ’ · / - , % ! ?
 * Everything a search service could read as an instruction is refused, not
 * escaped and not quoted (quoting would silently turn a topic into an
 * exact-phrase search):
 *   - quotes of any kind and brackets            ("..." phrase, grouping)
 *   - the colon                                   (site: when: intitle: inurl: source: after: before:)
 *   - a word that starts with - or +              (exclude / require)
 *   - * | ~ < > = and the other symbols, emoji    (wildcard, OR, ranges)
 *   - the upper-case words OR, AND, NOT between two other words (boolean
 *     operators). As the first or the last word they are ordinary words
 *     ("Portland OR", "OR 연산").
 * Control, format and invisible characters (also invisible letters such as the
 * Hangul fillers) and line breaks are refused before any normalization, so
 * they can never be folded into a space and pass.
 * SQL topic_valid (migration 20261111130000) applies the same rule as far as it
 * can without Unicode letter classes; every topic accepted here is accepted
 * there (tests/run-news-wide-postgres.cjs checks 20,000 random ones).
 * Known limits: full-width letters are letters, so a full-width "OR" passes. */

export const LIMITS = Object.freeze({ topics: 8, topicLength: 40, body: 4096 });
export const LANGUAGES = Object.freeze(['ko', 'en']);
export const failure = code => Object.assign(new Error(code), { code });

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Control, format (zero-width, bidi), line/paragraph separators, private use, unassigned.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const ALLOWED = /^[\p{L}\p{N}\p{M} .&+#'’·/,%!?-]+$/u;
const OPERATOR_WORDS = new Set(['OR', 'AND', 'NOT']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** One topic, normalized (NFC, single spaces, trimmed), or an invalid_topic failure. */
export function normalizeTopic(raw) {
  if (typeof raw !== 'string') throw failure('invalid_request');
  if (raw.length > LIMITS.topicLength * 8 || LONE_SURROGATE.test(raw) || INVISIBLE.test(raw)) throw failure('invalid_topic');
  const topic = raw.normalize('NFC').replace(/\p{Zs}+/gu, ' ').trim();
  const length = [...topic].length;
  if (length < 1 || length > LIMITS.topicLength || !ALLOWED.test(topic) || !WORD_CHAR.test(topic)) throw failure('invalid_topic');
  const words = topic.split(' ');
  if (words.some(word => word.startsWith('-') || word.startsWith('+'))) throw failure('invalid_topic');
  // A boolean operator needs a word on both sides; alone, first or last it is a plain word.
  if (words.slice(1, -1).some(word => OPERATOR_WORDS.has(word))) throw failure('invalid_topic');
  // An apostrophe is part of a word (O'Reilly), never an opening or closing quote.
  const chars = [...topic];
  chars.forEach((char, at) => {
    if ((char === "'" || char === '’') && !(WORD_CHAR.test(chars[at - 1] || '') && WORD_CHAR.test(chars[at + 1] || ''))) throw failure('invalid_topic');
  });
  return topic;
}

/** @returns {{ topics: string[], languages: string[] }} normalized, de-duplicated copy */
export function validateRequest(input) {
  if (!object(input)) throw failure('invalid_request');
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('topics') || !keys.includes('languages')) throw failure('invalid_request');
  const { topics, languages } = input;
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > LIMITS.topics) throw failure('invalid_request');
  if (!Array.isArray(languages) || languages.length < 1 || languages.length > LANGUAGES.length ||
    !languages.every(language => typeof language === 'string' && LANGUAGES.includes(language))) throw failure('invalid_request');
  const seen = new Set(), unique = [];
  for (const raw of topics) {
    const topic = normalizeTopic(raw), key = topic.toLowerCase();
    if (seen.has(key)) continue; // the same topic twice is one upstream call
    seen.add(key); unique.push(topic);
  }
  return { topics: unique, languages: LANGUAGES.filter(language => languages.includes(language)) };
}
