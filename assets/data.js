/* Pure data helpers shared by the browser and regression tests. */
(function (root) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const pad = n => String(n).padStart(2, '0');
  function daysInMonth(year, month) {
    return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    return year > 0 && (day === undefined || (day > 0 && day <= daysInMonth(year, month)));
  }
  function withDay(original, month) {
    if (!validDate(month) || month.length !== 7) return month;
    const day = String(original || '').split('-')[2];
    if (!day) return month;
    const [year, m] = month.split('-').map(Number);
    return `${month}-${pad(Math.min(Number(day), daysInMonth(year, m)))}`;
  }
  const localDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const isDocument = d => object(d) && object(d.profile) &&
    ['events', 'spans', 'eras', 'happiness', 'thoughts', 'records'].some(key => Array.isArray(d[key]));

  // Normalise collection shapes without discarding the original malformed values.
  function structure(d, checkValues = true) {
    if (!object(d)) throw new Error('문서 형식을 읽을 수 없습니다.');
    const quarantine = Array.isArray(d._quarantine) ? d._quarantine : [];
    d._quarantine = quarantine;
    for (const key of ['eras', 'events', 'spans', 'happiness', 'records', 'thoughts', 'trips', 'layers']) {
      const raw = d[key];
      if (raw != null && !Array.isArray(raw)) quarantine.push({ collection: key, value: raw });
      d[key] = (Array.isArray(raw) ? raw : []).filter(item => {
        if (object(item)) return true;
        quarantine.push({ collection: key, value: item }); return false;
      });
    }
    if (!object(d.profile)) { quarantine.push({ profile: d.profile }); d.profile = {}; }
    d.profile.name = typeof d.profile.name === 'string' ? d.profile.name : '내 연표';
    for (const item of [...d.events, ...d.spans]) {
      if (checkValues && item.happiness != null && (typeof item.happiness !== 'number' || !Number.isFinite(item.happiness) || Math.abs(item.happiness) > 1)) {
        quarantine.push({ ...item, reason: '행복도 범위' }); item.happiness = null;
      }
      if (item.loc && (!Number.isFinite(item.loc.lat) || !Number.isFinite(item.loc.lng) ||
        Math.abs(item.loc.lat) > 90 || Math.abs(item.loc.lng) > 180)) {
        quarantine.push({ loc: item.loc }); delete item.loc;
      }
    }
    for (const item of [...d.layers, ...d.spans, ...d.eras, ...d.trips]) {
      if (item.color != null && (typeof item.color !== 'string' || !/^(?:#[a-f\d]{3,4}|#[a-f\d]{6}|#[a-f\d]{8}|[a-z]+|(?:rgb|hsl)a?\([\d.,% +\/-]+\))$/i.test(item.color))) {
        quarantine.push({ color: item.color, reason: '색 형식' }); item.color = '#7A8A80';
      }
    }
    for (const trip of d.trips) {
      trip.points = (Array.isArray(trip.points) ? trip.points : []).filter(p => {
        if (object(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) return true;
        quarantine.push({ trip: trip.id, point: p }); return false;
      });
    }
    return d;
  }
  const derived = new Set(['t', 't0', 't1', 'kind', 'fut', 'ongoing', 'lane']);
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!object(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().filter(key => !derived.has(key)).map(key => [key, canonical(value[key])]));
  }
  // Imports are copies, even when the backup contains an existing document ID.
  function prepareImport(input, makeId, normalize) {
    const source = Array.isArray(input?.docs) ? input.docs : isDocument(input) ? [{ data: input }] : null;
    if (!source?.length) throw new Error('문서가 들어 있는 JSON 백업을 선택하세요.');
    if (source.some(entry => !isDocument(entry?.data))) throw new Error('읽을 수 없는 문서가 있습니다. 기존 기록은 변경하지 않았습니다.');
    return source.map(entry => {
      const data = normalize(structuredClone(entry.data));
      return { id: makeId(), name: data.profile.name || entry.name || '가져온 문서', data };
    });
  }
  // A planned point affects its adjacent edges, not every later observation.
  function curveIntervals(points) {
    const runs = [];
    for (let i = 1; i < points.length; i++) {
      const future = !!(points[i - 1].future || points[i].future);
      const last = runs.at(-1);
      if (last && last.future === future) last.end = points[i].x;
      else runs.push({ start: points[i - 1].x, end: points[i].x, future });
    }
    return runs;
  }
  const api = { curveIntervals, object, validDate, daysInMonth, withDay, localDate, isDocument, structure, canonical, prepareImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HaedoData = api;
})(globalThis);
