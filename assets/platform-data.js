/* Account-scoped storage preserves every legacy caeyeon_life_* document. */
(function (root) {
  const prefix = (uid) => "caeyeon_life_account_" + uid + "_";
  const keys = (uid) => ({
    registry: prefix(uid) + "registry",
    docs: prefix(uid) + "doc_",
    items: prefix(uid) + "items",
    // The side that lost a sync conflict (newest edit wins, 2026-11-01). Never cleared automatically.
    recovery: prefix(uid) + "items_recovery",
    // A recovery list that could not be read is set aside here (raw values), never discarded.
    recoveryDamaged: prefix(uid) + "items_recovery_damaged",
    // rids of the recovery copies the owner has acknowledged (hides the notice). By id, not by
    // time: a copy from another device can arrive after an acknowledgement and still be new.
    recoverySeen: prefix(uid) + "items_recovery_seen",
  });
  function read(storage, key, fallback) {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  }
  function registry(storage, uid) {
    const reg = read(storage, keys(uid).registry, { docs: [], current: null });
    if (!reg || !Array.isArray(reg.docs))
      throw new Error(
        "기기의 문서 목록을 읽지 못했습니다. 원본은 보존했습니다.",
      );
    return reg;
  }
  const newId = () => "d_" + crypto.randomUUID().replace(/-/g, "");
  function emptyDocument(
    name = "내 연표",
    birth = root.HaedoData.localDate().slice(0, 7),
  ) {
    return {
      profile: { name, birth },
      scale: "signed1",
      events: [],
      spans: [],
      eras: [],
      happiness: [],
      thoughts: [],
      records: [],
      trips: [],
      layers: [],
    };
  }
  function legacyBackup(storage) {
    const docs = [],
      raw = [];
    let reg = { docs: [] };
    try {
      reg = read(storage, "caeyeon_life_registry", reg);
    } catch (_) {
      raw.push({
        key: "caeyeon_life_registry",
        value: storage.getItem("caeyeon_life_registry"),
      });
    }
    const candidates = new Map(
      (Array.isArray(reg?.docs) ? reg.docs : []).map((d) => [d.id, d.name]),
    );
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith("caeyeon_life_doc_"))
        candidates.set(
          key.slice("caeyeon_life_doc_".length),
          candidates.get(key.slice("caeyeon_life_doc_".length)),
        );
    }
    for (const [id, name] of candidates) {
      const source = storage.getItem("caeyeon_life_doc_" + id);
      try {
        const data = JSON.parse(source);
        if (!root.HaedoData.isDocument(data)) throw new Error();
        docs.push({ id, name: name || data.profile.name || "내 연표", data });
      } catch (_) {
        if (source) raw.push({ key: "caeyeon_life_doc_" + id, value: source });
      }
    }
    if (!docs.length) {
      const source = storage.getItem("caeyeon_life_v2");
      if (source) {
        try {
          const data = JSON.parse(source);
          if (!root.HaedoData.isDocument(data)) throw new Error();
          docs.push({
            id: "legacy",
            name: data.profile.name || "내 연표",
            data,
          });
        } catch (_) {
          raw.push({ key: "caeyeon_life_v2", value: source });
        }
      }
    }
    return {
      format: "haedo-backup-v1",
      exportedAt: new Date().toISOString(),
      docs,
      raw,
    };
  }
  function importDocs(
    storage,
    uid,
    backup,
    makeId = newId,
    fromLegacy = false,
    { keepCurrent = false } = {},
  ) {
    assertBackupFormat(backup);
    const reg = registry(storage, uid),
      accountKeys = keys(uid);
    const imported = root.HaedoData.prepareImport(
      backup,
      makeId,
      (value) => value,
    );
    const stamp = new Date().toISOString();
    for (const doc of imported)
      storage.setItem(accountKeys.docs + doc.id, JSON.stringify(doc.data));
    // Commit registry last; a failed write leaves source records and copies recoverable.
    reg.docs.push(
      ...imported.map((doc, i) => ({
        id: doc.id,
        name: doc.name,
        updated: stamp,
        ...(fromLegacy ? { legacySource: backup.docs[i].id } : {}),
      })),
    );
    // A '행복도 복원' timeline (a backup with 행복도 only) does not replace the timeline being viewed.
    if (!keepCurrent || !reg.current) reg.current = imported[0].id;
    storage.setItem(accountKeys.registry, JSON.stringify(reg));
    return imported;
  }
  function assertBackupFormat(backup) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup))
      throw new Error("JSON 백업의 형식을 확인해 주세요. 기존 기록은 변경하지 않았습니다.");
    if (
      Object.prototype.hasOwnProperty.call(backup, "format") &&
      !["haedo-backup-v1", "haedo-platform-backup-v1"].includes(backup.format)
    )
      throw new Error("연표·목표·습관 백업을 선택해 주세요. 생활 자료 백업은 자료 모아보기에서 새 사본으로 복원할 수 있습니다.");
    return true;
  }
  function addDays(value, n) {
    const date = new Date(value + "T12:00:00");
    date.setDate(date.getDate() + n);
    return root.HaedoData.localDate(date);
  }
  const dayOfWeek = (value) => new Date(value + "T12:00:00").getDay();
  const scheduled = (habit, date) =>
    date >= habit.created && habit.days.includes(dayOfWeek(date));
  function streak(habit, today) {
    let date = today,
      count = 0,
      examined = 0;
    if (scheduled(habit, today) && !habit.checks.includes(today))
      date = addDays(date, -1);
    while (date >= habit.created && examined++ < 36600) {
      if (scheduled(habit, date)) {
        if (!habit.checks.includes(date)) break;
        count++;
      }
      date = addDays(date, -1);
    }
    return count;
  }
  function toggleHabit(habit, date, today) {
    if (
      !root.HaedoData.validDate(date) ||
      date.length !== 10 ||
      date > today ||
      !scheduled(habit, date)
    )
      throw new Error("이 날짜는 완료 체크를 할 수 없습니다.");
    return {
      ...habit,
      checks: habit.checks.includes(date)
        ? habit.checks.filter((d) => d !== date)
        : [...habit.checks, date].sort(),
    };
  }
  function validItem(row) {
    const d = row?.data;
    if (
      !d ||
      typeof row.id !== "string" ||
      typeof d.title !== "string" ||
      !["goal", "habit"].includes(row.kind)
    )
      return false;
    if (row.kind === "goal")
      return (
        Number.isFinite(d.progress) &&
        d.progress >= 0 &&
        d.progress <= 100 &&
        (!d.target ||
          (d.target.length === 10 && root.HaedoData.validDate(d.target)))
      );
    return (
      Array.isArray(d.days) &&
      d.days.length > 0 &&
      d.days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) &&
      typeof d.created === "string" &&
      d.created.length === 10 &&
      root.HaedoData.validDate(d.created) &&
      Array.isArray(d.checks) &&
      d.checks.every(
        (v) =>
          typeof v === "string" &&
          v.length === 10 &&
          root.HaedoData.validDate(v),
      )
    );
  }
  // 행복도: the timeline stores v in [-1, 1] (scale signed1); the schedule shows 0–10. The mapping
  // is the timeline's own 0–10 → signed1 migration (app.js migrateScale): v = (n - 5) / 5.
  function happinessScore(v) {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1) return null;
    return Math.min(10, Math.max(0, Math.round(5 + 5 * v)));
  }
  const isDay = (date) => typeof date === "string" && date.length === 10 && root.HaedoData.validDate(date);
  // The day's own entry (date YYYY-MM-DD); month-level points of the timeline are not a day's input.
  // Values are read on the document's own scale (an older document without `scale` is 0–10),
  // through the same conversion the timeline editor applies when it opens it.
  function happinessOn(doc, date) {
    if (!isDay(date) || !Array.isArray(doc?.happiness)) return null;
    const entry = doc.happiness.find((h) => h && h.date === date && Number.isFinite(h.v));
    if (!entry) return null;
    const v = root.HaedoData.scaleValue(entry.v, doc.scale), score = happinessScore(v);
    return score === null ? null : { v, score };
  }
  // The timeline the 일정 screen reads 행복도 from (it does not write it): the same one on every
  // device. Recovery copies and documents without a body (read → null) are skipped; among the
  // rest, the timeline with the most daily 행복도 (with read), then the smallest document ID
  // (IDs are the same everywhere, unlike the device-local registry.current).
  const dailyCount = (doc) => (Array.isArray(doc?.happiness) ? doc.happiness.filter((point) => isDay(point?.date)).length : 0);
  function baseDocument(reg, { read = null } = {}) {
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let docs = (reg?.docs || []).filter((doc) => doc && typeof doc.id === "string" && !root.HaedoData.isRecoveryName(doc.name));
    if (read) docs = docs.filter((doc) => read(doc.id) !== null);
    if (read) {
      const scored = docs.map((doc) => ({ doc, n: dailyCount(read(doc.id)) })).filter((row) => row.n > 0)
        .sort((a, b) => b.n - a.n || byId(a.doc, b.doc));
      if (scored.length) return scored[0].doc;
    }
    return docs.sort(byId)[0] || null;
  }
  // ── 하루 행복도의 정본은 계정 문서 happinessDays다(2026-11-04 소유자 결정,
  // docs/life-tools-design/happiness-single-writer.md). 연표 문서의 하루 점은 지우지 않고, 아래
  // 함수들이 그 점을 옮길 값으로 읽거나(timelineDays) 보이는 곡선에서 가린다(curvePoints).
  const HAPPINESS_EPOCH = "1970-01-01T00:00:00.000Z";
  const round2 = (v) => Math.round(v * 100) / 100;
  // A timeline's daily points as the account document stores them: signed1, two decimals, one per
  // date — the last one stored when a date has several (every device picks the same one).
  function timelineDays(doc) {
    const days = {};
    if (!Array.isArray(doc?.happiness)) return days;
    for (const point of doc.happiness) {
      if (!point || !isDay(point.date) || typeof point.v !== "number" || !Number.isFinite(point.v)) continue;
      const v = round2(root.HaedoData.scaleValue(point.v, doc.scale));
      if (!Number.isFinite(v) || Math.abs(v) > 1) continue;
      days[point.date] = { v, ...(point.future === true ? { future: true } : {}) };
    }
    return days;
  }
  // The points a curve shows: the timeline's own points (on its scale, converted to signed1), except
  // daily points whose date the account document has (also a deletion, v null), plus the account
  // document's values. Copies only: the result is never stored (the timeline keeps its own points).
  function curvePoints(doc, entries) {
    const known = new Map((Array.isArray(entries) ? entries : []).filter((entry) => entry && isDay(entry.date)).map((entry) => [entry.date, entry]));
    const points = [];
    for (const point of Array.isArray(doc?.happiness) ? doc.happiness : []) {
      if (!point || typeof point.date !== "string" || typeof point.v !== "number" || !Number.isFinite(point.v)) continue;
      const day = isDay(point.date);
      if (day && known.has(point.date)) continue;
      points.push({ date: point.date, v: root.HaedoData.scaleValue(point.v, doc.scale), future: !!point.future, day, account: false, src: point });
    }
    for (const entry of known.values()) {
      if (entry.v === null || typeof entry.v !== "number") continue;
      points.push({ date: entry.date, v: entry.v, future: !!entry.future, day: true, account: true, src: null });
    }
    return points;
  }
  // Which of this account's timelines the 일정 shell may hand to absorbTimelineDays now, and with
  // which version time. Recovery copies are skipped. A timeline sent before (syncedAt) is used only
  // while it has no unsent change ({server: its server time}); one never sent ({local: its device
  // time}) only when the last server list this page received does not have it. Without such a list
  // (offline, not read yet) or with the id on it but no syncedAt (the registry save after a send
  // failed), it waits. In id order: the smaller id's value stays when two timelines differ.
  function happinessSources(reg, { read, serverIds = null } = {}) {
    const ready = [], waiting = [];
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const meta of [...(reg?.docs || [])].filter((doc) => doc && typeof doc.id === "string").sort(byId)) {
      if (root.HaedoData.isRecoveryName(meta.name)) continue;
      const body = read ? read(meta.id) : null;
      if (!body || typeof body !== "object") continue;
      let stamp = null;
      if (meta.syncedAt) {
        if (meta.updated && meta.updated !== meta.syncedAt) { waiting.push({ id: meta.id, reason: "unsent" }); continue; }
        stamp = { server: meta.syncedAt };
      } else if (!serverIds) { waiting.push({ id: meta.id, reason: "no_server_list" }); continue; }
      else if (serverIds.has(meta.id)) { waiting.push({ id: meta.id, reason: "unknown" }); continue; }
      else stamp = { local: typeof meta.updated === "string" && Number.isFinite(Date.parse(meta.updated)) ? meta.updated : HAPPINESS_EPOCH };
      ready.push({ id: meta.id, name: meta.name, points: timelineDays(body), stamp });
    }
    return { ready, waiting };
  }
  // Restoring a timeline backup that carries 행복도 (happinessDays, full-backup timeline part): the
  // timeline pages have no account-document engine, so the values go into the restored copies as the
  // daily points shown at backup time (curvePoints: a timeline's own daily point stays only where the
  // account had no entry; a deletion removes it), on signed1. Every copy gets the same points. The 일정
  // shell then moves only the dates the account document lacks (absorbHappiness), so nothing it has is
  // replaced and a deleted day does not come back. A backup with 행복도 only gets one new timeline
  // named '행복도 복원' (happinessOnly: the importer keeps the timeline being viewed).
  const RESTORED_NAME = "행복도 복원";
  function restoreBackupDays(backup) {
    const raw = backup?.happinessDays?.entries;
    if (!Array.isArray(raw)) return { backup, happinessOnly: false, days: 0 };
    const entries = raw.filter((entry) => entry && isDay(entry.date) && (entry.v === null || (typeof entry.v === "number" && Number.isFinite(entry.v) && Math.abs(entry.v) <= 1)));
    const known = new Set(entries.map((entry) => entry.date)), shown = entries.filter((entry) => entry.v !== null);
    const fill = (data) => {
      const copy = root.HaedoData.toSignedScale(structuredClone(data));
      copy.happiness = [...(Array.isArray(copy.happiness) ? copy.happiness : []).filter((point) => !(point && isDay(point.date) && known.has(point.date))),
        ...shown.map((entry) => ({ date: entry.date, v: entry.v, ...(entry.future ? { future: true } : {}) }))];
      return copy;
    };
    const docs = Array.isArray(backup.docs) ? backup.docs : root.HaedoData.isDocument(backup) ? [{ data: backup }] : [];
    if (docs.length) return { backup: { ...backup, docs: docs.map((doc) => ({ ...doc, data: fill(doc.data) })) }, happinessOnly: false, days: shown.length };
    if (!shown.length) return { backup, happinessOnly: false, days: 0 };
    return { backup: { ...backup, docs: [{ name: RESTORED_NAME, data: fill(emptyDocument(RESTORED_NAME)) }] }, happinessOnly: true, days: shown.length };
  }
  // One pass of the 일정 shell: every ready timeline of this account (its own registry only — the
  // pre-account caeyeon_life_registry list is out of scope) goes to storage.absorbTimelineDays, which
  // decides inside one transaction what to write. `account` is the account captured when the pass
  // began; storage refuses it once another account is open. isCurrent() stops a pass that went stale.
  async function absorbHappiness({ storage, localStorage, uid, account, serverIds = null, isCurrent = () => true }) {
    const k = keys(uid), reg = registry(localStorage, uid);
    const read = (id) => { try { return JSON.parse(localStorage.getItem(k.docs + id)); } catch (_) { return null; } };
    const { ready, waiting } = happinessSources(reg, { read, serverIds });
    const results = [];
    for (const source of ready) {
      if (!isCurrent()) break;
      results.push({ id: source.id, ...(await storage.absorbTimelineDays({ account, docId: source.id, points: source.points, stamp: source.stamp })) });
    }
    return { results, waiting };
  }
  // The 일정 value of a day: the account document's entry (a deletion shows nothing), else a daily
  // point still only in the timeline (not migrated yet).
  function happinessFor(entries, doc, date) {
    const entry = (Array.isArray(entries) ? entries : []).find((item) => item && item.date === date);
    if (entry) {
      if (entry.v === null) return null;
      const score = happinessScore(entry.v);
      return score === null ? null : { v: entry.v, score, account: true };
    }
    return doc ? happinessOn(doc, date) : null;
  }
  // Habits that apply on date (created on or before it, on one of its weekdays), with their check.
  function dueHabits(items, date) {
    if (!isDay(date)) return [];
    return (items || []).filter((item) => item.kind === "habit" && !item.data.deleted && scheduled(item.data, date))
      .map((item) => ({ item, checked: item.data.checks.includes(date) }));
  }
  // Goals not yet finished whose target date (if any) is not before the period start.
  function activeGoals(items, from) {
    return (items || []).filter((item) => item.kind === "goal" && !item.data.deleted && item.data.progress < 100 &&
      (!item.data.target || !from || item.data.target >= from))
      .sort((a, b) => (a.data.target || "9999").localeCompare(b.data.target || "9999") || a.data.title.localeCompare(b.data.title));
  }
  // Newest edit wins; a tie (or an unreadable stamp) goes to the server copy, as in the other engines.
  function localWins(localStamp, remoteStamp) {
    const local = Date.parse(localStamp || ""), remote = Date.parse(remoteStamp || "");
    return Number.isFinite(local) && (!Number.isFinite(remote) || local > remote);
  }
  const api = {
    keys,
    read,
    registry,
    newId,
    emptyDocument,
    legacyBackup,
    importDocs,
    assertBackupFormat,
    addDays,
    dayOfWeek,
    scheduled,
    streak,
    toggleHabit,
    validItem,
    happinessScore,
    happinessOn,
    happinessFor,
    timelineDays,
    curvePoints,
    happinessSources,
    absorbHappiness,
    restoreBackupDays,
    HAPPINESS_EPOCH,
    baseDocument,
    dueHabits,
    activeGoals,
    localWins,
  };
  if (typeof module !== "undefined" && module.exports) {
    root.HaedoData = require("./data.js");
    module.exports = api;
  } else root.HaedoPlatformData = api;
})(globalThis);
