/* Account-scoped storage preserves every legacy caeyeon_life_* document. */
(function (root) {
  const prefix = (uid) => "caeyeon_life_account_" + uid + "_";
  const keys = (uid) => ({
    registry: prefix(uid) + "registry",
    docs: prefix(uid) + "doc_",
    items: prefix(uid) + "items",
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
  };
  if (typeof module !== "undefined" && module.exports) {
    root.HaedoData = require("./data.js");
    module.exports = api;
  } else root.HaedoPlatformData = api;
})(globalThis);
