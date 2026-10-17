/* Data-only audit projection. Classifying a reference never rewrites or connects it. */
import path from "node:path";
import { createHash } from "node:crypto";
export const CATEGORIES = Object.freeze({
  missing_note: "노트 경로 확인",
  ambiguous: "동명 노트 선택",
  anchor_missing: "제목·블록 위치 확인",
  invalid: "링크 형식 확인",
  attachment_missing: "원본에 없는 첨부",
  supporting_file: "보조 작업공간에 보관됨",
  external_relative: "외부 사이트 상대 주소",
});
const manual = new Set([
  "missing_note",
  "ambiguous",
  "anchor_missing",
  "invalid",
]);
const byKey = (values, key) => {
  const result = new Map();
  for (const value of values) {
    const k = key(value),
      items = result.get(k) || [];
    items.push(value);
    result.set(k, items);
  }
  return result;
};
function filePart(target) {
  return target.split("#")[0];
}
function requestedPaths(source, target) {
  const file = filePart(target);
  if (!file) return [source];
  const names = [file];
  if (!/\.md$/i.test(file)) names.push(file + ".md");
  return [
    ...new Set(
      names.flatMap((name) =>
        name.startsWith("/")
          ? [name.slice(1)]
          : name.startsWith(".") || !name.includes("/")
            ? [path.posix.join(path.posix.dirname(source), name), name]
            : [name, path.posix.join(path.posix.dirname(source), name)],
      ),
    ),
  ];
}
export function classifyReferences(manifest) {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const notes = manifest.files.filter((file) => file.workspace === "notes");
  const basenames = byKey(notes, (file) =>
    path.posix.basename(file.path).replace(/\.md$/i, ""),
  );
  const rows = [],
    groups = new Map(),
    counts = Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, 0]));
  for (const ref of manifest.unresolvedReferences) {
    const requested = requestedPaths(ref.path, ref.target);
    const saved = requested
      .map((key) => files.get(key))
      .find((file) => file && file.workspace !== "notes");
    let category;
    if (ref.reason !== "missing")
      category = Object.hasOwn(CATEGORIES, ref.reason) ? ref.reason : "invalid";
    else if (saved) category = "supporting_file";
    else if (
      /^\/(?:PostList|PostView)\.naver(?:\?|$)/i.test(filePart(ref.target))
    )
      category = "external_relative";
    // Some original exports nest a Wikilink inside a Markdown destination.
    // Recognize the attachment kind for reporting only; keep its raw token intact.
    else if (
      /\.(?:pdf|csv|png|jpe?g|heic|gif|webp|avif|svg|mp3|mp4|mov|wav|zip)(?:\]\])?$/i.test(
        filePart(ref.target),
      )
    )
      category = "attachment_missing";
    else category = "missing_note";
    const candidatePaths =
      manual.has(category) && category !== "anchor_missing"
        ? (
            basenames.get(
              path.posix.basename(filePart(ref.target)).replace(/\.md$/i, ""),
            ) || []
          )
            .map((file) => file.path)
            .sort()
        : [];
    const row = {
      ...ref,
      category,
      reviewRequired: manual.has(category),
      requestedPaths: requested,
      candidatePaths,
      ...(saved ? { savedPath: saved.path } : {}),
    };
    rows.push(row);
    counts[category]++;
    if (!row.reviewRequired) continue;
    // Relative references and self anchors depend on their origin. Never merge
    // separate destinations just because their displayed target is the same.
    const context = /^(?:\.\.?\/|#)/.test(ref.target)
      ? requested
      : ref.targetPath || null;
    const key = JSON.stringify([category, ref.target, context, candidatePaths]);
    let group = groups.get(key);
    if (!group) {
      group = {
        id: createHash("sha256").update(key).digest("hex").slice(0, 20),
        category,
        target: ref.target,
        ...(ref.targetPath ? { targetPath: ref.targetPath } : {}),
        candidatePaths,
        occurrences: [],
      };
      groups.set(key, group);
    }
    group.occurrences.push({
      path: ref.path,
      locator: { ...ref.locator },
      requestedPaths: requested,
    });
  }
  const reviewOccurrences = rows.filter((row) => row.reviewRequired).length;
  return {
    format: "haedo-vault-review-v1",
    repositoryUrl: manifest.repositoryUrl,
    ref: manifest.ref,
    summary: {
      unresolvedOccurrences: rows.length,
      unresolvedTargets: new Set(rows.map((row) => row.target)).size,
      reviewOccurrences,
      reviewGroups: groups.size,
      informationalOccurrences: rows.length - reviewOccurrences,
      categories: counts,
    },
    groups: [...groups.values()],
    informational: rows.filter((row) => !row.reviewRequired),
  };
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
function occurrenceList(group) {
  return [...byKey(group.occurrences, (row) => row.path)]
    .map(
      ([source, occurrences]) =>
        `<li>${escape(source)}<span class="meta"> · ${occurrences.length}회 참조</span></li>`,
    )
    .join("");
}
export function renderReviewHTML(review) {
  const { summary } = review;
  const intro = `<h1>노트 연결 검토</h1><p>판단할 노트 <strong>${summary.reviewGroups}개 묶음</strong> · ${summary.reviewOccurrences}회 참조</p><p>원본에 없는 첨부·외부 상대 주소·보관된 보조 파일 ${summary.informationalOccurrences}회는 아래 보관 정보로 구분했습니다. 경로 후보는 제안이며 자동 연결하지 않습니다.</p>`;
  const counts =
    '<table><caption>미확정 참조의 사유</caption><thead><tr><th scope="col">사유</th><th scope="col">참조 횟수</th></tr></thead><tbody>' +
    Object.entries(summary.categories)
      .filter(([, count]) => count)
      .map(
        ([key, count]) =>
          `<tr><th scope="row">${CATEGORIES[key]}</th><td>${count}</td></tr>`,
      )
      .join("") +
    "</tbody></table>";
  const groups = review.groups
    .map(
      (group) =>
        `<details><summary>${escape(group.target)} · ${CATEGORIES[group.category]} · ${group.occurrences.length}회</summary><p>${group.category === "anchor_missing" ? "연결된 노트는 확인했습니다. 지정한 제목·블록 위치를 확인하세요." : group.candidatePaths.length ? "동일한 파일명으로 찾은 후보입니다. 원래 경로와 내용을 확인하세요." : "확정할 수 있는 파일 후보가 없습니다. 원본 링크와 경로를 확인하세요."}</p>${group.targetPath ? "<p>확인한 노트: " + escape(group.targetPath) + "</p>" : ""}${group.candidatePaths.length ? "<ul>" + group.candidatePaths.map((candidate) => `<li>${escape(candidate)}</li>`).join("") + "</ul>" : ""}<h3>참조한 노트</h3><ul>${occurrenceList(group)}</ul></details>`,
    )
    .join("");
  const info = Object.keys(CATEGORIES)
    .filter((key) => !manual.has(key) && summary.categories[key])
    .map(
      (key) =>
        `<details><summary>${CATEGORIES[key]} · ${summary.categories[key]}회</summary><ul>${review.informational
          .filter((row) => row.category === key)
          .map(
            (row) =>
              `<li>${escape(row.target)}<p class="meta">참조: ${escape(row.path)}${row.savedPath ? "<br>보관: " + escape(row.savedPath) : ""}</p></li>`,
          )
          .join("")}</ul></details>`,
    )
    .join("");
  return (
    '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>노트 연결 검토</title><style>*{box-sizing:border-box}body{margin:0;color:#262330;background:#fff;font:17px/1.8 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:900px;margin:auto;padding:32px 20px;overflow-wrap:anywhere}h1{font-size:28px}h2{margin-top:40px;font-size:22px}h3{font-size:17px}details{padding:12px 0;border-block-end:1px solid #dedce5}summary{cursor:pointer;min-height:44px;padding:8px 0}li{margin-block:12px}table{width:100%;border-collapse:collapse;margin-block:24px}caption{text-align:left;font-weight:600}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #dedce5}.meta{font-size:14px;color:#665e70}ul{padding-left:24px}@media print{details{break-inside:avoid}}</style></head><body><main>' +
    intro +
    counts +
    "<h2>판단할 노트</h2>" +
    groups +
    "<h2>첨부·외부 주소·보관 정보</h2>" +
    info +
    "</main></body></html>"
  );
}
