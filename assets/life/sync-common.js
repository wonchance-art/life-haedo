/* Shared sync helpers (structure review S1). Pure functions: no network, storage or DOM. */
(function (root, factory) {
  'use strict'; const api = factory(); (root.HaedoLife ||= {}).SyncCommon = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  // Sorted-JSON text of S0 group G3 (tests/structure-baseline.test.cjs), shared by blog-sync and
  // material-continuity-sync. Both use it only within one run (equality checks and a check hash that
  // is compared and dropped); its output is not stored anywhere today. The stored fingerprints come
  // from other helpers: G4 material-continuity.js fingerprint() (preparations on devices), G3
  // naver-capture.js (its own copy, run by the Naver Edge function; capture hash on the server) and G6
  // account-materials.js (registration receipts). The output stays pinned by S0 all the same: it is
  // not JSON for undefined values, toJSON methods or sparse-array holes, and a Date becomes {}.
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);

  // ---- Originals workspace merge (2026-11-11) -------------------------------------------------
  // Two devices changed the same workspace (sources, exact source versions, excerpts, links).
  // mergeWorkspace joins both snapshots item by item, so neither side has to be chosen:
  //   - exact source versions are immutable: both sides' versions stay, byte for byte, and
  //     excerpts keep pointing at the exact version and UTF-16 range they were taken from;
  //   - an item only one side changed since the last agreed server snapshot (`base`) is taken
  //     as changed; an item both sides changed keeps the later edit, and an excerpt that lost
  //     stays as a separate `복구 사본` excerpt;
  //   - a deletion never removes something the other side changed meanwhile.
  // The result depends only on the three inputs, not on which side is called local: every device
  // computes the same content. Without a base nothing is deleted (the storage stands in for a
  // missing base with this device's own commit receipts whenever it can; see mergeSyncRemote).
  const STATE_KINDS = ['source_trash', 'source_active'];
  const IMMUTABLE_KINDS = ['source_edited_copy', 'source_edit_base'];
  const RECOVERY_TOPIC = '복구 사본';
  // Kept beside the source when both devices changed it and one title or file path lost: the
  // losing device's text, on the exact version that device last saved. Ordinary link rows of the
  // existing workspace format (kind, note, sourceRefs), so every device and version carries them.
  const PREVIOUS_TITLE = 'source_previous_title', PREVIOUS_KEY = 'source_previous_key';
  const COLLECTIONS = ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'];
  const fault = (code, message) => Object.assign(new Error(message), { code });
  const copy = value => JSON.parse(JSON.stringify(value));
  const stamp = value => { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; };
  const laterTime = (left, right) => stamp(right) > stamp(left) || stamp(right) === stamp(left) && String(right) > String(left) ? right : left;
  const withoutRevision = item => { const value = { ...item }; delete value.revision; return value; };
  // The later edit wins. Equal times fall back to the content itself, so the choice never
  // depends on which device compares.
  function newer(left, right) {
    const a = stamp(left.updatedAt), b = stamp(right.updatedAt);
    if (a !== b) return a > b ? left : right;
    return canonical(withoutRevision(left)) >= canonical(withoutRevision(right)) ? left : right;
  }
  // A source's file path is filled in from the losing side when the winner has none (below), so
  // equal times are decided without it first: the merged source then compares like the side
  // that won, and merging the result again with either side changes nothing.
  function newerSource(left, right) {
    const a = stamp(left.updatedAt), b = stamp(right.updatedAt);
    if (a !== b) return a > b ? left : right;
    const plain = item => { const value = withoutRevision(item); delete value.sourceKey; return canonical(value); };
    const x = plain(left), y = plain(right);
    if (x !== y) return x > y ? left : right;
    return (left.sourceKey || '') >= (right.sourceKey || '') ? left : right;
  }
  // Cut at a code point boundary: half of a surrogate pair is not text a server stores.
  function clip(text, max) {
    if (text.length <= max) return text;
    const last = text.charCodeAt(max - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
  }
  // No unpaired surrogate in any string of the value (objects and arrays are walked).
  function wellFormed(value) {
    if (typeof value === 'string') {
      for (let index = 0; index < value.length; index++) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
        else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
      }
      return true;
    }
    if (Array.isArray(value)) return value.every(wellFormed);
    if (value && typeof value === 'object') return Object.keys(value).every(key => wellFormed(key) && wellFormed(value[key]));
    return true;
  }
  const maxRevision = (left, right) => left.revision === undefined && right.revision === undefined ? undefined : Math.max(left.revision || 1, right.revision || 1);
  // 128 bits of the text as a UUID-shaped identifier. Not a security hash: it only gives the
  // same recovery excerpt the same identifier on every device.
  function derivedId(text) {
    let a = 0xdeadbeef, b = 0x41c6ce57, c = 0x9e3779b9, d = 0x85ebca6b;
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      a = Math.imul(a ^ unit, 2654435761); b = Math.imul(b ^ unit, 1597334677);
      c = Math.imul(c ^ unit, 2246822507); d = Math.imul(d ^ unit, 3266489909);
      a ^= d >>> 15; b ^= a >>> 13; c ^= b >>> 16; d ^= c >>> 14;
    }
    const mix = value => { value ^= value >>> 16; value = Math.imul(value, 2246822507); value ^= value >>> 13; value = Math.imul(value, 3266489909); return (value ^ value >>> 16) >>> 0; };
    const hex = [mix(a ^ d), mix(b ^ a), mix(c ^ b), mix(d ^ c)].map(value => value.toString(16).padStart(8, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  // What a later merge needs from the last agreed server snapshot. Source versions are
  // immutable and never deleted, so their text is not kept twice. deleted: the excerpts that
  // snapshot already counted as deleted (a deletion that is not news to a later merge).
  function mergeBase(bundle) {
    return { title: bundle.title, sources: copy(bundle.sources), records: copy(bundle.records), links: copy(bundle.links), resumeHints: copy(bundle.resumeHints),
      deleted: (bundle.tombstones || []).map(mark => mark.entityId) };
  }
  function baseIndex(base) {
    if (!base) return null;
    const index = { title: base.title, deleted: new Set(Array.isArray(base.deleted) ? base.deleted : []) };
    for (const name of ['sources', 'records', 'links', 'resumeHints']) {
      if (!Array.isArray(base[name])) return null;
      index[name] = new Map(base[name].map(item => [item.id, canonical(item)]));
    }
    return typeof base.title === 'string' ? index : null;
  }
  // Both lists keep their own order; items only one side has are placed by `key` (then id)
  // between the items both sides share.
  function mergeOrder(left, right, key) {
    const inLeft = new Set(left.map(item => item.id)), inRight = new Set(right.map(item => item.id));
    const before = (a, b) => { const x = key(a), y = key(b); return x !== y ? x < y : a.id < b.id; };
    const emitted = new Set(), order = [];
    const emit = item => { emitted.add(item.id); order.push(item.id); };
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      const a = left[i], b = right[j];
      if (a && emitted.has(a.id)) { i++; continue; }
      if (b && emitted.has(b.id)) { j++; continue; }
      if (!a) { emit(b); j++; continue; }
      if (!b) { emit(a); i++; continue; }
      if (a.id === b.id) { emit(a); i++; j++; continue; }
      const aShared = inRight.has(a.id), bShared = inLeft.has(b.id);
      if (aShared !== bShared) { if (aShared) { emit(b); j++; } else { emit(a); i++; } continue; }
      if (before(a, b)) { emit(a); i++; } else { emit(b); j++; }
    }
    return order;
  }
  const stateTarget = link => STATE_KINDS.includes(link.kind) ? link.entityRefs?.[0]?.entityId : undefined;
  // A side's trash/restore row for a source, replaced by the other side's row for the same
  // source (both devices moved a never-trashed source to the trash while apart). Only one row
  // per source is valid, so the merged workspace keeps one identifier.
  function replacedSourceLinks(previous, incoming) {
    const byId = new Set((incoming.links || []).map(link => link.id)), byTarget = new Map();
    for (const link of incoming.links || []) { const target = stateTarget(link); if (target !== undefined) byTarget.set(target, link); }
    const replaced = new Set();
    for (const link of previous.links || []) {
      const target = stateTarget(link);
      if (target === undefined || byId.has(link.id)) continue;
      const next = byTarget.get(target);
      if (next && canonical(next.entityRefs) === canonical(link.entityRefs) && next.revision > link.revision && stamp(next.updatedAt) >= stamp(link.updatedAt)) replaced.add(link.id);
    }
    return replaced;
  }
  function mergeWorkspace({ base = null, local, remote } = {}) {
    if (!local || !remote || local.workspaceId !== remote.workspaceId) throw fault('merge_invalid', '같은 작업공간의 두 자료가 필요합니다.');
    const known = baseIndex(base);
    const maps = side => Object.fromEntries(COLLECTIONS.map(name => [name, new Map(side[name].map(item => [item.id, item]))]));
    const L = maps(local), R = maps(remote);
    const same = (a, b) => canonical(a) === canonical(b);
    // Up to 1 MiB of text each: compare the text directly instead of serialising it.
    const sameVersion = (a, b) => a.contentText === b.contentText && canonical({ ...a, contentText: null }) === canonical({ ...b, contentText: null });
    // Which side changed an item that both sides hold with different content.
    function pick(name, id, l, r) {
      if (known) {
        const original = known[name].get(id), lSame = original !== undefined && canonical(l) === original, rSame = original !== undefined && canonical(r) === original;
        if (lSame && !rSame) return { winner: r, loser: l, both: false };
        if (rSame && !lSame) return { winner: l, loser: r, both: false };
      }
      const winner = name === 'sources' ? newerSource(l, r) : newer(l, r);
      return { winner, loser: winner === l ? r : l, both: true };
    }
    // sourceIds: both devices changed the source (the earlier body is a previous version).
    // recordIds: recovery copies made now. restoredIds: excerpts one device had deleted and
    // that stay because the other device's side could not be shown unchanged.
    const notice = { sourceIds: [], recordIds: [], restoredIds: [] };
    const result = {}, made = [];

    // Exact source versions: the union. The same identifier with other content is damage, not a merge.
    const versions = new Map();
    for (const side of [R, L]) for (const [id, version] of side.sourceVersions) {
      if (versions.has(id) && !sameVersion(versions.get(id), version)) throw fault('immutable_source_version', '같은 식별자의 원문 버전이 서로 다릅니다. 양쪽 원문을 보존했습니다.');
      versions.set(id, version);
    }

    // Sources are never deleted (the trash is a state row below).
    const sources = new Map();
    for (const id of new Set([...R.sources.keys(), ...L.sources.keys()])) {
      const l = L.sources.get(id), r = R.sources.get(id);
      if (!l || !r || same(l, r)) { sources.set(id, l || r); continue; }
      const { winner, loser, both } = pick('sources', id, l, r);
      if (!both) { sources.set(id, winner); continue; }
      const merged = { ...winner, revision: Math.max(l.revision, r.revision) };
      if (merged.sourceKey === undefined && loser.sourceKey !== undefined) merged.sourceKey = loser.sourceKey;
      sources.set(id, merged);
      // The losing title and file path stay beside the version that was current on the losing side
      // when it changed the source (the last one kept by then). The row's identifier comes from
      // the source and the text alone: whichever device merges, and in whatever order, the same
      // losing text is one row. Its times are the source's own creation time (the same on every
      // device); only the version it is kept beside can differ with the order devices meet in.
      // Announced once, when the row is first made.
      const theirs = [...(loser === l ? L : R).sourceVersions.values()].filter(version => version.sourceId === id);
      const last = theirs.filter(version => stamp(version.importedAt) <= stamp(loser.updatedAt)).at(-1) || theirs[0];
      const keep = (kind, text) => {
        if (!last) return;
        const row = { id: derivedId(canonical([kind, id, text])), kind, note: text,
          sourceRefs: [{ sourceId: id, sourceVersionId: last.id, locator: null }], revision: 1, createdAt: loser.createdAt, updatedAt: loser.createdAt };
        if (L.links.has(row.id) || R.links.has(row.id)) return;
        made.push(row);
        if (known && !notice.sourceIds.includes(id)) notice.sourceIds.push(id);
      };
      if (loser.title !== merged.title) keep(PREVIOUS_TITLE, loser.title);
      if (loser.sourceKey !== undefined && loser.sourceKey !== merged.sourceKey) keep(PREVIOUS_KEY, loser.sourceKey);
    }
    // Both sides added a version to the same source: the earlier one is now a previous version.
    const added = side => new Set([...side.sourceVersions.values()].filter(version => !(side === L ? R : L).sourceVersions.has(version.id)).map(version => version.sourceId));
    const addedLocal = added(L), addedRemote = added(R);
    for (const id of addedLocal) if (addedRemote.has(id) && !notice.sourceIds.includes(id)) notice.sourceIds.push(id);
    notice.sourceIds.sort();

    // Excerpts and their deletion marks.
    const tombL = new Map(local.tombstones.map(item => [item.entityId, item])), tombR = new Map(remote.tombstones.map(item => [item.entityId, item]));
    const records = new Map(), tombstones = new Map(), recoveries = [];
    const keepTombstone = id => {
      const l = tombL.get(id), r = tombR.get(id);
      tombstones.set(id, !l ? r : !r ? l : stamp(l.deletedAt) !== stamp(r.deletedAt) ? (stamp(l.deletedAt) < stamp(r.deletedAt) ? l : r) : l.id <= r.id ? l : r);
    };
    for (const id of new Set([...R.records.keys(), ...L.records.keys(), ...tombR.keys(), ...tombL.keys()])) {
      const l = L.records.get(id), r = R.records.get(id);
      if (l && r) {
        if (same(l, r)) { records.set(id, l); continue; }
        const { winner, loser, both } = pick('records', id, l, r);
        if (!both) { records.set(id, winner); continue; }
        records.set(id, { ...winner, revision: Math.max(l.revision, r.revision) });
        const content = record => canonical([record.text, record.topic, record.note, record.sourceRefs]);
        if (content(winner) !== content(loser)) recoveries.push(loser);
        continue;
      }
      const present = l || r;
      if (!present) { keepTombstone(id); continue; }
      const deletedElsewhere = l ? tombR.has(id) : tombL.has(id);
      // A deletion stands only when the other side still holds exactly what the deleting side saw.
      if (deletedElsewhere && known && known.records.get(id) === canonical(present)) keepTombstone(id);
      // Said once: the snapshot this merge leaves as the base already counts the excerpt as
      // deleted, and a later merge that meets the same deletion again has nothing new to say.
      else { records.set(id, present); if (deletedElsewhere && !known?.deleted.has(id)) notice.restoredIds.push(id); }
    }
    notice.restoredIds.sort();
    const copies = new Map();
    for (const loser of recoveries) {
      const id = derivedId(canonical([loser.id, loser.text, loser.topic, loser.note, loser.sourceRefs]));
      // Already kept by an earlier merge, or the person already deleted that recovery copy.
      if (records.has(id) || copies.has(id) || tombL.has(id) || tombR.has(id)) continue;
      const topic = loser.topic.startsWith(RECOVERY_TOPIC) ? loser.topic : clip(RECOVERY_TOPIC + (loser.topic ? ' · ' + loser.topic : ''), 500);
      copies.set(id, { of: loser.id, record: { ...copy(loser), id, topic, revision: 1 } });
      notice.recordIds.push(id);
    }
    notice.recordIds.sort();

    // Links. One trash/restore row per source; edit history rows never change; the rest keep the later edit.
    const links = new Map(), states = new Map();
    for (const side of [R, L]) for (const [id, link] of side.links) {
      const target = stateTarget(link);
      if (target !== undefined) { const pair = states.get(target) || {}; pair[side === L ? 'l' : 'r'] = link; states.set(target, pair); continue; }
      const other = links.get(id);
      if (!other || same(other, link)) { links.set(id, link); continue; }
      if (IMMUTABLE_KINDS.includes(link.kind) || IMMUTABLE_KINDS.includes(other.kind)) throw fault('immutable_source_link', '보관한 수정 이력이 서로 다릅니다. 양쪽 자료를 보존했습니다.');
      const { winner, both } = pick('links', id, link, other);
      const revision = maxRevision(link, other);
      links.set(id, both && revision !== undefined ? { ...winner, revision } : winner);
    }
    // A row with a higher revision and no earlier time is a later state of the other row: every
    // device takes it as it is (the storage's history check), and merging it again changes nothing.
    const covers = (a, b) => a.revision > b.revision && stamp(a.updatedAt) >= stamp(b.updatedAt);
    for (const [target, { l, r }] of states) {
      let link = l || r;
      if (l && r && !same(l, r)) {
        // Each device may have made its own row for the same source: the earlier identifier stays.
        const keeper = l.id === r.id ? null : stamp(l.createdAt) !== stamp(r.createdAt) ? (stamp(l.createdAt) < stamp(r.createdAt) ? l : r) : l.id <= r.id ? l : r;
        const later = keeper ? (covers(keeper, keeper === l ? r : l) ? keeper : null) : covers(l, r) ? l : covers(r, l) ? r : null;
        if (later) link = later;
        else {
          // Neither is a later state of the other: the later change decides, as a new state of the row.
          const winner = newer(l, r);
          link = { ...(keeper || winner), kind: winner.kind, revision: Math.max(l.revision, r.revision) + 1, updatedAt: laterTime(l.updatedAt, r.updatedAt) };
        }
      }
      if (link.kind === 'source_trash') {
        // One side moved the source to the trash while the other kept working on it (a new
        // version or excerpt the trashing side never saw): the work stays visible.
        const trashed = side => !!side && side.kind === 'source_trash';
        const active = trashed(l) !== trashed(r) ? (trashed(l) ? R : L) : null, other = active === L ? R : L;
        if (active) {
          const times = [];
          for (const version of active.sourceVersions.values()) if (version.sourceId === target && !other.sourceVersions.has(version.id)) times.push(version.id);
          const gone = active === L ? tombR : tombL;
          for (const record of active.records.values()) if (!other.records.has(record.id) && !gone.has(record.id) && records.has(record.id) && record.sourceRefs.some(ref => ref.sourceId === target)) times.push(record.id);
          // The row keeps its own time: the other device's clock (which may be ahead) must not
          // decide when this source can be moved to the trash again.
          if (times.length) link = { ...link, kind: 'source_active', revision: link.revision + 1 };
        }
      }
      links.set(link.id, link);
    }

    const hints = new Map();
    for (const id of new Set([...R.resumeHints.keys(), ...L.resumeHints.keys()])) {
      const l = L.resumeHints.get(id), r = R.resumeHints.get(id);
      if (!l || !r || same(l, r)) { hints.set(id, l || r); continue; }
      const { winner, both } = pick('resumeHints', id, l, r), revision = maxRevision(l, r);
      hints.set(id, both && revision !== undefined ? { ...winner, revision } : winner);
    }
    // What pointed at a deleted excerpt goes with it, as a local deletion does.
    for (let again = true; again;) {
      again = false;
      const exists = { source: sources, sourceVersion: versions, record: records, link: links, resumeHint: hints };
      for (const [id, link] of links) if ((link.entityRefs || []).some(ref => exists[ref.entityType] && !exists[ref.entityType].has(ref.entityId))) { links.delete(id); again = true; }
      for (const [id, hint] of hints) if (hint.recordId !== undefined && !records.has(hint.recordId)) { hints.delete(id); again = true; }
    }

    const ordered = (name, items, key) => mergeOrder(remote[name].filter(item => items.has(item.id)), local[name].filter(item => items.has(item.id)), key).map(id => items.get(id));
    const created = item => stamp(item.createdAt);
    result.sources = ordered('sources', sources, created);
    result.sourceVersions = ordered('sourceVersions', versions, version => stamp(version.importedAt));
    // A recovery copy sits right after the excerpt it lost to, wherever the merge happens.
    result.records = ordered('records', records, created).flatMap(record => [record, ...notice.recordIds.filter(id => copies.get(id).of === record.id).map(id => copies.get(id).record)]);
    // Rows made above come after the rows both devices already had, in one order on every device.
    made.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    result.links = ordered('links', links, created).concat(made.filter((row, index) => made.findIndex(other => other.id === row.id) === index));
    result.resumeHints = ordered('resumeHints', hints, created);
    const marks = new Map([...tombstones.values()].map(item => [item.id, item]));
    result.tombstones = mergeOrder(remote.tombstones.filter(item => marks.has(item.id)), local.tombstones.filter(item => marks.has(item.id)), item => stamp(item.deletedAt)).map(id => marks.get(id));

    const titleSide = known && local.title !== known.title && remote.title === known.title ? local
      : known && remote.title !== known.title && local.title === known.title ? remote
        : stamp(local.updatedAt) !== stamp(remote.updatedAt) ? (stamp(local.updatedAt) > stamp(remote.updatedAt) ? local : remote)
          : local.title >= remote.title ? local : remote;
    // Versions were checked identical by identifier above: their order stands for their content.
    const content = bundle => canonical([bundle.title, ...COLLECTIONS.map(name => name === 'sourceVersions' ? bundle[name].map(version => version.id) : bundle[name])]);
    const bundle = { schemaVersion: 1, workspaceId: local.workspaceId, title: titleSide.title, revision: local.revision,
      createdAt: stamp(local.createdAt) <= stamp(remote.createdAt) ? local.createdAt : remote.createdAt, updatedAt: laterTime(local.updatedAt, remote.updatedAt), ...result };
    const merged = content(bundle), equalsRemote = merged === content(remote), equalsLocal = merged === content(local);
    // Unchanged content keeps that side's own timestamps, so nothing is written or sent for it.
    const kept = equalsRemote ? remote : equalsLocal ? local : null;
    if (kept) { bundle.createdAt = kept.createdAt; bundle.updatedAt = kept.updatedAt; }
    // The items are the inputs' own objects (no second copy of up to 16 MiB of text).
    return { bundle, equalsLocal, equalsRemote, notice: notice.sourceIds.length || notice.recordIds.length || notice.restoredIds.length ? notice : null };
  }
  return Object.freeze({ canonical, mergeWorkspace, mergeBase, replacedSourceLinks, wellFormed, RECOVERY_TOPIC, PREVIOUS_TITLE, PREVIOUS_KEY });
});
