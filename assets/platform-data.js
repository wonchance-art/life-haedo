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
    // keptAt of the newest recovery copy the owner has acknowledged (hides the notice).
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
    reg.current = imported[0].id;
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
  function happinessValue(n) {
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error("행복도는 0부터 10 사이로 골라 주세요.");
    return Math.round(((n - 5) / 5) * 100) / 100;
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
  // A copy of doc with that day's entry set (n) or removed (null). Other entries are untouched; an
  // existing value that already shows as n (e.g. 0.35 shown as 7) is kept as it is.
  function withHappiness(doc, date, n) {
    if (!isDay(date)) throw new Error("행복도를 기록할 날짜를 확인해 주세요.");
    if (!root.HaedoData.isDocument(doc)) throw new Error("연표 문서를 읽지 못했습니다. 원본은 보존했습니다.");
    // Migrate the whole document to signed1 first, as the editor does, so scales never mix.
    const next = root.HaedoData.toSignedScale(structuredClone(doc));
    next.happiness = Array.isArray(next.happiness) ? next.happiness : [];
    const at = next.happiness.findIndex((h) => h && h.date === date);
    if (n === null) { if (at >= 0) next.happiness.splice(at, 1); return next; }
    const v = happinessValue(n);
    if (at >= 0) {
      if (happinessScore(next.happiness[at].v) !== n) next.happiness[at] = { ...next.happiness[at], v };
    } else next.happiness.push({ date, v });
    return next;
  }
  // The timeline the schedule reads and writes: the same one on every device. Recovery copies
  // are skipped; among the rest the smallest document ID is chosen (IDs are the same everywhere,
  // unlike the device-local registry.current).
  function baseDocument(reg) {
    const docs = (reg?.docs || []).filter((doc) => doc && typeof doc.id === "string" && !root.HaedoData.isRecoveryName(doc.name));
    return docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] || null;
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
    happinessValue,
    happinessOn,
    withHappiness,
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
