/* A private export ZIP is a transport, never an executable plugin or remote import. */
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./obsidian-decisions.js") : root.ObsidianDecisions,
    typeof module === "object" && module.exports ? require("../../vendor/fflate/fflate.js") : root.fflate,
  );
  root.HaedoLife ||= {}; root.HaedoLife.ObsidianPackage = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (Decisions, zip) {
  "use strict";
  const LIMIT = 256 * 1024 * 1024, FILE_LIMIT = 64 * 1024 * 1024;
  const required = ["notes.json", "supporting-files.json", "private-audit.json", "review.json", "review.html", "repository.bundle"];
  const allowed = [...required, "decisions.json", "applications.json", "review-tool.html"];
  const readable = ["notes.json", "supporting-files.json", "private-audit.json", "review.json"];
  const fail = (message) => { throw Object.assign(new Error(message), { code: "invalid_obsidian_package" }); };
  async function unpack(file, { keepArchive = false } = {}) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 22 || file.size > LIMIT) fail("Obsidian ZIP은 256MiB 이하의 변환 패키지를 선택해 주세요.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > LIMIT) fail("Obsidian ZIP 크기가 너무 큽니다.");
    const seen = new Set(), sizes = new Map(); let total = 0, unpacked;
    try {
      unpacked = zip.unzipSync(bytes, { filter: (entry) => {
        if (!allowed.includes(entry.name) || seen.has(entry.name)) fail("중복되거나 지원하지 않는 ZIP 경로입니다. 변환 결과 ZIP을 선택해 주세요.");
        seen.add(entry.name); total += entry.originalSize;
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > FILE_LIMIT || total > LIMIT) fail("ZIP을 펼친 크기가 제한을 넘었습니다. 원래 패키지를 확인해 주세요.");
        // fflate copies stored entries by compressed size, so their originalSize alone is not a bound.
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > bytes.byteLength ||
          ![0, 8].includes(entry.compression) || (entry.compression === 0 && entry.size !== entry.originalSize)) fail("ZIP 파일의 크기나 압축 정보가 일치하지 않습니다. 원래 패키지를 확인해 주세요.");
        sizes.set(entry.name, entry.originalSize);
        return keepArchive || readable.includes(entry.name);
      } });
    } catch (e) {
      if (e.code === "invalid_obsidian_package") throw e;
      fail("Obsidian ZIP을 읽지 못했습니다. 원래 파일은 그대로 유지됩니다.");
    }
    if (required.some((name) => !seen.has(name))) fail("변환 파일 6개가 담긴 Obsidian ZIP을 선택해 주세요. 일반 보관함 ZIP이나 사진 글 ZIP과 다릅니다.");
    for (const [name, data] of Object.entries(unpacked)) if (data.byteLength !== sizes.get(name)) fail("ZIP에 기록된 크기와 펼친 파일이 일치하지 않습니다. 원래 패키지를 확인해 주세요.");
    return { unpacked, names: [...seen] };
  }
  async function read(file) {
    const { unpacked, names } = await unpack(file);
    const decode = (name) => {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(unpacked[name]); }
      catch (_) { fail("패키지 JSON의 문자 인코딩을 확인해 주세요."); }
    };
    let handle;
    try {
      handle = await Decisions.openPackage({ notes: decode("notes.json"), supporting: decode("supporting-files.json"), audit: decode("private-audit.json"), review: decode("review.json") });
    } catch (_) { fail("원문·해시·경로·검토 목록이 일치하지 않습니다. 같은 변환 결과의 파일을 사용해 주세요."); }
    const copies = await Decisions.restoreCopies(handle);
    return { ...copies, repositoryUrl: handle.binding.repositoryUrl, ref: handle.binding.ref, summary: { notes: copies.notes.sources.length, files: copies.files.sources.length,
      links: copies.notes.links.length, reviewGroups: handle.groups.length, reviewOccurrences: handle.items.length,
      informationalOccurrences: handle.informationalOccurrences }, retainedArchiveFiles: names.filter((name) => !readable.includes(name)) };
  }
  return Object.freeze({ read, unpack, LIMIT, FILE_LIMIT });
});
