/* Civil-date annual planning. Display preferences project immutable dated
 * entries; this module never reads storage, sends requests or changes a source. */
(function (root, factory) {
  'use strict';
  const api = factory();
  (root.HaedoLife ||= {}).AnnualPlan = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const YEAR_MIN = 1900, YEAR_MAX = 2199, MAX_ROWS = 200, MAX_ENTRIES = 2400, MAX_TEXT = 10000, MAX_BYTES = 2 * 1024 * 1024;
  const PROFILE_KEYS = ['schemaVersion', 'workspaceId', 'revision', 'updatedAt', 'birthDate', 'basis', 'ageMode', 'quarters', 'rows', 'entries'];
  const PLAN_KEYS = ['birthDate', 'basis', 'ageMode', 'quarters', 'rows', 'entries'];
  const pad = n => String(n).padStart(2, '0');
  const civil = (year, month, day) => String(year).padStart(4, '0') + '-' + pad(month) + '-' + pad(day);
  const parts = value => value.split('-').map(Number);
  const clone = value => structuredClone(value);
  const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const integerYear = value => Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX;
  function fail(condition, code = 'annual_plan_invalid') {
    if (!condition) throw Object.assign(new Error(code === 'annual_plan_conflict' ? '다른 화면에서 연간 계획이 바뀌었습니다. 최신 사본을 확인해 주세요.' : code === 'annual_plan_too_large' ? '연간 계획의 보관 한도를 넘었습니다. 기존 계획은 유지했습니다.' : '연간 계획의 날짜와 내용을 확인해 주세요.'), { code });
  }
  function plain(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  }
  function fields(value, keys, complete = true) {
    fail(plain(value));
    const names = Reflect.ownKeys(value);
    fail(names.every(key => typeof key === 'string' && keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
    if (complete) fail(names.length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  }
  function dense(value, limit) {
    fail(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= limit);
    fail(Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean));
  }
  const monthDays = (year, month) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
    const [year, month, day] = parts(value);
    return integerYear(year) && day > 0 && day <= monthDays(year, month);
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  }
  function nowValue(value) {
    const at = typeof value === 'function' ? value() : value === undefined ? new Date().toISOString() : value;
    fail(timestamp(at)); return at;
  }
  function validatePlan(plan) {
    fields(plan, PLAN_KEYS);
    fail(plan.birthDate === '' || validDate(plan.birthDate));
    fail(['year', 'birthday'].includes(plan.basis) && (plan.basis !== 'birthday' || !!plan.birthDate));
    fail(['international', 'korean', 'both'].includes(plan.ageMode) && typeof plan.quarters === 'boolean');
    dense(plan.rows, MAX_ROWS); dense(plan.entries, MAX_ENTRIES);
    let previousYear = 0, previousDate = '';
    for (const row of plan.rows) {
      fields(row, ['year', 'text']); fail(integerYear(row.year) && row.year > previousYear);
      fail(typeof row.text === 'string' && row.text.length <= MAX_TEXT); previousYear = row.year;
    }
    const seen = new Set();
    for (const entry of plan.entries) {
      fields(entry, ['id', 'date', 'text']); fail(id(entry.id) && !seen.has(entry.id)); seen.add(entry.id);
      fail(validDate(entry.date) && entry.date >= previousDate && typeof entry.text === 'string' && entry.text.length <= MAX_TEXT);
      previousDate = entry.date;
    }
    // Reserve enough for either wrapper: the longest workspace/revision/timestamp
    // profile and the portable envelope. Every accepted plan remains exportable
    // and importable into another supported workspace without crossing 2 MiB.
    fail(bytes(plan) <= MAX_BYTES - 512, 'annual_plan_too_large'); return plan;
  }
  function planOf(profile) { return Object.fromEntries(PLAN_KEYS.map(key => [key, profile[key]])); }
  function validate(profile) {
    fields(profile, PROFILE_KEYS);
    fail(profile.schemaVersion === 1 && id(profile.workspaceId) && Number.isSafeInteger(profile.revision) && profile.revision >= 0);
    fail(profile.revision === 0 ? profile.updatedAt === null : timestamp(profile.updatedAt));
    validatePlan(planOf(profile)); fail(bytes(profile) <= MAX_BYTES, 'annual_plan_too_large'); return profile;
  }
  function empty(workspaceId, options = {}) {
    fields(options, ['now', 'year'], false);
    let year = options.year;
    if (year === undefined) {
      // UTC+9 calendar extraction is independent of the browser's host timezone.
      const at = nowValue(options.now), date = new Date(Date.parse(at) + 9 * 60 * 60 * 1000); year = date.getUTCFullYear();
    }
    fail(integerYear(year));
    const result = { schemaVersion: 1, workspaceId, revision: 0, updatedAt: null, birthDate: '', basis: 'year', ageMode: 'international', quarters: true, rows: [{ year, text: '' }], entries: [] };
    return validate(result);
  }
  function update(profile, patch, options = {}) {
    validate(profile); fields(patch, PLAN_KEYS, false); fields(options, ['expectedRevision', 'now'], false);
    fail(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision === profile.revision && profile.revision < Number.MAX_SAFE_INTEGER, 'annual_plan_conflict');
    for (const [key, keys, limit] of [['rows', ['year', 'text'], MAX_ROWS], ['entries', ['id', 'date', 'text'], MAX_ENTRIES]]) {
      if (Object.hasOwn(patch, key)) { dense(patch[key], limit); patch[key].forEach(item => fields(item, keys)); }
    }
    const result = { ...clone(profile), revision: profile.revision + 1, updatedAt: nowValue(options.now) };
    for (const key of Object.keys(patch)) result[key] = clone(patch[key]);
    // Canonical ordering changes no date, ID, text or same-date insertion order.
    // Validate complete item shape before sorting so malformed data is refused.
    if (Array.isArray(result.rows)) {
      dense(result.rows, MAX_ROWS); result.rows.forEach(row => fields(row, ['year', 'text'])); result.rows.sort((a, b) => a.year - b.year);
    }
    if (Array.isArray(result.entries)) {
      dense(result.entries, MAX_ENTRIES); result.entries.forEach(entry => fields(entry, ['id', 'date', 'text']));
      result.entries.sort((a, b) => typeof a.date === 'string' && typeof b.date === 'string' ? a.date.localeCompare(b.date) : 0);
    }
    return validate(result);
  }
  function anniversary(birthDate, year, offset = 0) {
    const [, month, day] = parts(birthDate), total = year * 12 + month - 1 + offset;
    const y = Math.floor(total / 12), m = total % 12 + 1;
    return civil(y, m, Math.min(day, monthDays(y, m)));
  }
  function before(value) {
    let [year, month, day] = parts(value);
    if (--day < 1) { if (--month < 1) { year--; month = 12; } day = monthDays(year, month); }
    return civil(year, month, day);
  }
  function anchorYear(profile, value) {
    const year = parts(value)[0];
    return profile.basis === 'birthday' && value < anniversary(profile.birthDate, year) ? year - 1 : year;
  }
  function periods(profile, year) {
    validate(profile);
    // A dated January plan at the supported lower bound can belong to the
    // preceding birthday cycle. It must remain visible, without a new saved row.
    fail(Number.isInteger(year) && year >= YEAR_MIN - 1 && year <= YEAR_MAX);
    return Array.from({ length: 12 }, (_, index) => {
      const start = profile.basis === 'birthday' ? anniversary(profile.birthDate, year, index) : civil(year, index + 1, 1);
      const end = profile.basis === 'birthday' ? anniversary(profile.birthDate, year, index + 1) : index === 11 ? civil(year + 1, 1, 1) : civil(year, index + 2, 1);
      const [, sm, sd] = parts(start), [, em, ed] = parts(before(end));
      return { index, start, end, label: profile.basis === 'year' ? sm + '월' : sm + '/' + sd + '–' + em + '/' + ed, quarter: Math.floor(index / 3) + 1, editable: validDate(start) };
    });
  }
  function years(profile) {
    validate(profile);
    return [...new Set([...profile.rows.map(row => row.year), ...profile.entries.map(entry => anchorYear(profile, entry.date))])].sort((a, b) => a - b);
  }
  function ageOn(birthDate, value, korean) {
    if (value < birthDate) return null;
    const year = parts(value)[0], birthYear = parts(birthDate)[0];
    return korean ? year - birthYear + 1 : year - birthYear - (value < anniversary(birthDate, year) ? 1 : 0);
  }
  function agePart(birthDate, start, end, korean) {
    const from = ageOn(birthDate, start, korean), to = ageOn(birthDate, end, korean), prefix = korean ? '한국나이 ' : '만 ';
    if (to === null) return '출생 전';
    if (from === null) return '출생 전→' + prefix + to + '세';
    return prefix + from + (from === to ? '' : '→' + to) + '세';
  }
  function ageLabel(profile, year) {
    const spans = periods(profile, year);
    if (!profile.birthDate) return '—';
    const start = spans[0].start, end = before(spans[11].end);
    const international = agePart(profile.birthDate, start, end, false), korean = agePart(profile.birthDate, start, end, true);
    if (international === '출생 전' && korean === '출생 전') return '출생 전';
    return profile.ageMode === 'international' ? international : profile.ageMode === 'korean' ? korean : international + ' · ' + korean;
  }
  function validateBackup(envelope) {
    fields(envelope, ['format', 'schemaVersion', 'exportedAt', 'plan']);
    fail(envelope.format === 'haedo-annual-plan' && envelope.schemaVersion === 1 && timestamp(envelope.exportedAt));
    validatePlan(envelope.plan); fail(bytes(envelope) <= MAX_BYTES, 'annual_plan_too_large'); return envelope;
  }
  function parseBackup(text) {
    fail(typeof text === 'string'); fail(bytes(text) <= MAX_BYTES, 'annual_plan_too_large');
    let value; try { value = JSON.parse(text); } catch (_) { fail(false); }
    return validateBackup(value);
  }
  function exportBackup(profile, options = {}) {
    validate(profile); fields(options, ['now'], false);
    return validateBackup({ format: 'haedo-annual-plan', schemaVersion: 1, exportedAt: nowValue(options.now), plan: clone(planOf(profile)) });
  }
  function importBackup(profile, envelope, options = {}) {
    validateBackup(envelope); return update(profile, envelope.plan, options);
  }
  return Object.freeze({ YEAR_MIN, YEAR_MAX, MAX_ROWS, MAX_ENTRIES, MAX_TEXT, MAX_BYTES, empty, validate, update, periods, years, ageLabel, parseBackup, exportBackup, importBackup, validDate });
});
