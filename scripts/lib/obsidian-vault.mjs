/* Offline, data-only adapter. No imported scripts, plugins, YAML or instructions execute. */
import { createHash } from "node:crypto";
import path from "node:path";
import Core from "../../assets/life/core.js";
import { classifyReferences } from "./obsidian-review.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const problem = (code) => Object.assign(new Error(code), { code });
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// A data-only lexical mask, not a Markdown renderer. Keep every UTF-16 offset
// and line break so references and fragment destinations share the same bounds.
function maskedContent(text) {
  const escaped = (at) => {
    let count = 0;
    while (at > 0 && text[--at] === "\\") count++;
    return count % 2 === 1;
  };
  const nextTick = new Map(), lastTick = new Map(), tickSizes = new Map();
  const runs = [...text.matchAll(/`+/g)];
  for (let n = runs.length - 1; n >= 0; n--) {
    const run = runs[n], size = run[0].length;
    tickSizes.set(run.index, size);
    if (lastTick.has(size)) nextTick.set(run.index, lastTick.get(size));
    if (size > 1 && escaped(run.index)) {
      tickSizes.set(run.index + 1, size - 1);
      if (lastTick.has(size - 1)) nextTick.set(run.index + 1, lastTick.get(size - 1));
    }
    lastTick.set(size, run.index);
  }
  const chunks = [], lineAt = /[^\r\n]*(?:\r\n|\r|\n|$)/y;
  let fence = null, at = 0, kept = 0;
  const hide = (end) => {
    chunks.push(text.slice(kept, at), text.slice(at, end).replace(/[^\r\n]/g, " "));
    at = kept = end;
  };
  while (at < text.length) {
    if (at === 0 || text[at - 1] === "\n" || text[at - 1] === "\r" && text[at] !== "\n") {
      lineAt.lastIndex = at;
      const line = lineAt.exec(text)[0], content = line.replace(/[\r\n]+$/, "");
      const mark = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^[ \t]*$/.test(mark[2])) fence = null;
        hide(at + line.length); continue;
      }
      // A backtick in the info string does not open a backtick fence.
      if (mark && (mark[1][0] !== "`" || !mark[2].includes("`"))) {
        fence = mark[1]; hide(at + line.length); continue;
      }
    }
    if ((text.startsWith("<!--", at) || text.startsWith("%%", at)) && !escaped(at)) {
      const html = text.startsWith("<!--", at), opening = html ? 4 : 2, closing = html ? "-->" : "%%";
      const end = text.indexOf(closing, at + opening);
      if (end >= 0 || html) { hide(end < 0 ? text.length : end + closing.length); continue; }
    }
    if (text[at] === "`") {
      const size = tickSizes.get(at), end = nextTick.get(at);
      if (escaped(at)) { at++; continue; }
      if (end !== undefined) { hide(end + size); continue; }
      at += size; continue;
    }
    at++;
  }
  chunks.push(text.slice(kept));
  return chunks.join("");
}
export function references(text) {
  const masked = maskedContent(text);
  const destination = (value, wiki) => wiki ? value.split("|")[0].trim() :
    value.trim().replace(/\s+["'][^"']*["']$/, "").replace(/^<([^>]+)>$/, "$1");
  const found = [];
  for (const m of masked.matchAll(
    /!?\[\[([^\]\r\n]{1,2000})\]\]|!?\[[^\]\r\n]*\]\(([^)\r\n]{1,2048})\)/g,
  )) {
    let escaped = 0;
    for (let at = m.index - 1; at >= 0 && masked[at] === "\\"; at--) escaped++;
    if (escaped % 2) continue;
    const wiki = m[1] !== undefined, captured = wiki ? m[1] : m[2];
    const offset = wiki ? m[0].indexOf("[[") + 2 : m[0].indexOf("](") + 2;
    const rawDestination = text.slice(m.index + offset, m.index + offset + captured.length);
    let target = destination(rawDestination, wiki);
    if (target !== destination(captured, wiki)) {
      found.push({ start: m.index, end: m.index + m[0].length, target, invalid: true });
      continue;
    }
    if (!target || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) continue;
    const withoutTitle = rawDestination.trim().replace(/\s+["'][^"']*["']$/, "");
    if (!wiki && (rawDestination.includes("(") || withoutTitle.startsWith("<") && !withoutTitle.endsWith(">") || /\s+["']/.test(withoutTitle))) {
      // Balanced parentheses and incomplete wrappers are outside this bounded
      // scanner. Never connect the truncated prefix captured before the first ')'.
      found.push({ start: m.index, end: m.index + m[0].length, target, invalid: true });
      continue;
    }
    // The shared audit uses '#' as the fragment separator. A literal '#' in a
    // percent-encoded filename cannot be represented there without ambiguity.
    // Keep it for review instead of silently linking a different note.
    const encodedFilenameHash = !wiki && /%23/i.test(target.split("#")[0]), originalTarget = target;
    try {
      if (m[1] === undefined) target = decodeURIComponent(target);
    } catch (_) {
      found.push({
        start: m.index,
        end: m.index + m[0].length,
        target,
        invalid: true,
      });
      continue;
    }
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) continue;
    if (encodedFilenameHash) {
      found.push({ start: m.index, end: m.index + m[0].length, target: originalTarget, invalid: true });
      continue;
    }
    found.push({ start: m.index, end: m.index + m[0].length, target });
  }
  return found;
}
function fragment(text, anchor) {
  if (!anchor || !text) return null;
  const block = anchor.startsWith("^"), masked = maskedContent(text);
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    const visible = masked.slice(match.index, match.index + match[0].length);
    const heading = match[0].match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (
      block
        ? /^\^[A-Za-z0-9-]+$/.test(anchor) && visible.trimEnd().endsWith(anchor) &&
          (visible.trimEnd().length === anchor.length || /[ \t]/.test(visible.trimEnd().at(-anchor.length - 1)))
        : /^ {0,3}#{1,6}[ \t]+/.test(visible) && heading && heading[1].trim() === anchor
    )
      return { start: match.index, end: match.index + match[0].length };
  }
  return null;
}
export async function buildVault(
  entries,
  { repositoryUrl, ref, title = "Obsidian 노트" },
) {
  const repo = new URL(repositoryUrl);
  if (
    repo.protocol !== "https:" ||
    repo.hostname !== "github.com" ||
    repo.username ||
    repo.password ||
    !/^\/[\w.-]+\/[\w.-]+$/.test(repo.pathname) ||
    repo.search ||
    repo.hash ||
    !/^[a-f0-9]{40}$/.test(ref)
  )
    throw problem("invalid_repository");
  const notes = Core.createWorkspace({ title }),
    files = Core.createWorkspace({ title: title + " · 보조 파일" });
  const manifest = {
    format: "haedo-vault-audit-v1",
    repositoryUrl,
    ref,
    files: [],
    unresolvedReferences: [],
    references: {
      resolved: 0,
      missing: 0,
      ambiguous: 0,
      invalid: 0,
      unresolvedAnchors: 0,
    },
  };
  const byPath = new Map(),
    byBase = new Map(),
    seen = new Set();
  for (const entry of entries) {
    const key = entry.path;
    if (
      typeof key !== "string" ||
      key.length > 2000 ||
      key.includes("\\") ||
      key.startsWith("/") ||
      key.split("/").some((p) => !p || [".", "..", ".git"].includes(p)) ||
      /[\u0000-\u001f]/.test(key) ||
      seen.has(key)
    )
      throw problem("invalid_vault_path");
    seen.add(key);
    const bytes = entry.bytes,
      text = decoder.decode(bytes);
    if (text.includes("\0") || bytes.length > Core.MAX_IMPORT_BYTES)
      throw problem("unsupported_vault_file");
    const bundle = /\.md$/i.test(key) ? notes : files,
      time = notes.createdAt;
    const source = {
      id: Core.id(),
      origin: "obsidian",
      title: path.posix.basename(key).replace(/\.md$/i, "").slice(0, 500),
      sourceKey: key,
      url:
        repositoryUrl +
        "/blob/" +
        ref +
        "/" +
        key.split("/").map(encodeURIComponent).join("/"),
      revision: 1,
      createdAt: time,
      updatedAt: time,
    };
    const version = {
      id: Core.id(),
      sourceId: source.id,
      format: bundle === notes ? "text/markdown" : "text/plain",
      contentText: text || null,
      contentHash: text ? digest(bytes) : null,
      coverage: {
        status: text ? "full_text" : "link_only",
        omissions: text ? [] : ["빈 원본 파일 · 본문 바이트 0개"],
      },
      originalAuthor: { label: "", relation: "unknown" },
      originalCreatedAt: null,
      importedAt: time,
      revision: 1,
    };
    bundle.sources.push(source);
    bundle.sourceVersions.push(version);
    manifest.files.push({
      path: key,
      bytes: bytes.length,
      sha256: digest(bytes),
      workspace: bundle === notes ? "notes" : "files",
      sourceId: source.id,
      sourceVersionId: version.id,
    });
    if (bundle === notes) {
      const item = { source, version };
      byPath.set(key, item);
      const base = path.posix.basename(key).replace(/\.md$/i, "");
      const items = byBase.get(base) || [];
      items.push(item);
      byBase.set(base, items);
    }
  }
  function resolve(from, target) {
    if (/[\\\u0000-\u001f]/.test(target)) return { status: "invalid" };
    const hash = target.indexOf("#"),
      anchor = hash < 0 ? "" : target.slice(hash + 1);
    let file = hash < 0 ? target : target.slice(0, hash);
    if (!file) return { status: "resolved", item: byPath.get(from), anchor };
    if (!/\.md$/i.test(file)) file += ".md";
    const candidates = file.startsWith("/")
      ? [file.slice(1)]
      : file.startsWith(".") || !file.includes("/")
        ? [path.posix.join(path.posix.dirname(from), file), file]
        : [file, path.posix.join(path.posix.dirname(from), file)];
    for (const candidate of candidates)
      if (byPath.has(candidate))
        return { status: "resolved", item: byPath.get(candidate), anchor };
    if (!file.includes("/")) {
      const candidates = byBase.get(file.replace(/\.md$/i, "")) || [];
      if (candidates.length === 1)
        return { status: "resolved", item: candidates[0], anchor };
      if (candidates.length > 1) return { status: "ambiguous" };
    }
    return { status: "missing" };
  }
  for (const [key, item] of byPath)
    for (const reference of references(item.version.contentText || "")) {
      const result = reference.invalid
        ? { status: "invalid" }
        : resolve(key, reference.target);
      manifest.references[result.status]++;
      if (result.status !== "resolved") {
        manifest.unresolvedReferences.push({
          path: key,
          target: reference.target,
          locator: { start: reference.start, end: reference.end },
          reason: result.status,
        });
        continue;
      }
      const target = result.item,
        locator = fragment(target.version.contentText, result.anchor);
      if (result.anchor && !locator) {
        manifest.references.unresolvedAnchors++;
        manifest.unresolvedReferences.push({
          path: key,
          target: reference.target,
          targetPath: target.source.sourceKey,
          locator: { start: reference.start, end: reference.end },
          reason: "anchor_missing",
        });
      }
      notes.links.push({
        id: Core.id(),
        kind: "obsidian_link",
        note: reference.target,
        sourceRefs: [
          {
            sourceId: item.source.id,
            sourceVersionId: item.version.id,
            locator: { start: reference.start, end: reference.end },
          },
          {
            sourceId: target.source.id,
            sourceVersionId: target.version.id,
            locator,
          },
        ],
        revision: 1,
        createdAt: notes.createdAt,
        updatedAt: notes.createdAt,
      });
    }
  Core.validateWorkspace(notes);
  Core.validateWorkspace(files);
  const notesBackup = Core.makeBackup(notes),
    filesBackup = Core.makeBackup(files);
  // Verify the same parser, hashes and reference remapping that the app uses.
  const restored = [
    await Core.restoreBackup(notesBackup),
    await Core.restoreBackup(filesBackup),
  ];
  if (
    restored[0].sources.length + restored[1].sources.length !==
    entries.length
  )
    throw problem("vault_count_mismatch");
  return {
    notesBackup,
    filesBackup,
    manifest,
    review: classifyReferences(manifest),
  };
}
