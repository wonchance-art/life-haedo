/* Shared offline adapter. Imported text is never executed or rewritten. */
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./core.js")
      : root.HaedoLife.Core,
    root.crypto || (typeof require === "function" && require("node:crypto").webcrypto),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ObsidianDecisions = api;
})(globalThis, function (Core, crypto) {
  "use strict";
  const contexts = new WeakMap();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" :
    v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const check = (ok, code) => { if (!ok) fail(code); };
  const fields = (value, names) => check(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name)), "invalid_decisions");
  const hash = async (value) => Array.from(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ), (n) => n.toString(16).padStart(2, "0")).join("");
  const key = (path, locator) => JSON.stringify([path, locator.start, locator.end]);
  function range(text, locator) {
    return locator && Number.isSafeInteger(locator.start) && Number.isSafeInteger(locator.end) &&
      locator.start >= 0 && locator.end > locator.start && locator.end <= text.length;
  }
  function anchors(text) {
    const result = [];
    let fence = null;
    for (const m of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
      const line = m[0].replace(/[\r\n]+$/, ""), mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^\s*$/.test(line.slice(mark[0].length))) fence = null;
        continue;
      }
      if (mark) { fence = mark[1]; continue; }
      if (/^ {0,3}#{1,6}\s+\S/.test(line) || /(?:^|\s)\^[A-Za-z0-9-]+\s*$/.test(line))
        result.push({ start: m.index, end: m.index + line.length, text: line });
    }
    return result;
  }
  function candidates(audit, ref) {
    if (ref.reason === "anchor_missing") return [ref.targetPath];
    if (!["missing", "ambiguous"].includes(ref.reason)) return [];
    const file = ref.target.split("#")[0].split("/").pop().replace(/\.md$/i, "");
    return audit.files.filter((f) => f.workspace === "notes" &&
      f.path.split("/").pop().replace(/\.md$/i, "") === file).map((f) => f.path).sort();
  }
  async function verifyBackup(raw, audit, workspace) {
    const backup = JSON.parse(raw);
    // Use the same validator/hash verifier as the actual account restore flow.
    await Core.restoreBackup(backup);
    const bundle = backup.workspace, rows = audit.files.filter((f) => f.workspace === workspace);
    check(rows.length === bundle.sources.length && rows.length === bundle.sourceVersions.length, "file_count_mismatch");
    const sources = new Map(bundle.sources.map((s) => [s.id, s]));
    const versions = new Map(bundle.sourceVersions.map((v) => [v.id, v]));
    const byPath = new Map();
    for (const row of rows) {
      const source = sources.get(row.sourceId), version = versions.get(row.sourceVersionId);
      check(source && version && version.sourceId === source.id && source.sourceKey === row.path && source.origin === "obsidian", "source_mismatch");
      check(source.url === audit.repositoryUrl + "/blob/" + audit.ref + "/" + row.path.split("/").map(encodeURIComponent).join("/"), "source_url_mismatch");
      const text = version.contentText || "";
      check(new TextEncoder().encode(text).length === row.bytes && await hash(text) === row.sha256, "source_hash_mismatch");
      check(!byPath.has(row.path), "duplicate_path");
      byPath.set(row.path, { row, source, version, text });
    }
    return { backup, byPath };
  }
  async function openPackage(input) {
    // Snapshot before any asynchronous verification; caller-owned objects never enter context.
    const { notes, audit: auditText, review: reviewText, supporting } = { ...input };
    check([notes, auditText, reviewText, supporting].every((v) => typeof v === "string"), "package_files_required");
    const audit = JSON.parse(auditText), review = JSON.parse(reviewText);
    check(audit.format === "haedo-vault-audit-v1" && /^[a-f0-9]{40}$/.test(audit.ref) && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(audit.repositoryUrl), "invalid_audit");
    check(Array.isArray(audit.files) && Array.isArray(audit.unresolvedReferences), "invalid_audit");
    check(new Set(audit.files.map((f) => f.path)).size === audit.files.length, "duplicate_path");
    for (const f of audit.files) check(typeof f.path === "string" && !/^(?:\/|[A-Za-z]:)/.test(f.path) && !/[\\\u0000-\u001f]/.test(f.path) && f.path.split("/").every((p) => p && p !== "." && p !== "..") && ["notes", "files"].includes(f.workspace), "invalid_path");
    const verified = await verifyBackup(notes, audit, "notes");
    const verifiedFiles = await verifyBackup(supporting, audit, "files");
    const refs = new Map();
    for (const ref of audit.unresolvedReferences) {
      const origin = verified.byPath.get(ref.path);
      check(origin && typeof ref.target === "string" && range(origin.text, ref.locator), "invalid_reference");
      const id = key(ref.path, ref.locator);
      check(!refs.has(id), "duplicate_reference");
      refs.set(id, { ...ref, id, token: origin.text.slice(ref.locator.start, ref.locator.end), candidatePaths: candidates(audit, ref) });
    }
    check(review.format === "haedo-vault-review-v1" && review.ref === audit.ref && review.repositoryUrl === audit.repositoryUrl && Array.isArray(review.groups) && Array.isArray(review.informational), "review_mismatch");
    const items = [], groups = [], seen = new Set(), groupIds = new Set();
    for (const group of review.groups) {
      check(typeof group.id === "string" && /^[a-f0-9]{20}$/.test(group.id) && !groupIds.has(group.id), "review_mismatch");
      groupIds.add(group.id);
      check(Array.isArray(group.occurrences) && group.occurrences.length > 0, "review_mismatch");
      const ids = [];
      for (const occurrence of group.occurrences) {
        const ref = refs.get(key(occurrence.path, occurrence.locator));
        check(ref && !seen.has(ref.id) && ref.target === group.target && equal(ref.candidatePaths, group.targetPath ? [group.targetPath] : group.candidatePaths), "review_mismatch");
        check(["missing", "ambiguous", "anchor_missing", "invalid"].includes(ref.reason), "review_mismatch");
        seen.add(ref.id); ids.push(ref.id);
        const origin = verified.byPath.get(ref.path);
        items.push({ id: ref.id, groupId: group.id, path: ref.path, target: ref.target, reason: ref.reason,
          locator: clone(ref.locator), token: ref.token, candidatePaths: ref.candidatePaths,
          excerpt: origin.text.slice(Math.max(0, ref.locator.start - 200), ref.locator.end + 200) });
      }
      groups.push({ id: group.id, target: group.target, ids });
    }
    // Review metadata is a display projection, never authority to apply an arbitrary reference.
    check(items.length === review.summary.reviewOccurrences && groups.length === review.summary.reviewGroups, "review_mismatch");
    for (const row of review.informational) {
      const ref = refs.get(key(row.path, row.locator));
      check(ref && !seen.has(ref.id) && ref.target === row.target && ref.reason === "missing" &&
        row.reviewRequired === false && ["attachment_missing", "supporting_file", "external_relative"].includes(row.category), "review_mismatch");
      seen.add(ref.id);
    }
    check(seen.size === refs.size && review.informational.length === review.summary.informationalOccurrences && refs.size === review.summary.unresolvedOccurrences, "review_mismatch");
    const eligible = new Set(items.map((item) => item.id));
    const binding = { repositoryUrl: audit.repositoryUrl, ref: audit.ref, auditSha256: await hash(auditText) };
    const handle = { binding: clone(binding), groups, items, totalReferences: refs.size,
      informationalOccurrences: review.informational.length };
    contexts.set(handle, { ...verified, filesBackup: verifiedFiles.backup, audit, binding, refs, eligible });
    return handle;
  }
  function context(handle) { const ctx = contexts.get(handle); check(ctx, "package_required"); return ctx; }
  function targetInfo(handle, path) {
    const item = context(handle).byPath.get(path);
    check(item, "unknown_target");
    return { path, text: item.text, anchors: anchors(item.text) };
  }
  function makeDecisions(handle, selections) {
    const ctx = context(handle);
    check(Array.isArray(selections), "invalid_decisions");
    return { format: "haedo-vault-decisions-v1", ...clone(ctx.binding), decisions: selections.map((s) => {
      const ref = ctx.refs.get(s.id), target = ctx.byPath.get(s.targetPath), origin = ref && ctx.byPath.get(ref.path);
      check(ref && ctx.eligible.has(s.id) && target && ref.candidatePaths.includes(s.targetPath), "unknown_candidate");
      return { occurrenceId: ref.id, path: ref.path, sourceSha256: origin.row.sha256,
        locator: clone(ref.locator), token: ref.token, target: ref.target, targetPath: s.targetPath,
        targetSha256: target.row.sha256, targetLocator: s.targetLocator === null ? null : clone(s.targetLocator) };
    }) };
  }
  function validateDecisions(handle, input) {
    const ctx = context(handle), data = clone(input);
    fields(data, ["format", "repositoryUrl", "ref", "auditSha256", "decisions"]);
    check(data.format === "haedo-vault-decisions-v1" && equal(
      [data.repositoryUrl, data.ref, data.auditSha256],
      [ctx.binding.repositoryUrl, ctx.binding.ref, ctx.binding.auditSha256]), "stale_decisions");
    check(Array.isArray(data.decisions), "invalid_decisions");
    const seen = new Set();
    for (const d of data.decisions) {
      fields(d, ["occurrenceId", "path", "sourceSha256", "locator", "token", "target", "targetPath", "targetSha256", "targetLocator"]);
      const ref = ctx.refs.get(d.occurrenceId), target = ctx.byPath.get(d.targetPath), origin = ref && ctx.byPath.get(ref.path);
      check(!seen.has(d.occurrenceId), "duplicate_decision"); seen.add(d.occurrenceId);
      check(ref && ctx.eligible.has(ref.id) && target && ref.candidatePaths.includes(d.targetPath), "unknown_candidate");
      check(d.path === ref.path && equal(d.locator, ref.locator) && d.token === ref.token && d.target === ref.target && d.sourceSha256 === origin.row.sha256 && d.targetSha256 === target.row.sha256, "stale_decisions");
      if (d.targetLocator !== null) check(anchors(target.text).some((a) => equal(a, d.targetLocator)), "invalid_target_locator");
      else check(!ref.target.includes("#") && ref.reason !== "anchor_missing", "target_locator_required");
    }
    return data;
  }
  function preview(handle, input) {
    const ctx = context(handle), decisions = validateDecisions(handle, input), changes = [];
    for (const d of decisions.decisions) {
      const origin = ctx.byPath.get(d.path), target = ctx.byPath.get(d.targetPath);
      const sourceRefs = [
        { sourceId: origin.source.id, sourceVersionId: origin.version.id, locator: clone(d.locator) },
        { sourceId: target.source.id, sourceVersionId: target.version.id,
          locator: d.targetLocator === null ? null : { start: d.targetLocator.start, end: d.targetLocator.end } },
      ];
      const existing = ctx.backup.workspace.links.filter((link) => link.kind === "obsidian_link" && equal(link.sourceRefs[0], sourceRefs[0]));
      check(existing.length <= 1, "conflicting_link");
      let action = "add";
      if (existing.length) {
        const link = existing[0];
        if (equal(link.sourceRefs, sourceRefs)) action = "unchanged";
        else {
          check(ctx.refs.get(d.occurrenceId).reason === "anchor_missing" &&
            link.sourceRefs[1].sourceId === target.source.id && link.sourceRefs[1].sourceVersionId === target.version.id && link.sourceRefs[1].locator === null,
          "conflicting_link");
          action = "locate";
        }
      }
      changes.push({ occurrenceId: d.occurrenceId, path: d.path, targetPath: d.targetPath, action,
        targetLocator: d.targetLocator, sourceRefs, existingId: existing[0]?.id || null });
    }
    return { decisions, changes, summary: {
      added: changes.filter((c) => c.action === "add").length,
      located: changes.filter((c) => c.action === "locate").length,
      unchanged: changes.filter((c) => c.action === "unchanged").length,
      deferred: ctx.eligible.size - changes.length,
      informational: handle.informationalOccurrences,
    } };
  }
  async function apply(handle, input) {
    const result = preview(handle, input), ctx = context(handle), bundle = clone(ctx.backup.workspace), time = new Date().toISOString();
    for (const change of result.changes) {
      if (change.action === "unchanged") continue;
      if (change.action === "locate") {
        const link = bundle.links.find((l) => l.id === change.existingId);
        link.sourceRefs = clone(change.sourceRefs); link.revision++; link.updatedAt = time;
      } else bundle.links.push({ id: Core.id(), kind: "obsidian_link",
        note: ctx.refs.get(change.occurrenceId).target, sourceRefs: clone(change.sourceRefs),
        revision: 1, createdAt: time, updatedAt: time });
    }
    if (result.summary.added || result.summary.located) { bundle.revision++; bundle.updatedAt = time; }
    const notesBackup = Core.makeBackup(bundle);
    await Core.restoreBackup(notesBackup);
    return { notesBackup, decisions: result.decisions, history: {
      format: "haedo-vault-application-v1", ...clone(ctx.binding), appliedAt: time,
      summary: result.summary, changes: result.changes.map(({ sourceRefs, existingId, ...value }) => value),
      scope: "New private copy only; original bodies and unresolved audit retained.",
    } };
  }
  async function restoreCopies(handle) {
    const ctx = context(handle);
    return { notes: await Core.restoreBackup(ctx.backup), files: await Core.restoreBackup(ctx.filesBackup) };
  }
  return Object.freeze({ openPackage, targetInfo, makeDecisions, validateDecisions, preview, apply, restoreCopies });
});
