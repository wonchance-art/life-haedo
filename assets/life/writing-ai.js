/* AI suggestions for a selection inside the owner's editor (writing-ai-review
 * §6 묶음 B 단계 1·2, approved 2026-11-04). Device-side half of the haedo-ai
 * Edge function; no screen is connected yet (docs/design-review/writing-ai-suggestions.md).
 *
 * - Nothing is sent unless the caller calls send(). prepare() only builds the
 *   exact request text; its preview is parsed from that same text, so what the
 *   owner sees is byte for byte what is sent.
 * - Only the allow-listed fields leave the device: task, selected text, the
 *   owner's AI guidance, a direct request sentence and, for questions, chosen
 *   excerpts. Never IDs, e-mail, photos or the whole document.
 * - A result that arrives after the account, post or screen changed is
 *   discarded (isCurrent(token) is false).
 * - apply() (on the instance) first checks isCurrent(token), so a suggestion
 *   is never applied to another account, post or screen; it then replaces only the accepted ranges, marks only their new text with
 *   the private authorship attribute author:"ai" (묶음 A), keeps photos and other
 *   formats, and refuses while a Korean IME composition is open or when the
 *   selected text changed since the request.
 * - A citation is shown as a quote only when its text occurs exactly in the
 *   excerpt that was sent; otherwise it is "출처 미확인" and carries no quote. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).WritingAI = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (root) {
  "use strict";
  // Same limits as supabase/functions/haedo-ai/handler.mjs (UTF-16 code units).
  const LIMITS = Object.freeze({ selection: 4000, guidance: 2000, instruction: 500, sources: 6, sourcesTotal: 8000 });
  const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5";
  const TASKS = Object.freeze({
    polish: Object.freeze({ label: "다듬기", model: HAIKU, selection: "required", instruction: "forbidden", sources: "forbidden" }),
    shorten: Object.freeze({ label: "줄이기", model: HAIKU, selection: "required", instruction: "forbidden", sources: "forbidden" }),
    continue: Object.freeze({ label: "이어 쓰기", model: HAIKU, selection: "required", instruction: "forbidden", sources: "forbidden" }),
    custom: Object.freeze({ label: "직접 요청", model: HAIKU, selection: "required", instruction: "required", sources: "forbidden" }),
    ask: Object.freeze({ label: "자료에 묻기", model: SONNET, selection: "optional", instruction: "required", sources: "required" }),
    outline: Object.freeze({ label: "개요 제안", model: SONNET, selection: "optional", instruction: "optional", sources: "required" }),
  });
  const PROVIDER = Object.freeze({ name: "Anthropic", endpoint: "functions/v1/haedo-ai" });
  const INPUT_KEYS = ["task", "selectionText", "guidance", "instruction", "sources"];
  const MESSAGES = Object.freeze({
    ai_invalid_task: "지원하지 않는 AI 작업입니다.",
    ai_field_not_allowed: "AI에 보낼 수 없는 항목이 있어요.",
    ai_selection_required: "AI에 보낼 글을 선택해 주세요.",
    ai_selection_not_allowed: "이 작업에는 선택한 글을 보내지 않아요.",
    ai_selection_too_long: "선택한 글은 4,000자까지 보낼 수 있어요.",
    ai_guidance_too_long: "AI 지침은 2,000자까지 보낼 수 있어요.",
    ai_instruction_required: "요청 문장을 적어 주세요.",
    ai_instruction_not_allowed: "이 작업에는 요청 문장을 보내지 않아요.",
    ai_instruction_too_long: "요청 문장은 500자까지 보낼 수 있어요.",
    ai_sources_required: "질문할 자료 발췌를 골라 주세요.",
    ai_sources_not_allowed: "이 작업에는 자료 발췌를 보내지 않아요.",
    ai_sources_too_many: "자료 발췌는 6개까지 보낼 수 있어요.",
    ai_sources_too_long: "자료 발췌는 모두 합쳐 8,000자까지 보낼 수 있어요.",
    ai_text_invalid: "보낼 글에 읽을 수 없는 문자가 있어요.",
    ai_not_prepared: "보낼 내용을 다시 준비해 주세요.",
    ai_not_current: "다른 글이나 계정으로 바뀌어 보내지 않았어요.",
    ai_network: "연결을 확인한 뒤 다시 시도해 주세요.",
    invalid_request: "AI에 보낼 내용을 확인해 주세요.",
    unauthorized: "다시 로그인한 뒤 시도해 주세요.",
    ai_not_allowed: "이 계정에서는 AI 제안을 쓸 수 없어요.",
    origin_not_allowed: "이 주소에서는 AI 제안을 쓸 수 없어요.",
    ai_not_current_apply: "다른 글이나 계정으로 바뀌어 제안을 적용하지 않았어요.",
    setup_required: "AI 제안이 아직 설정되지 않았어요.",
    ai_not_configured: "AI 제안이 아직 설정되지 않았어요.",
    ai_monthly_limit: "이번 달 AI 사용 한도에 도달했어요. 다음 달 1일(UTC)부터 다시 쓸 수 있어요.",
    duplicate_request: "같은 요청을 이미 보냈어요.",
    ai_busy: "AI 요청이 몰려 있어요. 잠시 뒤 다시 시도해 주세요.",
    ai_refused: "AI가 이 요청에는 답하지 않았어요.",
    ai_max_tokens: "응답이 길어 끝까지 받지 못했어요. 선택을 줄여 다시 시도해 주세요.",
    ai_invalid_response: "AI 응답을 읽지 못했어요. 다시 시도해 주세요.",
    ai_upstream_error: "AI 제공처에 연결하지 못했어요. 다시 시도해 주세요.",
    server_error: "AI 요청을 처리하지 못했어요. 다시 시도해 주세요.",
    ai_composing: "한글 입력이 끝난 뒤 적용해 주세요.",
    ai_selection_changed: "선택한 글이 바뀌어 제안을 적용하지 않았어요.",
    ai_selection_has_photo: "사진이 들어 있는 선택에는 제안을 적용할 수 없어요.",
    ai_invalid_ranges: "적용할 제안 구간을 확인해 주세요.",
    ai_invalid_document: "본문 형식을 확인해 주세요.",
  });
  const UNVERIFIED = "출처 미확인";
  const fault = (code) => Object.assign(new Error(MESSAGES[code] || code), { code });
  const check = (ok, code) => { if (!ok) throw fault(code); };
  const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const wellFormed = (value) => !value.includes("\u0000") && !LONE_SURROGATE.test(value);
  const filled = (value) => typeof value === "string" && value.trim().length > 0;
  const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const utf8 = (text) => new TextEncoder().encode(text).length;

  /* The request object in a fixed key order. Empty optional fields are left
   * out (an empty guidance means "AI 지침 꺼짐"). */
  function requestBody(input, requestId) {
    check(plain(input), "ai_field_not_allowed");
    check(Object.keys(input).every((key) => INPUT_KEYS.includes(key)), "ai_field_not_allowed");
    check(typeof input.task === "string" && Object.hasOwn(TASKS, input.task), "ai_invalid_task");
    const spec = TASKS[input.task], out = { requestId, task: input.task };
    const selection = input.selectionText ?? "", guidance = input.guidance ?? "", instruction = input.instruction ?? "";
    for (const value of [selection, guidance, instruction]) check(typeof value === "string", "ai_field_not_allowed");
    for (const value of [selection, guidance, instruction]) check(wellFormed(value), "ai_text_invalid");
    if (filled(selection)) {
      check(spec.selection !== "forbidden", "ai_selection_not_allowed");
      check(selection.length <= LIMITS.selection, "ai_selection_too_long");
      out.selection = selection;
    } else check(spec.selection !== "required", "ai_selection_required");
    if (filled(guidance)) { check(guidance.length <= LIMITS.guidance, "ai_guidance_too_long"); out.guidance = guidance; }
    if (filled(instruction)) {
      check(spec.instruction !== "forbidden", "ai_instruction_not_allowed");
      check(instruction.length <= LIMITS.instruction, "ai_instruction_too_long");
      out.instruction = instruction;
    } else check(spec.instruction !== "required", "ai_instruction_required");
    const sources = input.sources ?? [];
    check(Array.isArray(sources) && sources.every((value) => typeof value === "string"), "ai_field_not_allowed");
    if (sources.length) {
      check(spec.sources !== "forbidden", "ai_sources_not_allowed");
      check(sources.length <= LIMITS.sources, "ai_sources_too_many");
      check(sources.every(filled), "ai_sources_required");
      check(sources.every(wellFormed), "ai_text_invalid");
      check(sources.reduce((sum, value) => sum + value.length, 0) <= LIMITS.sourcesTotal, "ai_sources_too_long");
      out.sources = [...sources];
    } else check(spec.sources !== "required", "ai_sources_required");
    return out;
  }

  /* Word-level difference between the sent selection and the replacement.
   * Ranges are UTF-16 offsets in `original`: [start,end) is replaced by
   * `insert`. Tokens are runs of letters/digits, runs of spaces, or single
   * other characters (whole code points). */
  const TOKEN = /\s+|[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu;
  const tokens = (text) => text.match(TOKEN) || [];
  function diff(original, replacement) {
    check(typeof original === "string" && typeof replacement === "string", "ai_invalid_ranges");
    const a = tokens(original), b = tokens(replacement);
    let head = 0; while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0; while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail), steps = [];
    if (x.length * y.length <= 2000000) {
      // Longest common subsequence on the differing middle.
      const width = y.length + 1, table = new Uint32Array((x.length + 1) * width);
      for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
        table[i * width + j] = x[i] === y[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      let i = 0, j = 0;
      while (i < x.length || j < y.length) {
        if (i < x.length && j < y.length && x[i] === y[j]) { steps.push(["=", x[i]]); i++; j++; }
        else if (j < y.length && (i === x.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { steps.push(["+", y[j]]); j++; }
        else { steps.push(["-", x[i]]); i++; }
      }
    } else { x.forEach((t) => steps.push(["-", t])); y.forEach((t) => steps.push(["+", t])); }
    const ranges = [];
    let at = a.slice(0, head).join("").length, open = null;
    for (const [kind, token] of steps) {
      if (kind === "=") { if (open) { ranges.push(open); open = null; } at += token.length; continue; }
      open ||= { start: at, end: at, insert: "" };
      if (kind === "-") { at += token.length; open.end = at; } else open.insert += token;
    }
    if (open) ranges.push(open);
    return ranges.map((range, index) => Object.freeze({ id: "r" + index, start: range.start, end: range.end,
      before: original.slice(range.start, range.end), insert: range.insert }));
  }

  /* A quote is "quoted" only if its exact text occurs in the excerpt with that
   * index (at least two non-space characters). Everything else is downgraded
   * to "출처 미확인" and its quote text is dropped so it cannot be shown. */
  function verifyCitations(sources, citations) {
    if (!Array.isArray(citations)) return [];
    const list = Array.isArray(sources) ? sources : [];
    return citations.map((citation) => {
      const index = plain(citation) && Number.isSafeInteger(citation.sourceIndex) && citation.sourceIndex >= 0 &&
        citation.sourceIndex < list.length && typeof list[citation.sourceIndex] === "string" ? citation.sourceIndex : null;
      const quote = plain(citation) && typeof citation.quote === "string" ? citation.quote : "";
      const start = index !== null && quote.replace(/\s/g, "").length >= 2 ? list[index].indexOf(quote) : -1;
      if (start < 0) return Object.freeze({ status: "unverified", label: UNVERIFIED, sourceIndex: index });
      return Object.freeze({ status: "quoted", sourceIndex: index, quote, start, end: start + quote.length });
    });
  }

  // Inline formats an AI replacement may inherit. Links and authorship are not inherited.
  const INHERIT = ["bold", "italic", "underline"];
  const sameAttributes = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
  const sorted = (value) => value ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : null;
  function normalize(ops) {
    const out = [];
    for (const op of ops) {
      if (typeof op.insert === "string" && !op.insert.length) continue;
      const last = out.at(-1);
      if (last && typeof last.insert === "string" && typeof op.insert === "string" && sameAttributes(last.attributes, op.attributes)) last.insert += op.insert;
      else out.push(op.attributes && Object.keys(op.attributes).length ? { insert: op.insert, attributes: { ...op.attributes } } : { insert: op.insert });
    }
    return out;
  }
  function aiText(text, inherited) {
    // Newlines inside an AI insert start plain paragraphs and carry no mark.
    const attributes = { ...inherited, author: "ai" };
    return text.split(/(\n)/).filter(Boolean).map((part) => part === "\n" ? { insert: "\n" } : { insert: part, attributes: { ...attributes } });
  }

  /* Replace the accepted ranges of the selection [index, index+length) in a
   * Quill Delta document (array of {insert, attributes?}). `original` is the
   * selection text the suggestion was made from; the current text there must
   * still be exactly that. Returns { ops, applied, selection } with new ops. */
  function applyRanges(ops, { index, length, original, ranges, accepted, composing = false } = {}) {
    check(composing === false, "ai_composing");
    check(Array.isArray(ops) && ops.length > 0 && ops.every((op) => plain(op) && Object.hasOwn(op, "insert") &&
      (typeof op.insert === "string" || plain(op.insert)) && (op.attributes === undefined || plain(op.attributes))), "ai_invalid_document");
    const total = ops.reduce((sum, op) => sum + (typeof op.insert === "string" ? op.insert.length : 1), 0);
    check(Number.isSafeInteger(index) && Number.isSafeInteger(length) && index >= 0 && length >= 0 && index + length <= total - 1 &&
      typeof original === "string" && original.length === length, "ai_selection_changed");
    check(Array.isArray(ranges), "ai_invalid_ranges");
    const chosen = new Set(accepted instanceof Set ? accepted : Array.isArray(accepted) ? accepted : []);
    let previous = 0;
    for (const range of ranges) {
      check(plain(range), "ai_invalid_ranges");
      check(typeof range.id === "string" && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
        range.start >= previous && range.end >= range.start && range.end <= original.length && typeof range.insert === "string" &&
        range.before === original.slice(range.start, range.end) && wellFormed(range.insert), "ai_invalid_ranges");
      previous = range.end;
    }
    check([...chosen].every((id) => ranges.some((range) => range.id === id)), "ai_invalid_ranges");
    // Split the document into: before the selection, the selection (text only), after it.
    const before = [], inside = [], after = [];
    let at = 0;
    for (const op of ops) {
      const size = typeof op.insert === "string" ? op.insert.length : 1;
      const piece = (from, to) => typeof op.insert === "string"
        ? { insert: op.insert.slice(from, to), ...(op.attributes ? { attributes: { ...op.attributes } } : {}) }
        : structuredCloneSafe(op);
      const startCut = Math.max(0, Math.min(size, index - at)), endCut = Math.max(0, Math.min(size, index + length - at));
      if (startCut > 0) before.push(piece(0, startCut));
      if (endCut > startCut) {
        check(typeof op.insert === "string", "ai_selection_has_photo");
        inside.push(piece(startCut, endCut));
      }
      if (endCut < size) after.push(piece(endCut, size));
      at += size;
    }
    check(inside.map((op) => op.insert).join("") === original, "ai_selection_changed");
    if (!chosen.size) return { ops: normalize([...before, ...inside, ...after]), applied: 0, selection: { index, length } };
    // Attributes for each selection character, and the character just before the selection.
    const charAttributes = [];
    for (const op of inside) for (let i = 0; i < op.insert.length; i++) charAttributes.push(op.attributes || null);
    const lastBefore = before.length && typeof before.at(-1).insert === "string" && !before.at(-1).insert.endsWith("\n") ? before.at(-1).attributes || null : null;
    const inheritAt = (position) => {
      const source = position < charAttributes.length && original[position] !== "\n" ? charAttributes[position]
        : position > 0 && original[position - 1] !== "\n" ? charAttributes[position - 1] : position === 0 ? lastBefore : null;
      return Object.fromEntries(INHERIT.filter((key) => source?.[key] === true).map((key) => [key, true]));
    };
    const rebuilt = [];
    const keep = (from, to) => {
      let cursor = 0;
      for (const op of inside) {
        const s = Math.max(from, cursor), e = Math.min(to, cursor + op.insert.length);
        if (e > s) rebuilt.push({ insert: op.insert.slice(s - cursor, e - cursor), ...(op.attributes ? { attributes: { ...op.attributes } } : {}) });
        cursor += op.insert.length;
      }
    };
    let cursor = 0, applied = 0, newLength = 0;
    for (const range of ranges) {
      if (!chosen.has(range.id)) continue;
      keep(cursor, range.start);
      rebuilt.push(...aiText(range.insert, inheritAt(range.start)));
      newLength += range.start - cursor + range.insert.length;
      cursor = range.end; applied++;
    }
    keep(cursor, original.length);
    newLength += original.length - cursor;
    return { ops: normalize([...before, ...rebuilt, ...after]), applied, selection: { index, length: newLength } };
  }
  const structuredCloneSafe = (value) => JSON.parse(JSON.stringify(value));

  /* The device's network call: POST the prepared text unchanged to the
   * haedo-ai function with the signed-in session token. */
  function remoteRequest({ projectUrl, publicKey, accessToken, fetcher = root.fetch?.bind(root) } = {}) {
    const url = new URL(PROVIDER.endpoint, String(projectUrl).replace(/\/?$/, "/")).href;
    return async ({ body, signal }) => {
      const token = await accessToken();
      check(typeof token === "string" && token.length > 0, "unauthorized");
      let response;
      try {
        response = await fetcher(url, { method: "POST", body, signal, cache: "no-store", credentials: "omit", redirect: "error",
          headers: { apikey: publicKey, Authorization: "Bearer " + token, "Content-Type": "application/json" } });
      } catch (_) { throw fault("ai_network"); }
      try { return await response.json(); } catch (_) { throw fault("ai_invalid_response"); }
    };
  }

  // isCurrent is required: a screen that forgot it must not silently turn the target check off.
  function create({ request, isCurrent, newId = () => root.crypto.randomUUID() } = {}) {
    check(typeof request === "function", "ai_not_prepared");
    check(typeof isCurrent === "function", "ai_not_prepared");
    const issued = new WeakSet(), sent = new WeakMap();
    function prepare(input) {
      const requestId = newId();
      const text = JSON.stringify(requestBody(input, requestId));
      const preview = freeze(JSON.parse(text));
      const prepared = Object.freeze({ requestId, task: preview.task, label: TASKS[preview.task].label, provider: PROVIDER.name,
        model: TASKS[preview.task].model, text, bytes: utf8(text), preview });
      issued.add(prepared);
      return prepared;
    }
    function result(prepared, response) {
      if (plain(response) && typeof response.error === "string")
        return { status: "error", code: Object.hasOwn(MESSAGES, response.error) ? response.error : "server_error", message: MESSAGES[response.error] || MESSAGES.server_error };
      const sourced = TASKS[prepared.task].sources !== "forbidden";
      if (!plain(response) || response.status !== "ok" || response.requestId !== prepared.requestId || response.task !== prepared.task ||
        typeof response.suggestion !== "string" || typeof response.reason !== "string" || !wellFormed(response.suggestion) ||
        (sourced && !Array.isArray(response.citations)))
        return { status: "error", code: "ai_invalid_response", message: MESSAGES.ai_invalid_response };
      const original = prepared.preview.selection ?? "";
      const replacement = prepared.task === "continue" ? original + response.suggestion : response.suggestion;
      return { status: "ok", requestId: prepared.requestId, task: prepared.task, suggestion: response.suggestion, reason: response.reason,
        original, replacement, ranges: diff(original, replacement),
        citations: sourced ? verifyCitations(prepared.preview.sources, response.citations) : [],
        remainingMicroUsd: Number.isSafeInteger(response.usage?.remainingMicroUsd) ? response.usage.remainingMicroUsd : null };
    }
    /* Explicit call only. `token` identifies where the result belongs (account,
     * post, screen); a result is used only while isCurrent(token) is true.
     * Sending the same prepared object again returns the first request's
     * promise (a double tap makes one request). */
    function send(prepared, { token, signal } = {}) {
      if (!issued.has(prepared)) return Promise.resolve({ status: "error", code: "ai_not_prepared", message: MESSAGES.ai_not_prepared });
      if (sent.has(prepared)) return sent.get(prepared);
      if (!isCurrent(token)) return Promise.resolve({ status: "discarded", code: "ai_not_current", message: MESSAGES.ai_not_current });
      const run = (async () => {
        let response;
        try { response = await request({ body: prepared.text, requestId: prepared.requestId, signal }); }
        catch (error) {
          if (!isCurrent(token)) return { status: "discarded", code: "ai_not_current" };
          const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "ai_network";
          return { status: "error", code, message: MESSAGES[code] };
        }
        if (!isCurrent(token)) return { status: "discarded", code: "ai_not_current" };
        return result(prepared, response);
      })();
      sent.set(prepared, run);
      return run;
    }
    /* Apply accepted ranges of a result to the editor's current ops. `token`
     * names the editor target now on screen; if it is no longer current
     * (account, post or screen changed) nothing is applied. */
    function apply(ops, { token, ...options } = {}) {
      check(isCurrent(token), "ai_not_current_apply");
      return applyRanges(ops, options);
    }
    return Object.freeze({ prepare, send, apply });
  }

  return Object.freeze({ LIMITS, TASKS, PROVIDER, MESSAGES, UNVERIFIED, create, requestBody, diff, verifyCitations, remoteRequest });
});
