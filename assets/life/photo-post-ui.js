(function (root) {
  "use strict";
  const life = root.HaedoLife,
    M = life.PhotoPost;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const Embed = root.Quill.import("blots/block/embed");
  const Delta = root.Quill.import("delta");
  // Retain patches let captions participate in Quill history without replacing
  // the figure or the focused input. The persisted document still uses inserts.
  Delta.registerEmbed("photo", {
    compose: (base, change) => ({ ...base, ...change }),
    invert: (change, base) =>
      Object.fromEntries(Object.keys(change).map((key) => [key, base[key]])),
    transform: (a, b, priority) =>
      priority
        ? Object.fromEntries(
            Object.entries(b).filter(([key]) => !Object.hasOwn(a, key)),
          )
        : b,
  });
  const photoSources = new Map();
  class Photo extends Embed {
    static blotName = "photo";
    static tagName = "figure";
    static className = "photo-block";
    static create(v) {
      const n = super.create();
      n.dataset.photoId = v.id;
      n.dataset.alt = v.alt || "";
      n.dataset.caption = v.caption || "";
      n.setAttribute("contenteditable", "false");
      n.setAttribute("role", "group");
      n.setAttribute(
        "aria-label",
        (v.caption || v.alt || "사진") + " · 사진 설명·순서 편집",
      );
      n.tabIndex = -1;
      const img = el("img");
      img.alt = v.alt || v.caption || "첨부 사진";
      const src = v.src || photoSources.get(v.id);
      if (src) img.src = src;
      const select = el("button", null, "photo-select");
      select.type = "button";
      select.setAttribute("aria-label", "사진 설명·순서 편집");
      select.append(img);
      const caption = el("figcaption"),
        add = el("button", v.caption || "사진 설명 추가", "photo-caption-text");
      add.type = "button";
      add.setAttribute("aria-label", "사진 설명 편집");
      caption.append(add);
      n.append(select, caption);
      return n;
    }
    updateContent(change) {
      const n = this.domNode,
        value = { ...Photo.value(n), ...change };
      n.dataset.caption = value.caption;
      n.dataset.alt = value.alt;
      n.querySelector("img").alt = value.alt || value.caption || "첨부 사진";
      n.setAttribute(
        "aria-label",
        (value.caption || value.alt || "사진") + " · 사진 설명·순서 편집",
      );
      n.querySelector(".photo-caption-text").textContent =
        value.caption || "사진 설명 추가";
      for (const [name, text] of [
        ["사진 설명", value.caption],
        ["사진 대체 텍스트", value.alt],
      ]) {
        const input = n.querySelector('[aria-label="' + name + '"]');
        if (input && input.value !== text) input.value = text;
      }
    }
    static value(n) {
      return {
        id: n.dataset.photoId,
        alt: n.dataset.alt || "",
        caption: n.dataset.caption || "",
      };
    }
  }
  root.Quill.register(Photo, true);
  // Private authorship mark: text the owner brought from an AI tool. Stored as
  // the Delta attribute `author: "ai"` on text only; public copies drop it.
  const Inline = root.Quill.import("blots/inline");
  class Author extends Inline {
    static blotName = "author";
    static tagName = "span";
    static className = "photo-ai-text";
    static create() {
      const n = super.create();
      n.dataset.author = "ai";
      return n;
    }
    static formats(n) {
      return n.dataset?.author === "ai" ? "ai" : undefined;
    }
  }
  root.Quill.register(Author, true);
  // Fits the one-line status at 320px (108px); the full sentence is announced.
  const AI_PENDING = "AI 붙여넣기 대기";
  const AI_PENDING_DETAIL = " · 다음 붙여넣기 한 번을 AI 글로 표시합니다. AI 글 표시 버튼을 다시 누르면 취소합니다.";
  // 2026-11-04 D1 (soft redesign): a post's date reads "11월 2일 월요일 09:12";
  // another year adds the year. Local calendar, like the home feed.
  function when(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "";
    const day = new Intl.DateTimeFormat("ko-KR", {
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
      month: "long", day: "numeric", weekday: "long",
    }).format(date);
    const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    return day + " " + clock;
  }
  // Two steps (2026-11-02 decision 4): this device saved, then the account.
  // Read-only projections of BlogSync's statusOf; never "all devices".
  const SERVER_LABELS = {
    checking: "저장됨 · 계정 확인 중",
    saving: "저장됨 · 계정에 올리는 중",
    synced: "저장됨 · 계정에 올림",
    not_enabled: "저장됨 · 계정에 올리기 대기",
    pending: "저장됨 · 계정에 올리기 대기",
    paused: "저장됨 · 계정에 올리기 대기",
    conflict: "다른 기기 변경을 맞추는 중 · 진 쪽은 복구 사본으로 남김",
    error: "저장됨 · 계정에 올리지 못함",
    // An older page mixed with newer modules (no SyncCommon) has no blog engine until reloaded.
    refresh: "저장됨 · 앱을 새로고침하면 계정에 올림",
  };
  // Only a problem reaches the privacy pill; normal states stay quiet.
  const PILL_PROBLEMS = { error: "올리기 실패", refresh: "새로고침 필요", conflict: "맞추는 중" };
  function create({
    storage,
    workspaceId,
    isCurrent,
    blogSync = null,
    onManageServer = null,
    onPreservePost = null,
    onDirty = () => {},
    onSaved = () => {},
    onCommitted = () => {},
    onReturn = null,
    onModeChange = () => {},
    beforeOpen = async () => {},
  }) {
    let host = null,
      doc = null,
      mode = "list",
      editor = null,
      dirtyTick = 0,
      storedTick = 0,
      saving = null,
      timer = null,
      maxTimer = null,
      checkpointing = null,
      epoch = 0,
      busy = false,
      // busy only because the next post or list is being read (no user input at stake).
      loading = false,
      navigating = false,
      composing = false,
      error = null,
      selected = null,
      unsubscribe = null,
      disposed = false,
      feedListener = null,
      coverObserver = null,
      feedHost = null,
      feedControls = [],
      controls = [],
      attachmentUI = null,
      readBackAction = null,
      readBackText = "사진 글 목록",
      committed = false,
      standalone = false;
    // Storing a draft and judging a post are separate (2026-11-11). Autosave
    // writes the normalized document and never refuses the editor's input; when
    // no valid form exists (over a limit) the input is kept in a device-only
    // recovery copy instead. keptTick is the dirtyTick that copy holds and
    // `unstored` the reason shown until the draft can be stored again. `offer`
    // is a recovery copy found on opening, waiting for the writer's choice.
    let keptTick = -1,
      unstored = null,
      offer = null,
      noteHold = 0,
      titleInput = null,
      // A revision of a saved post is that post's editing buffer (2026-11-11):
      // nothing is stored until the first real change, and a buffer that holds
      // what the post holds is removed on leaving. `baseline` is the saved
      // post's content when the revision was opened.
      baseline = null;
    const localStore = (() => { try { return root.localStorage || null; } catch (_) { return null; } })();
    const recoveryStore = M.recovery(localStore);
    const settled = () => dirtyTick === storedTick || dirtyTick === keptTick;
    function resetTicks(dirty = 0) {
      dirtyTick = dirty;
      storedTick = 0;
      keptTick = -1;
      unstored = null;
    }
    // AI authorship: a one-shot "next paste is AI text" state, a short status
    // note, and owner-typed ranges that inherited the mark and must lose it
    // once no IME composition is active.
    let aiPending = false,
      authorNote = "",
      // A note about a state change with no edit (Esc, nothing selected) is
      // not cleared by the save of earlier edits; the next edit clears it.
      authorNoteKept = false,
      aiInserting = false,
      humanRanges = [],
      settleQueued = false,
      authorButton = null;
    let status, statusText, statusDetail, inspector, captionInput, altInput, recoveryActions;
    let dismissControls = null;
    // D1: the privacy pill opens 글 정보 (visibility, date, save state).
    let pill = null, info = null, refreshInfo = null, releaseViewport = null;
    let serverStatus = null, serverActions = null, serverValue = null, serverBusy = false, serverSequence = 0;
    let unsubscribeServer = null;
    const urls = new Set(),
      photoUrls = new Map();
    // Feed covers can be handed to listHost, outside host, and stay on screen
    // while a post is read or edited. They belong to the list that created
    // them: url -> image. A newer delivered list or detach() retires them.
    let feedCovers = new Map();
    let closeViewer = null;
    const valid = () => !disposed && isCurrent(),
      current = (t) => valid() && t === epoch && !!host?.isConnected;
    const url = (blob) => {
      const u = URL.createObjectURL(blob);
      urls.add(u);
      return u;
    };
    // HEIC/HEIF originals are kept unchanged; screens show the derived JPEG.
    const shown = (photo) => photo.view?.blob ?? photo.blob;
    function retireImageURL(value) {
      // show() may assign another src in this task. Let the final queued image
      // update cancel the previous request before retiring its URL.
      queueMicrotask(() => queueMicrotask(() => URL.revokeObjectURL(value)));
    }
    function retireCovers(covers, keep = () => false) {
      for (const [u, image] of covers) {
        if (keep(image)) continue;
        // Never leave a connected image pointing at a revoked URL: Safari and
        // a pending lazy request can both read it again.
        if (image.getAttribute("src") === u) image.removeAttribute("src");
        retireImageURL(u);
        covers.delete(u);
      }
    }
    function cleanup() {
      host?.querySelector('.photo-editor')?.disposeAITool?.();
      if (status) root.HaedoMotion?.cancel(status);
      dismissControls?.();
      dismissControls = null;
      if (info) {
        const sheet = info; info = null;
        if (sheet.open) sheet.close();
        sheet.remove();
      }
      refreshInfo = null;
      pill = null;
      releaseViewport?.();
      releaseViewport = null;
      attachmentUI?.dispose();
      attachmentUI = null;
      coverObserver?.disconnect();
      coverObserver = null;
      closeViewer?.();
      closeViewer = null;
      for (const id of photoUrls.keys()) photoSources.delete(id);
      photoUrls.clear();
      // Cancel visible/lazy image consumers before revoking their object URLs.
      // A new draft can replace the feed while a cover request is still pending.
      host?.querySelectorAll("img").forEach((image) => {
        if (urls.has(image.getAttribute("src"))) image.removeAttribute("src");
      });
      for (const u of urls) retireImageURL(u);
      urls.clear();
      // Covers still inside host leave with it. Covers moved to listHost stay
      // visible until the next delivered list replaces them.
      retireCovers(feedCovers, (image) => !host?.contains(image));
      settleQueued = false;
      humanRanges = [];
      aiPending = false;
      authorNote = "";
      authorButton = null;
      editor = null;
      titleInput = null;
      selected = null;
      recoveryActions = null;
    }
    function showStatus(e) {
      // Input kept on this device only stays said until the draft is stored.
      if (!e && unstored && mode === "edit") e = unstored;
      error = e || null;
      if (status) {
        status.hidden = mode === "read" && !e && !committed;
        const authorText = mode === "edit" && !composing ? (aiPending ? AI_PENDING : authorNote) : "";
        const message =
          e?.message ||
          e ||
          authorText ||
          (composing
            ? "한글 입력 중…"
            : dirtyTick !== storedTick
            ? "자동 저장 중…"
            : mode === "read" && committed
              ? "비공개 글을 저장했어요"
              : doc?.revision
                ? "자동 저장됨"
                : doc?.replaces
                  ? "바꾼 내용 없음"
                  : "사진 없이도 바로 쓸 수 있어요");
        const state = e instanceof Error ? "error" : e || authorText ? "notice" :
          composing || dirtyTick !== storedTick ? "pending" :
          mode === "read" && committed ? "success" : doc?.revision ? "draft" : "idle";
        const changed = status.dataset.state !== state || statusText.textContent !== message;
        if (statusText.textContent !== message) statusText.textContent = message;
        const detail = !e && authorText === AI_PENDING ? AI_PENDING_DETAIL : "";
        if (statusDetail && statusDetail.textContent !== detail) statusDetail.textContent = detail;
        status.dataset.state = state;
        const role = e instanceof Error ? "alert" : "status";
        if (status.getAttribute("role") !== role) status.setAttribute("role", role);
        if (state === "error" && changed)
          root.HaedoMotion?.feedback(status, { state: "error" });
      }
      if (recoveryActions) {
        if (e?.code === "photo_post_conflict")
          recoveryActions.dataset.conflict = "true";
        recoveryActions.hidden = !e;
        recoveryActions.querySelector(".photo-recovery-copy").hidden =
          recoveryActions.dataset.conflict !== "true";
      }
      refreshInfo?.();
      onDirty();
    }
    function committedFeedback() {
      // Only an explicit successful store reaches this path. Draft autosaves
      // remain quiet, and a stale callback cannot animate a later screen.
      const token = epoch;
      root.requestAnimationFrame(() => {
        if (!current(token) || mode !== "read" || !committed || error ||
          status.dataset.state !== "success") return;
        root.HaedoMotion?.enter(host, { kind: "reveal" });
        root.HaedoMotion?.feedback(status, { state: "saved" });
      });
    }
    function bindDisclosureControls(target) {
      const selector = ".photo-more[open],.photo-format-options[open]";
      const closeOutside = (event) => {
        for (const detail of target.querySelectorAll(selector))
          if (!detail.contains(event.target)) detail.open = false;
      };
      const closeWithEscape = (event) => {
        if (event.key !== "Escape") return;
        const opened = [...target.querySelectorAll(selector)];
        if (!opened.length) return;
        const active = opened.find((detail) => detail.contains(document.activeElement));
        opened.forEach((detail) => { detail.open = false; });
        active?.querySelector("summary")?.focus({ preventScroll: true });
        event.preventDefault();
        event.stopPropagation();
      };
      const closeAction = (event) => {
        const detail = event.target.closest(".photo-more-menu button")?.closest(".photo-more");
        if (!detail) return;
        const restoreFocus = detail.contains(document.activeElement);
        detail.open = false;
        if (restoreFocus) detail.querySelector("summary")?.focus({ preventScroll: true });
      };
      document.addEventListener("pointerdown", closeOutside);
      target.addEventListener("keydown", closeWithEscape);
      target.addEventListener("click", closeAction);
      return () => {
        document.removeEventListener("pointerdown", closeOutside);
        target.removeEventListener("keydown", closeWithEscape);
        target.removeEventListener("click", closeAction);
      };
    }
    function button(label, task) {
      const b = el("button", label, "life-button");
      b.type = "button";
      b.addEventListener("click", () => run(task));
      return b;
    }
    // Every control picture is the shared Lucide 1.51.0 set (decision 15).
    function glyph(name, size = 20) {
      return life.Icons.create(name, { size });
    }
    function iconControl(node, name, label) {
      node.classList.add("photo-icon-button");
      node.setAttribute("aria-label", label);
      node.title = label;
      node.replaceChildren(glyph(name), el("span", label, "life-sr-only"));
      return node;
    }
    // The floating tools stay above an on-screen keyboard: the visual viewport
    // shrinks while the layout viewport keeps its height (iOS Safari).
    function keyboardOffset(target) {
      const view = root.visualViewport;
      if (!view) return null;
      let frame = 0;
      const apply = () => {
        frame = 0;
        const covered = Math.max(0, Math.round(root.innerHeight - view.height - view.offsetTop));
        target.style.setProperty("--photo-keyboard", covered > 80 ? covered + "px" : "0px");
      };
      const schedule = () => { if (!frame) frame = root.requestAnimationFrame(apply); };
      view.addEventListener("resize", schedule);
      view.addEventListener("scroll", schedule);
      apply();
      return () => {
        if (frame) root.cancelAnimationFrame(frame);
        view.removeEventListener("resize", schedule);
        view.removeEventListener("scroll", schedule);
      };
    }
    // Publication is read from BlogSync only (never changed here). In the
    // editor it is the saved post being revised; a new draft is private.
    // publicState: { id, published } once read; { id, checking } while the first read
    // runs; { id, failed } when it could not be read. Until it is known the pill and
    // 글 정보 say nothing about visibility (a public post must never look private).
    let publicState = null;
    const publicTarget = () =>
      mode === "read" ? (doc?.status === "saved" ? doc.id : null) : doc?.replaces?.id || null;
    function publication() {
      const id = publicTarget();
      if (!id) return "private"; // a new or unsaved draft cannot have a public copy
      if (publicState?.id !== id || publicState.failed) return "unknown";
      if (publicState.checking) return "checking";
      return publicState.published ? "public" : "private";
    }
    const isPublished = () => publication() === "public";
    const serverState = () =>
      mode === "read" && doc?.status === "saved" && serverValue?.id === doc.id &&
      serverValue.revision === doc.revision ? serverValue.status : null;
    function updatePill() {
      if (!pill) return;
      const state = publication(), problem = PILL_PROBLEMS[serverState()] || "",
        label = state === "public" ? "공개" : state === "private" ? "비공개" : "글 정보",
        spoken = state === "checking" ? "공개 여부 확인 중" : state === "unknown" ? "공개 여부 확인 못 함" : label;
      pill.dataset.state = problem ? "problem" : state;
      // The button is the 44px target; the drawn pill is its inner face.
      const face = el("span", null, "photo-privacy-face");
      if (state === "public" || state === "private") face.append(glyph(state === "public" ? "globe" : "lock", 16));
      face.append(el("span", label, "photo-privacy-label"));
      if (problem) face.append(el("span", problem, "photo-privacy-problem"));
      // 글 저장 replaces the original of a post being revised: say so on the top line.
      const revising = mode === "edit" && !!doc?.replaces;
      if (revising && !problem) face.append(el("span", "수정 중", "photo-privacy-note"));
      face.append(glyph("forward", 16));
      pill.replaceChildren(face);
      pill.setAttribute("aria-label", spoken + (problem ? " · " + problem : "") + (revising ? " · 기존 글 수정 중" : "") +
        (state === "public" || state === "private" ? " · 글 정보" : ""));
    }
    function privacyPill() {
      const b = el("button", null, "photo-privacy");
      b.type = "button";
      b.setAttribute("aria-haspopup", "dialog");
      b.title = "글 정보";
      if (doc?.id) b.dataset.focusKey = "photo:info:" + doc.id;
      b.addEventListener("click", () => {
        if (valid() && !navigating && !info) openInfo(b);
      });
      pill = b;
      updatePill();
      return b;
    }
    // 글 정보: what the top line used to say (visibility, date, save state),
    // one tap away. Editing input is never re-rendered while it is open.
    function openInfo(origin) {
      const token = epoch,
        sheet = el("dialog", null, "photo-info"),
        head = el("div", null, "photo-info-head"),
        title = el("h2", "글 정보"),
        rows = el("dl", null, "photo-info-rows");
      title.id = "photoInfoTitle";
      title.tabIndex = -1;
      sheet.setAttribute("aria-labelledby", title.id);
      const close = iconControl(el("button"), "close", "글 정보 닫기");
      close.type = "button";
      close.addEventListener("click", () => sheet.close());
      head.append(title, close);
      sheet.append(head, rows);
      // The save state can take focus (tabindex -1) so a finished action can hand focus to its result.
      const stateValue = (text) => {
        const value = el("span", text, "photo-info-value");
        value.dataset.infoFocus = "save-state";
        value.tabIndex = -1;
        return value;
      };
      const row = (name, ...value) => {
        const wrap = el("div", null, "photo-info-row"),
          detail = el("dd");
        detail.append(...value);
        wrap.append(el("dt", name), detail);
        rows.append(wrap);
        return detail;
      };
      refreshInfo = () => {
        if (info !== sheet || !current(token)) return;
        const state = publication(), published = state === "public", known = published || state === "private",
          saved = mode === "read" && doc.status === "saved";
        // Rebuilding the rows must not drop focus to <body>: remember which action had it.
        const had = rows.contains(document.activeElement) ? document.activeElement.dataset.infoFocus || "save-state" : null;
        rows.replaceChildren();
        const shown = el("span", null, "photo-info-line");
        if (known) shown.append(glyph(published ? "globe" : "lock", 16));
        shown.append(el("span", published ? "공개 중" : state === "private" ? "비공개" : state === "checking" ? "확인 중" : "확인하지 못함", "photo-info-value"));
        const visibility = row("공개", shown);
        visibility.append(el("p", published
          ? "공개 사본은 이 글과 따로 있습니다. 고친 내용은 공개 설정에서 갱신해야 공개 화면에 반영됩니다."
          : !known ? "공개 여부를 아직 확인하지 못했습니다. 글 공개·보관에서 확인할 수 있습니다."
          : saved ? "공개는 미리보기를 확인한 뒤 따로 선택합니다. 사진은 고른 것만, 촬영·위치 정보를 뺀 사본으로 공개합니다."
            : "저장한 글만 공개할 수 있습니다.", "photo-info-note"));
        if (saved && typeof onManageServer === "function") {
          const manage = button(published ? "공개 설정" : known ? "공개하기" : "공개 상태 확인", () => {
            sheet.close();
            return openPostTask(onManageServer, origin.dataset.focusKey);
          });
          manage.classList.add("photo-info-action");
          manage.dataset.infoFocus = "manage";
          visibility.append(manage);
        }
        // A new draft not yet stored has no saved time to show.
        const stamp = doc.revision > 0 ? when(doc.updatedAt) : "";
        if (stamp) {
          const time = el("time", stamp);
          time.dateTime = doc.updatedAt;
          row(mode === "edit" ? "마지막 보관" : "저장한 시각", time);
        }
        if (mode === "edit") {
          const state = row("저장", stateValue(statusText?.textContent || ""));
          state.append(el("p", "초안은 계정에 비공개로 자동 보관되어 로그인한 다른 기기에서 이어 쓸 수 있습니다. 글 저장을 눌러야 글 목록에 올라갑니다.", "photo-info-note photo-server-scope"));
          if (doc.replaces)
            row("수정", el("span", "저장한 글을 고치는 중입니다. 글 저장을 누르면 원래 글을 이 내용으로 바꿉니다.", "photo-info-value"));
        } else if (saved) {
          const value = serverState() || "checking";
          const state = row("저장", stateValue(SERVER_LABELS[value] || SERVER_LABELS.error));
          state.dataset.state = value;
          if (["not_enabled", "pending", "error"].includes(value) && !serverBusy) {
            const retry = button("계정에 다시 올리기", saveServer);
            retry.classList.add("photo-info-action");
            retry.dataset.infoFocus = "retry";
            state.append(retry);
          }
        } else row("저장", el("span", doc.status === "draft" ? "초안" : "", "photo-info-value"));
        if (doc.archived) row("목록", el("span", "숨긴 글입니다. 일반 목록과 검색에는 나오지 않습니다.", "photo-info-value"));
        // The same action again; if it is gone (e.g. 계정에 다시 올리기 while it runs), the save state it changed.
        if (had) (rows.querySelector('[data-info-focus="' + had + '"]') || rows.querySelector('[data-info-focus="save-state"]') || title).focus({ preventScroll: true });
      };
      sheet.addEventListener("click", (e) => {
        // A click on the backdrop (outside the sheet's box) closes it.
        if (e.target !== sheet) return;
        const box = sheet.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) sheet.close();
      });
      sheet.addEventListener("close", () => {
        // cleanup() detaches the sheet first; then the screen is being
        // replaced and focus belongs to the next render.
        const own = info === sheet;
        if (own) { info = null; refreshInfo = null; }
        sheet.remove();
        if (own && current(token) && origin.isConnected) origin.focus({ preventScroll: true });
      }, { once: true });
      info = sheet;
      refreshInfo();
      document.body.append(sheet);
      sheet.showModal();
      close.focus();
    }
    async function run(task) {
      if (busy || navigating || !valid()) return;
      try {
        await task();
      } catch (e) {
        if (valid()) showStatus(e);
      }
    }
    function setBusy(value) {
      busy = value;
      if (value && !feedControls.length) {
        feedControls = [...(feedHost?.querySelectorAll("button") || [])].map(
          (n) => [n, n.disabled],
        );
        feedControls.forEach(([n]) => {
          n.disabled = true;
        });
      } else if (!value) {
        feedControls.forEach(([n, disabled]) => {
          if (n.isConnected) n.disabled = disabled;
        });
        feedControls = [];
      }
      if (host) {
        host.setAttribute("aria-busy", String(value));
        if (value && !controls.length) {
          controls = [
            ...host.querySelectorAll("button,input,textarea,select"),
          ].map((n) => [n, n.disabled]);
          controls.forEach(([n]) => {
            n.disabled = true;
          });
        } else if (!value) {
          controls.forEach(([n, disabled]) => {
            if (n.isConnected) n.disabled = disabled;
          });
          controls = [];
        }
      }
      editor?.enable(!value && !offer);
      if (!value) scheduleSettle();
      onDirty();
      if (
        !value &&
        valid() &&
        mode === "edit" &&
        !settled()
      ) {
        scheduleAutosave();
      }
    }
    function guard(acceptedOnly = false) {
      if (!valid()) throw new Error("작업공간이 바뀌었습니다.");
      if (busy) throw new Error("사진 처리를 마친 뒤 이동해 주세요.");
      if (composing) throw new Error("한글 입력을 마친 뒤 다시 시도해 주세요.");
      if (offer) throw new Error("이 기기에 남아 있는 입력을 복구할지 먼저 골라 주세요.");
      if (!acceptedOnly && attachmentUI?.composing())
        throw new Error("첨부의 한글 입력을 마친 뒤 다시 시도해 주세요.");
    }
    function cancelAutosave() {
      clearTimeout(timer); clearTimeout(maxTimer);
      timer = maxTimer = null;
    }
    function scheduleAutosave() {
      clearTimeout(timer); timer = null;
      if (!doc || mode !== "edit" || !current(epoch) || settled() || saving) return;
      const target = doc, token = epoch;
      const store = () => {
        if (!current(token) || doc !== target || mode !== "edit") return;
        cancelAutosave();
        // Existing lifecycle handlers share this same checkpoint promise.
        checkpoint().catch(() => {});
      };
      timer = setTimeout(store, 300);
      // Continuous input resets only the idle timer, never this deadline.
      if (maxTimer === null) maxTimer = setTimeout(store, 2000);
    }
    // ---- AI authorship ----------------------------------------------------
    // Quill gives typed text the inline formats before the caret. Owner input
    // that inherited `author` is recorded from each text-change and settled in
    // a microtask right after that change, so the mark removal always joins
    // the undo step of the input it belongs to. A composition is settled right
    // after it ends (Quill emits it from compositionend), never while open.
    // Undo/redo replays (history.ignoreChange) and the marked paste below keep
    // their recorded authorship.
    const imeActive = () => composing || !!editor?.composition?.isComposing;
    function trackAuthorship(delta, source) {
      if (humanRanges.length)
        humanRanges = humanRanges
          .map(([start, end]) => [delta.transformPosition(start), delta.transformPosition(end, true)])
          .filter(([start, end]) => end > start);
      if (source === "user" && !aiInserting && !editor.history?.ignoreChange) {
        let at = 0;
        for (const op of delta.ops) {
          if (op.retain != null) at += typeof op.retain === "number" ? op.retain : 1;
          else if (op.insert != null) {
            const length = typeof op.insert === "string" ? op.insert.length : 1;
            if (op.attributes?.author) humanRanges.push([at, at + length]);
            at += length;
          }
        }
      }
      scheduleSettle();
    }
    function scheduleSettle() {
      if (settleQueued || !humanRanges.length || mode !== "edit") return;
      settleQueued = true;
      const token = epoch;
      queueMicrotask(() => {
        settleQueued = false;
        if (current(token)) settleAuthorship();
      });
    }
    function settleAuthorship() {
      // Deferred while composing (retried from compositionend) or while the
      // editor is disabled for photo work (retried from setBusy(false)).
      if (!humanRanges.length || !editor || mode !== "edit" || imeActive() || !editor.isEnabled()) return;
      const ranges = humanRanges,
        history = editor.history,
        prior = history.lastRecorded;
      humanRanges = [];
      for (const [start, end] of ranges) {
        // The top undo step is the input's own step (settled right after it);
        // keep the removal in it even when the 700 ms grouping window has just
        // closed, so one undo removes the typed text without re-marking it.
        if (typeof prior === "number") history.lastRecorded = Date.now();
        try {
          editor.formatText(start, end - start, "author", false, "user");
        } finally {
          if (typeof prior === "number") history.lastRecorded = prior;
        }
      }
    }
    function syncAuthorButton() {
      if (!authorButton?.isConnected || !editor) return;
      const range = editor.selection?.savedRange;
      let pressed = aiPending;
      if (range?.length) {
        const text = editor.getContents(range.index, range.length).ops
          .filter((op) => typeof op.insert === "string" && /[^\n]/.test(op.insert));
        pressed = text.length > 0 && text.every((op) => op.attributes?.author === "ai");
      }
      const value = String(pressed);
      if (authorButton.getAttribute("aria-pressed") !== value)
        authorButton.setAttribute("aria-pressed", value);
    }
    function setAiPending(value, announce = true) {
      if (aiPending === value) return;
      aiPending = value;
      if (!value && announce) { authorNote = "AI 글 붙여넣기 대기를 껐어요"; authorNoteKept = true; }
      syncAuthorButton();
      showStatus(error);
    }
    function toggleAuthorship() {
      guard(true);
      if (!editor || mode !== "edit") return;
      settleAuthorship();
      const range = editor.getSelection(true);
      if (!range) return;
      if (!range.length) {
        setAiPending(!aiPending);
        return;
      }
      const text = editor.getContents(range.index, range.length).ops
        .filter((op) => typeof op.insert === "string" && /[^\n]/.test(op.insert));
      if (!text.length) {
        authorNote = "AI 글로 표시할 글자를 선택해 주세요"; authorNoteKept = true;
        showStatus(error);
        return;
      }
      const marked = text.every((op) => op.attributes?.author === "ai");
      if (aiPending) setAiPending(false, false);
      editor.formatText(range.index, range.length, "author", marked ? false : "ai", "user");
      authorNote = marked ? "AI 글 표시를 해제했어요" : "AI 글로 표시했어요"; authorNoteKept = false;
      syncAuthorButton();
      showStatus(error);
    }
    function mark() {
      // A note about what storing changed stays readable for a few seconds of typing.
      if (Date.now() >= noteHold) { authorNote = ""; authorNoteKept = false; }
      dirtyTick++;
      doc.updatedAt = new Date().toISOString();
      showStatus();
      scheduleAutosave();
    }
    async function persist(modelOnly = false, target = doc) {
      if (doc !== target) return;
      cancelAutosave();
      if (saving) {
        await saving;
        if (!valid() || doc !== target) return;
        return persist(modelOnly, target);
      }
      // Owner-typed text inside AI text is stored as the owner's own. Never
      // reformats during an IME composition; the next save after it does.
      settleAuthorship();
      if (!modelOnly && aiPending) setAiPending(false, false);
      if (!modelOnly && mode === "edit" && selected?.isConnected) changePhoto();
      if (!doc || mode !== "edit" || dirtyTick === storedTick) return;
      if (modelOnly) {
        if (!valid()) throw new Error("작업공간이 바뀌었습니다.");
      } else guard(true);
      const tick = dirtyTick,
        normal = M.normalize(doc),
        token = epoch;
      let payload;
      try {
        // Only a valid document reaches storage and account sync.
        M.validate(normal.doc);
        payload = structuredClone(normal.doc);
      } catch (cause) {
        keepLocally(tick, cause);
        return;
      }
      saving = storage
        .savePhotoPost(workspaceId, payload, doc.revision)
        .then((saved) => {
          if (!valid() || doc !== target) return;
          const first = target.revision === 0 && !!target.replaces;
          target.revision = saved.revision;
          storedTick = tick;
          keptTick = -1;
          unstored = null;
          // The stored draft now holds everything: the device copy is done.
          if (storedTick === dirtyTick) recoveryStore.clear(workspaceId, target.id);
          if (normal.changed) alignEditor(normal, tick);
          if (first && current(token) && mode === "edit") onModeChange({ mode, id: target.id });
          // A short AI-mark note gives way to the save state once saved.
          if (storedTick === dirtyTick && !authorNoteKept) authorNote = "";
          if (payload.status === "draft") try { root.HaedoLife?.BlogSync?.noteLocalDraftSaved?.(saved.id || payload.id); } catch (_) {}
          if (current(epoch)) showStatus();
          if (current(token)) onSaved();
        })
        .finally(() => {
          saving = null;
          if (valid() && doc === target) onDirty();
        });
      try {
        await saving;
      } catch (cause) {
        // The store refused (quota, another tab): the input also goes to the
        // device copy. Leaving stays blocked exactly as before.
        if (valid() && doc === target && mode === "edit") recoveryStore.write(workspaceId, doc);
        throw cause;
      }
      if (valid() && doc === target && dirtyTick !== storedTick) return persist(modelOnly || busy || composing, target);
    }
    // No valid form of the input exists (it is over a limit). Nothing invalid
    // is stored or synced; the input stays whole on this device and the reason
    // is shown. If even that fails the caller is refused and nothing moves.
    function keepLocally(tick, cause) {
      if (!recoveryStore.write(workspaceId, doc))
        throw Object.assign(new Error(cause.message + " 이 기기에도 임시 보관하지 못했습니다. 더 보기의 HTML 읽기 파일 받기로 내려받아 주세요."), { code: "photo_post_unkept" });
      keptTick = tick;
      unstored = Object.assign(new Error(cause.message + " 그때까지 이 기기에만 임시 보관합니다."), { code: "photo_post_local_only" });
      if (current(epoch)) showStatus();
    }
    // The screen follows what was stored. Never during an IME composition (the
    // save after it normalizes again) and never under newer input.
    function alignEditor(normal, tick) {
      if (!editor || mode !== "edit" || tick !== dirtyTick || imeActive() || !current(epoch)) return;
      const before = editor.getContents(),
        change = before.diff(new Delta(normal.doc.ops));
      // A photo block being edited keeps its own node.
      if (selected && change.ops.some((op) => op.insert && typeof op.insert !== "string")) return;
      if (change.ops.length) {
        editor.updateContents(change, "silent");
        doc.ops = editor.getContents().ops;
      }
      if (titleInput && titleInput.value !== normal.doc.title) {
        const end = Math.min(titleInput.selectionEnd, normal.doc.title.length);
        titleInput.value = normal.doc.title;
        if (document.activeElement === titleInput) titleInput.setSelectionRange(end, end);
      }
      doc.title = normal.doc.title;
      const note = M.describeChanges(normal.changes);
      if (note) { authorNote = note; authorNoteKept = true; noteHold = Date.now() + 6000; }
    }
    // The page is being hidden or closed before autosave ran: what the editor
    // holds goes to the device copy synchronously (async stores may not finish).
    function stash() {
      if (!host || !valid() || mode !== "edit" || !doc || offer || dirtyTick === storedTick) return;
      recoveryStore.write(workspaceId, doc);
    }
    function checkpoint() {
      // Keep the accepted model durable without committing an IME field or a
      // file whose signature, dimensions and original bytes are still pending.
      const target = doc;
      if (checkpointing?.doc === target) return checkpointing.promise;
      const entry = { doc: target, promise: null };
      entry.promise = persist(true, target).catch((cause) => {
        if (current(epoch) && doc === target) showStatus(cause);
        throw cause;
      }).finally(() => {
        if (checkpointing === entry) checkpointing = null;
      });
      checkpointing = entry;
      return entry.promise;
    }
    async function flush() {
      attachmentUI?.flush();
      if (mode === "edit" && selected?.isConnected) changePhoto();
      // Only reading: leaving is allowed. detach() advances the epoch, so the
      // late read result is discarded by the existing current(token) checks.
      if (loading && !composing && (!doc || mode !== "edit" || settled())) return;
      if (
        !busy &&
        !composing &&
        (!doc || mode !== "edit" || settled())
      )
        return;
      guard();
      await persist();
      guard();
    }
    function download(blob, name) {
      const u = url(blob),
        a = el("a");
      a.href = u;
      a.download = name;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(u);
        urls.delete(u);
      }, 30000);
    }
    function outputSnapshot() {
      guard();
      settleAuthorship();
      attachmentUI?.flush();
      if (mode === "edit" && selected?.isConnected) changePhoto();
      // The files of the current input (ZIP, HTML) are written from the
      // normalized document and do not wait for it to be storable.
      return M.normalize(doc).doc;
    }
    async function backup() {
      const value = outputSnapshot(),
        token = epoch;
      setBusy(true);
      try {
        const blob = await M.backup(value, { lenient: true });
        if (current(token)) download(blob, "haedo-photo-post.zip");
      } finally {
        setBusy(false);
      }
    }
    // A stored draft leaves this device and, by the same deletion record as
    // 삭제, the account's other devices.
    async function removeDraft(target) {
      if (target.revision > 0) {
        if (blogSync?.deletePost) await blogSync.deletePost(workspaceId, target.id, { expectedRevision: target.revision });
        else await storage.deletePhotoPost(workspaceId, target.id, target.revision);
      }
      recoveryStore.clear(workspaceId, target.id);
    }
    // Leaving the editor: a revision that holds exactly what the saved post
    // holds, and a draft with nothing in it, are not kept. Cleaning up never
    // blocks leaving; whatever could not be removed simply stays.
    async function settleDraft() {
      if (mode !== "edit" || !doc || doc.status !== "draft" || offer || busy || composing || dirtyTick !== storedTick) return false;
      const target = doc;
      if (!(M.isEmpty(target) || (target.replaces && baseline !== null && M.contentKey(target) === baseline))) return false;
      if (target.revision > 0 && staleApp()) return false;
      try { await removeDraft(target); }
      catch (_) { return false; }
      if (doc === target) {
        target.revision = 0;
        resetTicks();
        // If the editor stays open, other screens name the saved post again.
        if (target.replaces && current(epoch) && mode === "edit") onModeChange({ mode, id: shownId() });
      }
      return true;
    }
    // What other screens ask before moving on: store the input, then settle.
    async function leave() {
      await flush();
      return settleDraft();
    }
    // 수정 취소 / 초안 삭제: asked first; if the removal fails the input stays in the editor.
    async function discardDraft() {
      if (mode !== "edit" || !doc || doc.status !== "draft") return;
      guard(true);
      const target = doc, token = epoch, original = target.replaces?.id || null;
      if (target.revision > 0 && staleApp())
        throw new Error("앱을 새로고침한 뒤 다시 시도해 주세요. 입력은 이 기기에 그대로 있습니다.");
      if (typeof root.confirm === "function" && !root.confirm(original
        ? "수정한 내용을 버릴까요? 저장한 글은 그대로 남습니다."
        : "이 초안을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.")) return;
      if (!current(token) || doc !== target) return;
      cancelAutosave();
      if (saving) await saving.catch(() => {});
      if (!current(token) || doc !== target) return;
      setBusy(true);
      try {
        await removeDraft(target);
      } catch (e) {
        if (e?.code === "photo_post_conflict")
          throw Object.assign(new Error("다른 탭이나 기기에서 초안이 바뀌어 지우지 않았습니다. 입력은 그대로 있습니다."), { code: e.code });
        throw e;
      } finally {
        setBusy(false);
      }
      if (!current(token)) return;
      doc = null;
      mode = "list";
      resetTicks();
      error = null;
      committed = false;
      onSaved();
      if (original) {
        // Back to the saved post the revision belonged to.
        try {
          await open(original);
          if (current(epoch)) host.querySelector(".photo-read-heading")?.focus({ preventScroll: true });
          return;
        } catch (_) {
          if (!valid() || !host?.isConnected) return;
        }
      }
      if (onReturn && (await onReturn({ id: null, deletedId: target.id, committed: false })) !== false) return;
      if (!valid() || !host?.isConnected) return;
      render();
    }
    // The id other screens use for the open post: an unstored revision is
    // still the saved post it revises (its own id names nothing yet).
    const shownId = () => (mode === "edit" && doc?.replaces && doc.revision === 0 ? doc.replaces.id : doc?.id || null);
    async function list() {
      const removed = await leave();
      if (onReturn && (await onReturn({ id: removed ? doc?.replaces?.id || null : doc?.id || null, committed })) !== false)
        return;
      doc = null;
      mode = "list";
      error = null;
      committed = false;
      render();
    }
    async function begin() {
      try {
        const token = epoch;
        await leave();
        await beforeOpen();
        if (!current(token)) return;
        baseline = null;
        setBusy(true); loading = true;
        try {
          const rows = await storage.listPhotoPosts(workspaceId);
          if (!current(token)) return;
          const row = rows.find(
            (v) =>
              v.status === "draft" &&
              !v.archived &&
              !v.title.trim() &&
              !v.body.trim() &&
              !v.photos &&
              !v.attachments,
          );
          let empty = row
            ? await storage.readPhotoPost(workspaceId, row.id).catch((e) => {
                if (e.code !== "photo_post_missing") throw e;
                return null;
              })
            : null;
          if (!current(token)) return;
          if (
            empty &&
            (empty.status !== "draft" ||
              empty.archived ||
              empty.replaces ||
              empty.title.trim() ||
              M.plainText(empty).trim() ||
              empty.photos.length ||
              empty.attachments?.length)
          )
            empty = null;
          doc = empty ? M.upgrade(empty) : M.create(life.Core.id);
          const stored = new Set(rows.map((item) => item.id));
          // Input of a new post that never reached storage (no draft names it).
          offer = usableCopy(recoveryStore.read(workspaceId, doc.id) ||
            recoveryStore.list(workspaceId).find((copy) => !copy.replaces && !stored.has(copy.id)));
        } finally {
          loading = false; setBusy(false);
        }
        mode = "edit";
        resetTicks();
        error = null;
        committed = false;
        render();
        editor?.focus();
      } catch (e) {
        if (valid()) showStatus(e);
      }
    }
    async function open(id, editing = false, expectedRevision = null) {
      const token = epoch, wasReading = mode === "read";
      // Reopening the post that is open must not settle it away first.
      if (doc?.id === id) await flush(); else await leave();
      await beforeOpen();
      if (!current(token)) return;
      setBusy(true); loading = true;
      try {
        const next = await storage.readPhotoPost(workspaceId, id);
        let orphan = null;
        baseline = null;
        if (!current(token)) return;
        if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || next.revision !== expectedRevision))
          throw Object.assign(new Error('글이 바뀌었습니다. 목록을 다시 확인해 최신 글을 직접 열어 주세요.'), { code: 'photo_post_changed' });
        if (editing && next.status === "saved") {
          const rows = await storage.listPhotoPosts(workspaceId);
          if (!current(token)) return;
          let retained = null;
          // The index deliberately contains no editor metadata or original
          // blobs. Read candidates one at a time, without retaining all photos.
          const drafts = rows
            .filter((item) => item.status === "draft" && !item.archived)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          for (const row of drafts) {
            const candidate = await storage.readPhotoPost(workspaceId, row.id)
              .catch((e) => {
                if (e.code !== "photo_post_missing") throw e;
                return null;
              });
            if (!current(token)) return;
            if (
              candidate?.status === "draft" && !candidate.archived &&
              candidate.replaces?.id === next.id &&
              candidate.replaces.revision === next.revision
            ) {
              retained = candidate;
              break;
            }
          }
          doc = retained || {
            ...structuredClone(next),
            id: life.Core.id(),
            revision: 0,
            status: "draft",
            replaces: { id: next.id, revision: next.revision },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          // Nothing is stored for a revision until something is changed.
          resetTicks();
          baseline = M.contentKey(next);
          // Input of an earlier, never stored revision of this post.
          if (!retained) {
            const stored = new Set(rows.map((item) => item.id));
            orphan = recoveryStore.list(workspaceId).find((copy) => copy.replaces?.id === next.id && !stored.has(copy.id)) || null;
          }
        } else {
          doc = next;
          resetTicks();
          if (next.status === "draft" && next.replaces && !next.archived) {
            // A stored revision opened from the drafts: compare with its post on leaving.
            const original = await storage.readPhotoPost(workspaceId, next.replaces.id).catch(() => null);
            if (!current(token)) return;
            if (original?.status === "saved" && original.revision === next.replaces.revision) baseline = M.contentKey(original);
          }
        }
        mode =
          !next.archived && (editing || next.status === "draft")
            ? "edit"
            : "read";
        if (mode === "edit") doc = M.upgrade(doc);
        offer = mode === "edit" ? usableCopy(recoveryStore.read(workspaceId, doc.id) || orphan) : null;
        error = null;
        committed = false;
        render();
        if (wasReading && mode === "edit") {
          const rendered = epoch;
          root.requestAnimationFrame(() => {
            if (current(rendered) && mode === "edit")
              root.HaedoMotion?.enter(host, { kind: "compose" });
          });
        }
        if (mode === "edit") editor?.focus();
      } finally {
        loading = false; setBusy(false);
      }
    }
    // A device copy is offered only when it differs from what the draft holds.
    function usableCopy(copy) {
      if (!copy || !doc) return null;
      let same = false;
      try {
        same = M.contentKey({ ...doc, title: copy.title, ops: copy.ops, attachments: copy.attachments }) === M.contentKey(doc);
      } catch (_) {}
      if (same) recoveryStore.clear(workspaceId, copy.id);
      return same ? null : copy;
    }
    function restoreCopy() {
      const copy = offer;
      if (!copy || !doc || mode !== "edit" || !valid()) return;
      // The copy continues what is stored here (or nothing is stored yet): it
      // takes that place. If the draft changed after the copy was taken, both
      // are kept and the copy becomes a draft of its own.
      const continues = doc.revision === 0 || (copy.id === doc.id && copy.revision === doc.revision);
      const next = continues ? doc : { ...M.create(life.Core.id), photos: doc.photos };
      let attachments = next.attachments;
      try {
        life.PagePosts.validateAttachments(copy.attachments);
        attachments = structuredClone(copy.attachments);
      } catch (_) {}
      const normal = M.normalize({ ...next, title: copy.title, ops: copy.ops, attachments });
      const wanted = copy.ops.filter((op) => op?.insert?.photo).length,
        kept = normal.doc.ops.filter((op) => typeof op.insert !== "string").length;
      Object.assign(next, { title: normal.doc.title, ops: normal.doc.ops, attachments, updatedAt: new Date().toISOString() });
      doc = next;
      offer = null;
      resetTicks(1);
      // The copy stays on this device until the restored input is stored.
      recoveryStore.write(workspaceId, doc);
      if (copy.id !== doc.id) recoveryStore.clear(workspaceId, copy.id);
      error = null;
      render();
      authorNote = wanted > kept
        ? "복구했어요 · 사진 " + (wanted - kept) + "장은 이 기기에 남아 있지 않아요"
        : "남아 있던 입력을 복구했어요";
      authorNoteKept = true;
      showStatus();
      editor?.focus();
    }
    function discardCopy() {
      const copy = offer;
      if (!copy || !valid()) return;
      if (typeof root.confirm === "function" && !root.confirm("이 기기에 남아 있는 입력을 버릴까요? 되돌릴 수 없습니다.")) return;
      recoveryStore.clear(workspaceId, copy.id);
      offer = null;
      error = null;
      render();
      editor?.focus();
    }
    async function finish(asNew = false) {
      if (asNew) return saveIndependent("saved");
      guard();
      const token = epoch;
      await flush();
      if (!current(token)) return;
      const draftId = doc.id,
        payload = structuredClone(M.normalize(doc).doc);
      const previousId = payload.replaces?.id || payload.id;
      payload.status = "saved";
      payload.updatedAt = new Date().toISOString();
      // The strict check, naming what to fix, belongs to this explicit save.
      M.validate(payload);
      setBusy(true);
      try {
        const saved = await storage.savePhotoPost(
          workspaceId,
          payload,
          doc.revision,
        );
        if (!current(token)) return;
        recoveryStore.clear(workspaceId, draftId);
        keptTick = -1;
        unstored = null;
        doc = saved;
        resetTicks();
        mode = "read";
        error = null;
        committed = true;
        render();
        committedFeedback();
        host.querySelector(".photo-read-heading")?.focus();
        onSaved();
        onCommitted({ id: saved.id, previousId, status: saved.status });
      } finally {
        setBusy(false);
      }
      await saveServer();
    }
    async function archive(value) {
      await flush();
      guard();
      const token = epoch,
        next = M.upgrade(doc);
      next.archived = value;
      next.updatedAt = new Date().toISOString();
      setBusy(true);
      try {
        const saved = await storage.savePhotoPost(
          workspaceId,
          next,
          doc.revision,
        );
        if (!current(token)) return;
        doc = saved;
        resetTicks();
        mode = value ? "read" : saved.status === "draft" ? "edit" : "read";
        error = null;
        committed = false;
        render();
        onSaved();
      } finally {
        setBusy(false);
      }
    }
    // Recovery must not write the conflicted draft first. Keep its identity and
    // revision intact until a fresh document has actually committed.
    async function independentEvidence(token, postId, replacedId) {
      const read = async id => {
        const value = await storage.readPostEvidence(workspaceId, id);
        if (!current(token)) return null;
        if (!Number.isSafeInteger(value?.revision) || value.revision < 0 || !Array.isArray(value.refs))
          throw Object.assign(new Error('글의 원문 근거를 확인하지 못했습니다. 현재 입력은 유지합니다.'), { code: 'invalid_source_reference' });
        return value;
      };
      let evidence = await read(postId);
      // Editing drafts inherit the saved post's evidence only on replacement.
      // An independent copy must explicitly retain it; an intentional empty
      // evidence row (revision > 0) takes precedence over that fallback.
      if (evidence?.revision === 0 && replacedId) evidence = await read(replacedId);
      return evidence;
    }
    async function saveIndependent(nextStatus = "draft") {
      guard();
      cancelAutosave();
      const token = epoch;
      if (saving) await saving.catch(() => {});
      if (!current(token)) return;
      const next = M.upgrade(outputSnapshot()),
        now = new Date().toISOString();
      // outputSnapshot may settle authorship marks; this copy is the write.
      cancelAutosave();
      const previousId = doc.replaces?.id || doc.id,
        sourceId = doc.id;
      Object.assign(next, {
        id: life.Core.id(),
        revision: 0,
        status: nextStatus,
        archived: false,
        replaces: null,
        createdAt: now,
        updatedAt: now,
      });
      setBusy(true);
      try {
        const evidence = await independentEvidence(token, doc.id, doc.replaces?.id);
        if (!current(token)) return;
        const saved = await storage.savePhotoPostWithEvidence(workspaceId, next, 0, evidence.refs, 0);
        if (!current(token)) return;
        // The input now lives in the new document.
        recoveryStore.clear(workspaceId, sourceId);
        keptTick = -1;
        unstored = null;
        doc = saved;
        resetTicks();
        mode = nextStatus === "saved" ? "read" : "edit";
        error = null;
        committed = nextStatus === "saved";
        render();
        if (committed) committedFeedback();
        if (mode === "edit") editor?.focus();
        else host.querySelector(".photo-read-heading")?.focus();
        onSaved();
        if (committed)
          onCommitted({ id: saved.id, previousId, status: saved.status });
      } finally {
        setBusy(false);
      }
      if (nextStatus === "saved") await saveServer();
    }
    const duplicate = () => saveIndependent("draft");
    // Deleting from the read view uses the same path as 글 공개·보관: BlogSync
    // writes the deletion record so every signed-in device removes the post too.
    async function removePost() {
      if (mode !== "read" || !doc) return;
      guard();
      await flush();
      const token = epoch, id = doc.id, revision = doc.revision;
      if (!current(token) || mode !== "read" || doc?.id !== id || doc.revision !== revision) return;
      // Deleting only on this device would not reach the others (the post comes back with the next sync).
      if (staleApp()) throw new Error("앱을 새로고침한 뒤 다시 시도해 주세요. 글은 이 기기에 그대로 있습니다.");
      const label = doc.title?.trim() || "제목 없는 글";
      if (typeof root.confirm === "function" && !root.confirm("“" + label + "”을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.")) return;
      if (!current(token) || doc?.id !== id || doc.revision !== revision) return;
      setBusy(true);
      try {
        if (blogSync?.deletePost) await blogSync.deletePost(workspaceId, id, { expectedRevision: revision });
        else await storage.deletePhotoPost(workspaceId, id, revision);
      } catch (e) {
        // The shared refusal names the list; from here the post itself has to be opened again.
        if (e?.code === "photo_post_conflict")
          throw Object.assign(new Error("다른 탭이나 기기에서 글이 바뀌어 삭제하지 않았습니다. 글을 다시 연 뒤 삭제해 주세요."), { code: e.code });
        throw e;
      } finally {
        setBusy(false);
      }
      if (!current(token)) return;
      doc = null;
      resetTicks();
      committed = false;
      error = null;
      onSaved();
      // Leave the read view the way its back control would; the caller forgets the deleted post.
      const left = onReturn && (await onReturn({ id: null, deletedId: id, committed: false })) !== false;
      if (!current(token)) return;
      // A return that did not replace this view must not leave the deleted post on screen.
      if (left && !(host?.isConnected && host.querySelector(".photo-article"))) return;
      mode = "list";
      render();
      if (!left && statusText) statusText.textContent = "글을 삭제했습니다. 다른 기기에서도 삭제됩니다.";
      if (!document.activeElement || document.activeElement === document.body)
        for (const node of [...host.querySelectorAll("h2,h3,summary,button"), host]) {
          // A control inside a closed <details> has boxes but cannot take focus; the host is the last resort.
          if (node !== host && (!node.getClientRects().length || node.disabled || node.parentElement?.closest("details:not([open])") && node.tagName !== "SUMMARY")) continue;
          if (!node.hasAttribute("tabindex") && !/^(BUTTON|SUMMARY)$/.test(node.tagName)) node.tabIndex = -1;
          node.focus({ preventScroll: true });
          if (document.activeElement === node) break;
        }
    }
    function serverCurrent(token, id, revision, sequence) {
      return current(token) && mode === "read" && doc?.status === "saved" && doc.id === id &&
        doc.revision === revision && sequence === serverSequence;
    }
    async function openPostTask(callback, originFocusKey) {
      if (typeof callback !== "function" || mode !== "read" || doc?.status !== "saved") return;
      guard();
      const token = epoch, id = doc.id, revision = doc.revision;
      navigating = true;
      try {
        await flush();
        if (!current(token) || mode !== "read" || doc?.id !== id || doc.revision !== revision || doc.status !== "saved") return;
        await callback(id, { expectedRevision: revision, originFocusKey });
      }
      finally { navigating = false; }
    }
    function showServerStatus() {
      if (!serverStatus || !serverActions || mode !== "read" || doc?.status !== "saved") return;
      const state = serverState() || "checking";
      serverStatus.textContent = SERVER_LABELS[state] || SERVER_LABELS.error;
      serverStatus.dataset.state = state;
      serverStatus.dataset.postId = doc.id;
      serverActions.replaceChildren();
      if (["not_enabled", "pending", "error"].includes(state)) {
        // Next to "계정에 올리지 못함": the visible label is the action itself.
        const retry = button("다시 시도", saveServer);
        retry.id = "photoServerRetry";
        retry.title = "계정에 다시 올리기";
        serverActions.append(retry);
      } else if (state === "conflict" && onManageServer) {
        const focusKey = "photo:conflict:" + doc.id;
        const manage = button("글 관리에서 서버 내용 확인", () => openPostTask(onManageServer, focusKey));
        manage.dataset.focusKey = focusKey;
        serverActions.append(manage);
      }
      serverActions.hidden = !serverActions.children.length;
      updatePill();
      refreshInfo?.();
    }
    // Publication is shown, never changed, from the state BlogSync reports.
    function notePublication(id, state) {
      // A result without the field (e.g. a push receipt) says nothing about it.
      if (state && typeof state === "object" && Object.hasOwn(state, "publication"))
        publicState = { id, published: state.publication?.active === true };
    }
    // A read of the publication starts: a value already read for this post stays shown.
    function checkPublication(id) {
      if (publicState?.id !== id || publicState.failed) publicState = { id, checking: true };
    }
    // The read ended without a publication value: say so instead of guessing.
    function settlePublication(id) {
      if (publicState?.id === id && publicState.checking) publicState = { id, failed: true };
    }
    // No blog engine because this page lacks sync-common.js while the blog module is the newer one.
    const staleApp = () => !blogSync && !!life.BlogSync && !life.SyncCommon;
    async function readServerState() {
      if (mode !== "read" || doc?.status !== "saved" || serverBusy) return;
      const token = epoch, id = doc.id, revision = doc.revision, sequence = ++serverSequence;
      serverValue = { id, revision, status: "checking" }; checkPublication(id); showServerStatus();
      try {
        if (!blogSync?.getState) throw new Error("server_unavailable");
        const state = await blogSync.getState(workspaceId, id);
        if (!serverCurrent(token, id, revision, sequence)) return;
        notePublication(id, state);
        serverValue = { id, revision, status: state.status };
      } catch (_) {
        if (!serverCurrent(token, id, revision, sequence)) return;
        serverValue = { id, revision, status: staleApp() ? "refresh" : "error" };
      }
      settlePublication(id);
      showServerStatus();
    }
    async function saveServer() {
      if (serverBusy || mode !== "read" || doc?.status !== "saved" || !valid() || !host?.isConnected) return;
      const token = epoch, id = doc.id, revision = doc.revision, sequence = ++serverSequence;
      serverBusy = true; serverValue = { id, revision, status: "saving" }; showServerStatus(); onDirty();
      try {
        if (!blogSync?.saveDefault) throw new Error("server_unavailable");
        const state = await blogSync.saveDefault(workspaceId, id, { expectedLocalRevision: revision });
        if (!serverCurrent(token, id, revision, sequence)) return;
        notePublication(id, state);
        serverValue = { id, revision, status: state.status };
      } catch (_) {
        if (!serverCurrent(token, id, revision, sequence)) return;
        serverValue = { id, revision, status: staleApp() ? "refresh" : "error" };
      } finally {
        if (sequence === serverSequence) {
          serverBusy = false;
          if (serverCurrent(token, id, revision, sequence)) { showServerStatus(); onDirty(); }
        }
      }
    }
    function viewer(p, caption, origin) {
      closeViewer?.();
      const documentId = doc.id,
        photos = new Map(doc.photos.map((photo) => [photo.id, photo]));
      const items = doc.ops
        .filter((op) => op.insert?.photo)
        .map((op) => ({
          ...op.insert.photo,
          photo: photos.get(op.insert.photo.id),
        }));
      let at = items.findIndex((item) => item.id === p.id),
        full = false,
        source = null,
        closed = false;
      const dialog = el("dialog", null, "photo-viewer"),
        bar = el("div", null, "life-actions"),
        title = el("h2");
      title.id = "photoViewerTitle";
      dialog.setAttribute("aria-labelledby", title.id);
      const position = el("p", "", "life-meta photo-viewer-position");
      position.setAttribute("role", "status");
      const img = el("img"),
        stage = el("div", null, "photo-original");
      stage.tabIndex = 0;
      stage.setAttribute("aria-label", "원본 사진 보기");
      stage.append(img);
      const release = () => {
        if (source) {
          img.removeAttribute("src");
          retireImageURL(source);
          urls.delete(source);
          source = null;
        }
      };
      const show = (index) => {
        at = index;
        const item = items[at],
          photo = item.photo;
        release();
        source = url(shown(photo));
        img.src = source;
        img.alt = item.alt || item.caption || photo.name;
        title.textContent = item.caption || photo.name;
        position.textContent =
          at +
          1 +
          " / " +
          items.length +
          " · " +
          photo.width +
          " × " +
          photo.height +
          (photo.view ? " · 원본 HEIC · 보기용 JPEG로 표시" : " · 원본");
        previous.disabled = at === 0;
        next.disabled = at === items.length - 1;
        stage.scrollTo(0, 0);
      };
      const previous = button("이전 사진", () => show(at - 1)),
        next = button("다음 사진", () => show(at + 1));
      const zoom = button("원본 크기로 보기", () => {
        full = !full;
        stage.classList.toggle("photo-actual-size", full);
        zoom.textContent = full ? "화면에 맞추기" : "원본 크기로 보기";
        zoom.setAttribute("aria-pressed", String(full));
        if (full) stage.focus();
      });
      zoom.setAttribute("aria-pressed", "false");
      const exit = button("사진 닫기", () => dialog.close());
      bar.append(
        previous,
        next,
        zoom,
        button("원본 내려받기", () =>
          download(items[at].photo.blob, items[at].photo.name),
        ),
        exit,
      );
      dialog.append(title, position, bar, stage);
      dialog.addEventListener("keydown", (e) => {
        if (full || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          show(
            Math.max(
              0,
              Math.min(
                items.length - 1,
                at + (e.key === "ArrowRight" ? 1 : -1),
              ),
            ),
          );
        }
      });
      const overflow = document.body.style.overflow;
      document.body.append(dialog);
      document.body.style.overflow = "hidden";
      const cleanup = () => {
        if (closed) return;
        closed = true;
        release();
        dialog.remove();
        document.body.style.overflow = overflow;
        closeViewer = null;
        if (valid() && mode === "read" && doc?.id === documentId) {
          const target =
            host.querySelector(
              '.photo-expand[data-photo-id="' + items[at].id + '"]',
            ) || origin;
          if (target?.isConnected) {
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "nearest" });
          }
        }
      };
      dialog.addEventListener("close", cleanup, { once: true });
      closeViewer = () => {
        dialog.close();
        cleanup();
      };
      show(at);
      dialog.showModal();
      exit.focus();
    }
    function renderRead(target, value, portable = false) {
      const photos = new Map(value.photos.map((p) => [p.id, p]));
      let line = document.createDocumentFragment(),
        listNode = null,
        listKind = null;
      function endLine(attrs = {}) {
        const n = el(
          attrs.header
            ? "h" + (attrs.header + 2)
            : attrs.blockquote
              ? "blockquote"
              : attrs.list
                ? "li"
                : "p",
          null,
          "photo-line",
        );
        if (attrs.align) n.style.textAlign = attrs.align;
        n.append(line);
        if (!n.childNodes.length) n.append(el("br"));
        if (attrs.list) {
          if (!listNode || listKind !== attrs.list) {
            listNode = el(attrs.list === "ordered" ? "ol" : "ul");
            listKind = attrs.list;
            target.append(listNode);
          }
          listNode.append(n);
        } else {
          listNode = null;
          listKind = null;
          target.append(n);
        }
        line = document.createDocumentFragment();
      }
      for (const op of value.ops) {
        if (typeof op.insert !== "string") {
          if (line.childNodes.length) endLine();
          listNode = null;
          listKind = null;
          const p = photos.get(op.insert.photo.id),
            figure = el("figure", null, "photo-read-image"),
            image = el("img"),
            b = portable
              ? el("span")
              : button("", () =>
                  viewer(p, op.insert.photo.caption || op.insert.photo.alt, b),
                );
          b.className = "photo-expand";
          b.dataset.photoId = p.id;
          if (!portable)
            b.setAttribute(
              "aria-label",
              (op.insert.photo.caption || p.name) + " · 사진 크게 보기",
            );
          if (!portable) image.src = url(shown(p));
          else image.dataset.photoId = p.id;
          image.alt = op.insert.photo.alt || op.insert.photo.caption || p.name;
          image.width = (p.view || p).width;
          image.height = (p.view || p).height;
          image.loading = portable ? "eager" : "lazy";
          b.append(image);
          figure.append(b);
          if (op.insert.photo.caption)
            figure.append(el("figcaption", op.insert.photo.caption));
          target.append(figure);
          continue;
        }
        const pieces = op.insert.split("\n");
        pieces.forEach((text, index) => {
          if (text) {
            let n = document.createTextNode(text);
            for (const [key, tag] of [
              ["bold", "strong"],
              ["italic", "em"],
              ["underline", "u"],
            ])
              if (op.attributes?.[key]) {
                const w = el(tag);
                w.append(n);
                n = w;
              }
            // Owner decision 2026-11-04: AI marks show in the owner's reading view; not in the HTML file (portable).
            if (!portable && op.attributes?.author === "ai") { const m = el("span", null, "blog-ai-text"); m.append(n); n = m; }
            if (op.attributes?.link) {
              const a = el("a");
              a.href = op.attributes.link;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.append(n);
              n = a;
            }
            line.append(n);
          }
          if (index < pieces.length - 1) endLine(op.attributes);
        });
      }
      if (line.childNodes.length) endLine();
      if ((value.attachments || []).length)
        target.append(life.PagePostsView.attachments(value.attachments));
    }
    async function exportHTML() {
      const value = outputSnapshot(),
        token = epoch;
      setBusy(true);
      try {
        const page = document.implementation.createHTMLDocument(
          value.title || M.plainText(value).trim().split(/\r?\n/)[0]?.slice(0, 100) || "내 글",
        );
        page.documentElement.lang = "ko";
        const charset = page.createElement("meta");
        charset.setAttribute("charset", "utf-8");
        page.head.prepend(charset);
        const meta = (name, content, http = false) => {
          const n = page.createElement("meta");
          n.setAttribute(http ? "http-equiv" : "name", name);
          n.content = content;
          page.head.append(n);
        };
        meta("viewport", "width=device-width, initial-scale=1");
        meta("referrer", "no-referrer");
        meta(
          "Content-Security-Policy",
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
          true,
        );
        const style = page.createElement("style");
        style.textContent =
          "*{box-sizing:border-box}body{margin:0;color:#18181b;background:#fff;font:18px/1.95 -apple-system,BlinkMacSystemFont,'Noto Sans',sans-serif}article{max-width:680px;margin:auto;padding:40px 24px;overflow-wrap:anywhere}h1{font-size:2em;line-height:1.5}h3{font-size:1.7em}h4{font-size:1.35em}.photo-line{white-space:pre-wrap;margin:0 0 18px}figure{margin:28px 0}img{display:block;width:auto;max-width:100%;height:auto;margin:auto}figcaption{font-size:15px;line-height:1.7;text-align:center;white-space:pre-wrap}blockquote{margin-inline:0;padding-left:20px;border-left:2px solid #ddd}a{color:#3156d3;overflow-wrap:anywhere}.pp-attachments{margin-top:36px}.pp-attachment{padding:18px 0;border-top:1px solid #ddd}.pp-shape,.pp-object-actions{display:none}.pp-attachment-copy{display:flex;flex-direction:column}.pp-attachment-title{display:block;min-height:44px}.life-meta{font-size:14px;color:#66666f}@media(max-width:600px){body{font-size:17px}article{padding:24px 20px}}@media print{article{max-width:none;padding:0}img{max-height:90vh;object-fit:contain}figure{break-inside:avoid}}";
        page.head.append(style);
        const article = page.createElement("article"),
          heading = page.createElement("h1");
        if (value.title.trim()) {
          heading.textContent = value.title;
          article.append(heading);
        } else article.setAttribute("aria-label", "내 글");
        renderRead(article, value, true);
        for (const photo of value.photos) {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(
                new Error("원본 사진을 읽지 못했습니다. 글은 유지됩니다."),
              );
            // A standalone HTML file must open anywhere, so HEIC originals
            // are embedded as their derived JPEG. Originals stay in the ZIP.
            reader.readAsDataURL(shown(photo));
          });
          if (!current(token)) return;
          article.querySelector('img[data-photo-id="' + photo.id + '"]').src =
            data;
        }
        article
          .querySelectorAll("[data-photo-id]")
          .forEach((n) => n.removeAttribute("data-photo-id"));
        article
          .querySelectorAll("a")
          .forEach((n) => n.setAttribute("referrerpolicy", "no-referrer"));
        page.body.append(article);
        if (current(token))
          download(
            new Blob(["<!doctype html>\n", page.documentElement.outerHTML], {
              type: "text/html;charset=utf-8",
            }),
            "haedo-post.html",
          );
      } finally {
        setBusy(false);
      }
    }
    function imageValue(p, info = {}) {
      if (!photoUrls.has(p.id)) photoUrls.set(p.id, url(shown(p)));
      const src = photoUrls.get(p.id);
      photoSources.set(p.id, src);
      return {
        id: p.id,
        caption: info.caption || "",
        alt: info.alt || "",
        src,
      };
    }
    async function insertFiles(files) {
      guard();
      if (!files.length) return;
      const token = epoch,
        position = editor.getSelection(true)?.index ?? editor.getLength() - 1;
      setBusy(true);
      try {
        // At most two files at a time; HEIC conversions are further
        // serialized inside PhotoPost so a 48 MP bitmap is decoded alone.
        const list = [...files],
          incoming = new Array(list.length);
        let nextFile = 0;
        await Promise.all(
          Array.from({ length: Math.min(2, list.length) }, async () => {
            while (nextFile < list.length) {
              const index = nextFile++;
              incoming[index] = await M.readPhoto(list[index], life.Core.id);
            }
          }),
        );
        if (!current(token)) return;
        const next = structuredClone(doc);
        next.photos.push(...incoming);
        let at = position;
        const Delta = root.Quill.import("delta"),
          delta = new Delta().retain(at).insert("\n");
        incoming.forEach((p) =>
          delta
            .insert({ photo: { id: p.id, caption: "", alt: "" } })
            .insert("\n"),
        );
        next.ops = new Delta(doc.ops).compose(delta).ops;
        M.validate(next);
        doc.photos.push(...incoming);
        editor.enable(true);
        editor.history.cutoff();
        editor.insertText(at++, "\n", "user");
        for (const p of incoming) {
          editor.insertEmbed(at++, "photo", imageValue(p), "user");
          editor.insertText(at++, "\n", "user");
        }
        editor.setSelection(at, 0, "silent");
        editor.history.cutoff();
      } finally {
        setBusy(false);
      }
      await persist();
    }
    function selectPhoto(node) {
      guard();
      if (selected !== node) editor.history.cutoff();
      selected = node;
      const value = Photo.value(node);
      captionInput.value = value.caption;
      altInput.value = value.alt;
      inspector.hidden = false;
      node.append(inspector);
      const photo = doc.photos.find((p) => p.id === value.id);
      inspector.querySelector(".photo-original-info").textContent =
        photo.width + " × " + photo.height + " · 원본 보관";
      host
        .querySelectorAll(".photo-block")
        .forEach((n) => n.classList.toggle("photo-selected", n === node));
    }
    function changePhoto() {
      guard();
      if (!selected?.isConnected) return;
      const value = Photo.value(selected),
        p = doc.photos.find((p) => p.id === value.id);
      // Cleaned here (not while an IME composition is open) so the caption can
      // never make the draft unstorable.
      const next = {
        ...value,
        caption: composing ? captionInput.value : M.cleanText(captionInput.value),
        alt: composing ? altInput.value : M.cleanText(altInput.value, false),
      };
      if (!composing) {
        for (const [input, text] of [[captionInput, next.caption], [altInput, next.alt]])
          if (input.value !== text) {
            const end = Math.min(input.selectionEnd ?? text.length, text.length);
            input.value = text;
            if (document.activeElement === input) input.setSelectionRange(end, end);
          }
      }
      if (!p || (next.caption === value.caption && next.alt === value.alt)) return;
      const blot = root.Quill.find(selected),
        patch = { caption: next.caption, alt: next.alt };
      blot.updateContent(patch);
      blot.scroll.emitEmbedUpdate(blot, patch);
    }
    function closePhoto(focus = true) {
      if (!selected) return;
      guard();
      changePhoto();
      const at = editor.getIndex(root.Quill.find(selected));
      editor.history.cutoff();
      inspector.hidden = true;
      host.append(inspector);
      selected.classList.remove("photo-selected");
      selected = null;
      if (focus)
        editor.setSelection(
          Math.min(at + 1, editor.getLength() - 1),
          0,
          "user",
        );
    }
    function movePhoto(direction) {
      guard();
      if (!selected?.isConnected) return;
      const blot = root.Quill.find(selected),
        at = editor.getIndex(blot),
        lines = editor.getLines(),
        i = lines.indexOf(blot),
        peer = lines[i + direction];
      if (!peer) return;
      let destination = editor.getIndex(peer);
      if (direction > 0) destination += peer.length() - 1;
      const value = Photo.value(selected),
        p = doc.photos.find((p) => p.id === value.id);
      inspector.hidden = true;
      host.append(inspector);
      editor.history.cutoff();
      editor.deleteText(at, 1, "user");
      editor.insertEmbed(destination, "photo", imageValue(p, value), "user");
      editor.history.cutoff();
      selected = host.querySelector('[data-photo-id="' + p.id + '"]');
      if (selected) selectPhoto(selected);
      selected?.scrollIntoView({ block: "nearest" });
    }
    function renderEditor() {
      const renderedDoc = doc, renderedEpoch = epoch;
      const acceptsInput = () => current(renderedEpoch) && doc === renderedDoc && mode === "edit";
      const form = el("section", null, "photo-editor"),
        // A one-line title that wraps (long Korean titles on phones) instead
        // of scrolling sideways inside an input.
        title = el("textarea");
      title.id = "photoTitle";
      title.rows = 1;
      title.setAttribute("enterkeyhint", "next");
      title.value = doc.title;
      title.placeholder = "제목 (선택)";
      title.maxLength = 500;
      title.setAttribute("aria-label", "글 제목");
      const fitTitle = () => {
        title.style.height = "auto";
        title.style.height = title.scrollHeight + "px";
      };
      // The title stays one line of text: Enter goes on to the body and
      // pasted line breaks become spaces. IME composition is never altered.
      title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || !acceptsInput()) return;
        e.preventDefault();
        editor?.focus();
      });
      titleInput = title;
      // Line breaks become spaces and characters a post cannot hold are removed
      // (a manual line break from Word becomes a space), without moving the caret
      // past the end. Never during an IME composition.
      const flattenTitle = () => {
        const clean = M.cleanText(title.value, false).replace(/[\r\n]+/g, " ");
        if (clean === title.value) return;
        const end = title.selectionEnd;
        title.value = clean;
        title.setSelectionRange(Math.min(end, title.value.length), Math.min(end, title.value.length));
      };
      title.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain");
        if (!text || M.cleanText(text, false).replace(/[\r\n]/g, "") === text || !acceptsInput()) return;
        e.preventDefault();
        // setRangeText does not apply maxLength: insert only what still fits, so a
        // long multi-line paste can never make the title (and every save) invalid.
        const room = title.maxLength - (title.value.length - (title.selectionEnd - title.selectionStart));
        let insert = M.cleanText(text, false).replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, Math.max(0, room));
        if (/[\uD800-\uDBFF]$/.test(insert)) insert = insert.slice(0, -1);  // never split a surrogate pair
        title.setRangeText(insert, title.selectionStart, title.selectionEnd, "end");
        title.dispatchEvent(new Event("input", { bubbles: true }));
      });
      title.addEventListener("input", (e) => {
        if (!acceptsInput()) return;
        if (!composing && !e.isComposing) flattenTitle();
        doc.title = title.value;
        fitTitle();
        mark();
      });
      title.addEventListener("compositionstart", () => {
        if (!acceptsInput()) return;
        composing = true;
        showStatus();
      });
      title.addEventListener("compositionend", () => {
        if (!acceptsInput()) return;
        composing = false;
        // A composed line break (some IMEs commit one) is cleaned only now, after composition.
        flattenTitle();
        doc.title = title.value;
        fitTitle();
        mark();
      });
      const sticky = el("div", null, "photo-editor-tools"),
        commands = el("div", null, "photo-commandbar");
      const more = el("details", null, "photo-more life-details");
      const menu = el("div", null, "photo-more-menu");
      more.append(iconControl(el("summary"), "more", "더 보기"), menu);
      menu.append(
        button("사진 포함 백업", backup),
        button("HTML 읽기 파일 받기", exportHTML),
        button("사본으로 이어 쓰기", duplicate),
      );
      // Hiding belongs to the saved post (its read view has it). In a revision
      // it used to hide the editing copy and leave the post in the list.
      if (!doc.replaces) menu.append(button("목록에서 숨기기", () => archive(true)));
      menu.append(button("초안 다시 저장", persist));
      if (doc.replaces) menu.append(button("새 글로 저장", () => finish(true)));
      const discard = button(doc.replaces ? "수정 취소" : "초안 삭제", discardDraft);
      discard.dataset.postAction = "discard";
      discard.classList.add("photo-delete");
      menu.append(discard);
      // D1 (soft redesign): one quiet line — close, the privacy pill that
      // opens 글 정보, the autosave state, then more and the one save action.
      const commandState = el("div", null, "photo-command-state"),
        save = button("글 저장", () => finish());
      const scope = el("span", "비공개 · 저장하면 계정에 비공개로 보관", "life-sr-only");
      scope.id = "photoCommandScope";
      commandState.append(privacyPill(), status, scope);
      save.classList.add("photo-save");
      save.textContent = "저장";
      save.setAttribute("aria-label", "글 저장");
      save.title = "글 저장 · 계정에 비공개로 보관합니다";
      save.setAttribute("aria-describedby", scope.id);
      commands.append(iconControl(button("닫기", list), "close", "닫기"), commandState, more, save);
      sticky.append(commands);
      if (doc.replaces && blogSync?.getState) {
        // Revising a saved post: the pill says whether that post has a public copy.
        const target = doc.replaces.id;
        checkPublication(target);
        const settle = (state) => {
          if (!acceptsInput() || doc.replaces?.id !== target) return;
          notePublication(target, state);
          settlePublication(target);
          updatePill();
          refreshInfo?.();
        };
        blogSync.getState(workspaceId, target).then(settle, () => settle(null));
      }
      recoveryActions = el("div", null, "photo-recovery-actions");
      recoveryActions.hidden = true;
      recoveryActions.append(
        button("다시 보관", persist),
        button("현재 입력 백업", backup),
      );
      const recoverCopy = button("현재 입력을 새 초안으로 보관", duplicate);
      recoverCopy.classList.add("photo-recovery-copy");
      recoveryActions.append(recoverCopy);
      sticky.append(recoveryActions);
      if (offer) {
        // Input this device kept when the draft could not be stored (or the page
        // closed first). The editor waits for the choice so neither is overwritten.
        const bar = el("div", null, "photo-recovered"),
          taken = when(offer.savedAt),
          apart = !(doc.revision === 0 || (offer.id === doc.id && offer.revision === doc.revision));
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "이 기기에 남아 있는 입력");
        bar.append(
          el("p", "보관하지 못한 입력이 이 기기에 남아 있습니다" + (taken ? " · " + taken : "") +
            (apart ? " · 이 초안은 그 뒤에 바뀌어 새 초안으로 복구합니다" : ""), "photo-recovered-text"),
          button(apart ? "새 초안으로 복구" : "복구", restoreCopy),
          button("버리기", discardCopy),
        );
        bar.querySelector("button").classList.add("photo-recovered-restore");
        sticky.append(bar);
        title.readOnly = true;
      }
      const toolbar = el("div", null, "photo-toolbar");
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "본문 서식");
      const primaryFormats = el("span", null, "photo-format-primary"),
        extraFormats = el("details", null, "photo-format-options"),
        formatSummary = el("summary"),
        formatPanel = el("span", null, "photo-format-panel");
      formatSummary.setAttribute("aria-label", "추가 서식");
      formatSummary.title = "추가 서식";
      // Phones show the "type" picture alone; wider screens the word 서식.
      const formatIcon = glyph("type"), formatChevron = glyph("chevron");
      formatIcon.classList.add("photo-format-icon");
      formatChevron.classList.add("photo-format-chevron");
      formatSummary.append(formatIcon, el("span", "서식", "photo-format-word"), formatChevron);
      extraFormats.append(formatSummary, formatPanel);
      const heading = el("select");
      heading.className = "ql-header";
      heading.setAttribute("aria-label", "문단 종류");
      for (const [value, name] of [
        ["", "본문"],
        ["1", "큰 제목"],
        ["2", "작은 제목"],
      ]) {
        const o = el("option", name);
        o.value = value;
        heading.append(o);
      }
      formatPanel.append(heading);
      for (const [key, name, value] of [
        ["bold", "굵게"],
        ["italic", "기울임"],
        ["underline", "밑줄"],
        ["blockquote", "인용"],
        ["list", "글머리 목록", "bullet"],
        ["list", "번호 목록", "ordered"],
        ["align", "가운데 정렬", "center"],
        ["link", "링크"],
      ]) {
        const b = el("button");
        b.type = "button";
        b.className = "ql-" + key;
        if (value) b.value = value;
        b.setAttribute("aria-label", name);
        b.title = name;
        (key === "bold" || key === "link" ? primaryFormats : formatPanel).append(b);
      }
      // One control: a selection is marked or unmarked as AI text; without a
      // selection it arms the next paste. Never applied automatically.
      authorButton = iconControl(button("AI 글 표시", toggleAuthorship), "sparkle", "AI 글 표시");
      authorButton.classList.add("photo-author-toggle");
      authorButton.setAttribute("aria-pressed", "false");
      authorButton.title = "AI 글 표시 · 선택이 없으면 다음 붙여넣기";
      // In the extra formats: the one-row toolbar has no room for another
      // 44px control at 320–393px without wrapping the photo label.
      formatPanel.append(authorButton);
      const undo = button("실행 취소", () => editor.history.undo()),
        redo = button("다시 실행", () => editor.history.redo());
      const history = el("span", null, "photo-history");
      history.append(iconControl(undo, "undo", "실행 취소"), iconControl(redo, "redo", "다시 실행"));
      // Touch screens: put the keyboard away without leaving the post.
      const hideKeyboard = iconControl(el("button"), "keyboard", "키보드 닫기");
      hideKeyboard.type = "button";
      hideKeyboard.classList.add("photo-keyboard-close");
      hideKeyboard.addEventListener("pointerdown", (e) => e.preventDefault());
      hideKeyboard.addEventListener("click", () => {
        const active = document.activeElement;
        if (active && form.contains(active)) active.blur();
      });
      const photoInput = el("input");
      photoInput.type = "file";
      photoInput.multiple = true;
      // Listing HEIC keeps iOS from converting the original on selection.
      photoInput.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif";
      photoInput.hidden = true;
      photoInput.id = "photoFiles";
      photoInput.setAttribute("aria-label", "원본 사진 선택");
      photoInput.addEventListener("change", () => {
        const files = [...photoInput.files];
        photoInput.value = "";
        run(() => insertFiles(files));
      });
      const insertPhoto = button("사진", () => photoInput.click());
      insertPhoto.classList.add("photo-insert-photo");
      insertPhoto.prepend(glyph("image"));
      // The editor adapter lives at the tool registration boundary so a future
      // editor can replace it without changing the suggestion panel.
      const suggest = iconControl(button("AI 제안", () => {
        if (imeActive()) throw new Error("입력을 마친 뒤 다시 눌러 주세요.");
        guard();
        if (!life.WritingAI || !life.WritingAIUI?.open)
          throw new Error("AI 제안을 준비하지 못했습니다. 앱을 새로고침한 뒤 다시 열어 주세요.");
        settleAuthorship();
        const range = editor.getSelection() || editor.selection?.savedRange;
        if (!range?.length) throw new Error(life.WritingAI.MESSAGES.ai_selection_required);
        if (range.index + range.length >= editor.getLength())
          throw new Error("마지막 빈 줄을 제외하고 AI에 보낼 글을 선택해 주세요.");
        const selectionOps = editor.getContents(range.index, range.length).ops;
        if (selectionOps.some(op => typeof op.insert !== "string"))
          throw new Error(life.WritingAI.MESSAGES.ai_selection_has_photo);
        const target = doc, targetEditor = editor, token = epoch, version = dirtyTick;
        const selectedRange = { index: range.index, length: range.length };
        const isTarget = () => current(token) && doc === target && editor === targetEditor && mode === "edit";
        form.aiSuggestions?.dispose();
        form.aiSuggestions = life.WritingAIUI.open({
          selectionText: selectionOps.map(op => op.insert).join(""),
          tasks: ["polish", "shorten", "continue", "custom"],
          isCurrent: isTarget,
          onApply(result, accepted, { apply }) {
            guard();
            if (imeActive()) throw new Error(life.WritingAI.MESSAGES.ai_composing);
            const now = editor.selection?.savedRange;
            if (!isTarget() || dirtyTick !== version || !now || now.index !== selectedRange.index || now.length !== selectedRange.length)
              throw new Error(life.WritingAI.MESSAGES.ai_selection_changed);
            const before = editor.getContents();
            const next = apply(before.ops, { ...selectedRange, original: result.original,
              ranges: result.ranges, accepted, composing: imeActive() });
            // Validate before changing the editor; preserve the normal autosave,
            // authorship and one-step undo paths after accepting a suggestion.
            M.validate({ ...doc, ops: next.ops });
            editor.history.cutoff();
            aiInserting = true;
            try { editor.updateContents(before.diff(new Delta(next.ops)), "user"); }
            finally { aiInserting = false; editor.history.cutoff(); }
            editor.setSelection(next.selection.index, next.selection.length, "silent");
          },
          onClose() { if (isTarget()) suggest.focus(); },
        });
      }), "edit", "AI 제안");
      suggest.id = "photoAI";
      suggest.addEventListener("pointerdown", event => event.preventDefault());
      // Preserve the wide toolbar; only the narrow phone row moves its link
      // into additional formats. Move the existing control, never recreate it.
      const linkControl = primaryFormats.querySelector(".ql-link");
      const narrowTools = root.matchMedia("(max-width: 390px)");
      const placeLink = () => {
        const destination = narrowTools.matches ? formatPanel : primaryFormats;
        if (linkControl.parentNode !== destination) {
          const focused = document.activeElement === linkControl;
          destination.append(linkControl);
          if (focused) (narrowTools.matches && !extraFormats.open ? formatSummary : linkControl).focus({ preventScroll: true });
        }
      };
      placeLink(); narrowTools.addEventListener("change", placeLink);
      form.disposeAITool = () => {
        narrowTools.removeEventListener("change", placeLink);
        form.aiSuggestions?.dispose();
      };
      const toolItems = [
        ["photo", insertPhoto],
        ["inline", primaryFormats],
        ["ai", suggest],
        ["formats", extraFormats],
        ["history", history],
        ["keyboard", hideKeyboard],
      ];
      for (const [id, node] of toolItems) {
        node.dataset.tool = id;
        toolbar.append(node);
      }
      toolbar.append(photoInput);
      const area = el("div", null, "photo-quill");
      // The tools float at the bottom of the screen (above the keyboard on
      // phones) instead of a row between the title and the text.
      toolbar.classList.add("photo-toolbar-floating");
      form.append(sticky, title, area, toolbar);
      host.append(form);
      const releaseKeyboard = keyboardOffset(form);
      let titleWidth = 0;
      const titleSize = new ResizeObserver(() => {
        if (title.clientWidth === titleWidth) return;
        titleWidth = title.clientWidth;
        fitTitle();
      });
      titleSize.observe(title);
      releaseViewport = () => {
        releaseKeyboard?.();
        titleSize.disconnect();
      };
      editor = new root.Quill(area, {
        theme: "snow",
        placeholder: "어떤 이야기를 남길까요?",
        formats: [
          "bold",
          "italic",
          "underline",
          "header",
          "blockquote",
          "list",
          "align",
          "link",
          "author",
          "photo",
        ],
        modules: {
          toolbar,
          history: { userOnly: true, delay: 700 },
          // A post has bullet and numbered lists only. "[ ] " and "[x] " stay
          // the characters the writer typed instead of becoming a checklist the
          // post cannot hold; "- ", "* " and "1. " still start a list.
          keyboard: { bindings: { "list autofill": { prefix: /^\s*?(\d+\.|-|\*)$/ } } },
        },
      });
      if (offer) editor.enable(false);
      // The link box takes an address without a scheme as https and refuses
      // anything that is not an http(s) address, with the reason, before it
      // reaches the text.
      const tooltip = editor.theme?.tooltip;
      if (tooltip?.save && tooltip.textbox) {
        const saveLink = tooltip.save.bind(tooltip);
        tooltip.textbox.addEventListener("input", () => tooltip.textbox.removeAttribute("aria-invalid"));
        tooltip.save = () => {
          if (tooltip.root.getAttribute("data-mode") === "link") {
            const address = M.safeLink(tooltip.textbox.value);
            if (!address) {
              tooltip.textbox.setAttribute("aria-invalid", "true");
              tooltip.textbox.focus();
              authorNote = "링크는 http·https 주소만 넣을 수 있어요"; authorNoteKept = true;
              showStatus(error);
              return;
            }
            tooltip.textbox.removeAttribute("aria-invalid");
            tooltip.textbox.value = address;
          }
          saveLink();
        };
      }
      for (const n of toolbar.querySelectorAll(".ql-picker-label")) {
        n.setAttribute("aria-label", "문단 종류");
        n.setAttribute("title", "문단 종류");
      }
      for (const n of toolbar.querySelectorAll(".ql-picker-item")) {
        n.setAttribute(
          "aria-label",
          { 1: "큰 제목", 2: "작은 제목" }[n.dataset.value] || "본문",
        );
      }
      const photos = new Map(doc.photos.map((p) => [p.id, p]));
      editor.setContents(
        doc.ops.map((op) =>
          typeof op.insert === "string"
            ? op
            : {
                ...op,
                insert: {
                  photo: imageValue(
                    photos.get(op.insert.photo.id),
                    op.insert.photo,
                  ),
                },
              },
        ),
        "silent",
      );
      editor.history.clear();
      editor.root.setAttribute("aria-label", "글 본문");
      editor.root.setAttribute("role", "textbox");
      editor.root.setAttribute("aria-multiline", "true");
      editor.root.setAttribute("spellcheck", "true");
      editor.on("text-change", (delta, _old, source) => {
        if (!acceptsInput()) return;
        trackAuthorship(delta, source);
        doc.ops = editor.getContents().ops;
        mark();
      });
      editor.on("editor-change", () => {
        if (acceptsInput()) syncAuthorButton();
      });
      editor.root.addEventListener("compositionstart", () => {
        if (!acceptsInput()) return;
        composing = true;
        showStatus();
      });
      editor.root.addEventListener("compositionend", () => {
        if (!acceptsInput()) return;
        composing = false;
        mark();
        scheduleSettle();
      });
      form.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !aiPending || e.isComposing || !acceptsInput()) return;
        e.preventDefault();
        e.stopPropagation();
        setAiPending(false);
      });
      editor.root.addEventListener("click", (e) => {
        if (inspector.contains(e.target)) return;
        const n = e.target.closest(".photo-block");
        run(() => (n ? selectPhoto(n) : closePhoto(false)));
      });
      editor.root.addEventListener(
        "keydown",
        (e) => {
          if (inspector.contains(e.target)) return;
          const n = e.target.closest(".photo-block");
          if (n && ["Enter", " "].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            selectPhoto(n);
            captionInput.focus();
          }
        },
        { capture: true },
      );
      editor.root.addEventListener(
        "paste",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          // The armed state covers exactly one paste, whatever it contains.
          const ai = aiPending;
          if (ai) setAiPending(false, false);
          const files = [...(e.clipboardData?.files || [])];
          if (files.length) {
            run(() => insertFiles(files));
            return;
          }
          // Characters a post cannot hold never enter the body: a manual line
          // break from Word or PowerPoint (U+000B) becomes a line break.
          const text = M.cleanText(e.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n"),
            range = editor.getSelection(true);
          if (text) {
            if (range.length)
              editor.deleteText(range.index, range.length, "user");
            if (ai) {
              aiInserting = true;
              try {
                editor.insertText(range.index, text, { author: "ai" }, "user");
              } finally {
                aiInserting = false;
              }
            } else {
              // Unchanged plain paste. Inside AI text it inherits the mark and
              // is settled as the owner's text like typing.
              editor.insertText(range.index, text, "user");
            }
            editor.setSelection(range.index + text.length, 0, "silent");
            if (ai) {
              authorNote = "붙여넣은 글을 AI 글로 표시했어요"; authorNoteKept = false;
              syncAuthorButton();
              showStatus(error);
            }
          }
        },
        { capture: true },
      );
      editor.root.addEventListener("dragover", (e) => e.preventDefault());
      editor.root.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) run(() => insertFiles(files));
      });
      inspector = el("section", null, "photo-inspector");
      inspector.hidden = true;
      inspector.setAttribute("aria-label", "선택한 사진 편집");
      const captionLabel = el("label", "사진 설명"),
        altLabel = el("label", "대체 텍스트");
      captionLabel.className = "photo-caption-label";
      captionInput = el("textarea");
      captionInput.rows = 2;
      captionInput.placeholder = "사진에 담긴 이야기를 남겨 보세요.";
      captionInput.setAttribute("aria-label", "사진 설명");
      captionInput.maxLength = 2000;
      altInput = el("input");
      altInput.setAttribute("aria-label", "사진 대체 텍스트");
      altInput.maxLength = 2000;
      for (const input of [captionInput, altInput]) {
        input.addEventListener("compositionstart", (e) => {
          e.stopPropagation();
          if (!acceptsInput()) return;
          composing = true;
          showStatus();
        });
        input.addEventListener("compositionend", (e) => {
          e.stopPropagation();
          if (!acceptsInput()) return;
          composing = false;
          showStatus(error);
          run(changePhoto);
        });
        input.addEventListener("input", (e) => {
          e.stopPropagation();
          if (!acceptsInput()) return;
          if (!composing) run(changePhoto);
        });
        input.addEventListener("blur", () => editor?.history.cutoff());
      }
      for (const event of ["keydown", "paste", "drop"])
        inspector.addEventListener(event, (e) => {
          e.stopPropagation();
          if (event === "keydown" && e.key === "Escape") {
            e.preventDefault();
            run(() => closePhoto());
          }
          if (
            event === "keydown" &&
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            ["z", "y"].includes(e.key.toLowerCase()) &&
            !composing &&
            !e.isComposing
          ) {
            e.preventDefault();
            const input = e.target,
              start = input.selectionStart,
              end = input.selectionEnd;
            run(() => {
              guard();
              editor.history[
                e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo"
              ]();
              if (input.isConnected && input.matches("input,textarea")) {
                input.focus({ preventScroll: true });
                input.setSelectionRange(
                  Math.min(start, input.value.length),
                  Math.min(end, input.value.length),
                );
              }
            });
          }
        });
      captionLabel.append(captionInput);
      altLabel.append(altInput);
      const settings = el("details", null, "life-details photo-settings");
      settings.append(
        el("summary", "사진 설정"),
        el("p", "", "life-meta photo-original-info"),
        altLabel,
        button("사진 앞으로", () => movePhoto(-1)),
        button("사진 뒤로", () => movePhoto(1)),
        button("사진 빼기", () => {
          guard();
          if (selected?.isConnected) {
            inspector.hidden = true;
            host.append(inspector);
            editor.history.cutoff();
            editor.deleteText(
              editor.getIndex(root.Quill.find(selected)),
              1,
              "user",
            );
            editor.history.cutoff();
            selected = null;
            inspector.hidden = true;
          }
        }),
      );
      inspector.append(
        captionLabel,
        settings,
        button("사진 편집 닫기", () => closePhoto()),
      );
      host.append(inspector);
      const attachments = el("section", null, "photo-attachments");
      form.append(attachments);
      attachmentUI = life.PhotoPostAttachments.create({
        host: attachments,
        storage,
        workspaceId,
        getValues: () => doc.attachments || [],
        isCurrent: valid,
        onDirty,
        report: showStatus,
        onChange: (values) => {
          guard();
          // The attachments' own rules; the body is judged at 글 저장, not here.
          life.PagePosts.validateAttachments(values);
          doc.attachments = structuredClone(values);
          mark();
        },
      });
      const recovery = el("details", null, "life-details");
      recovery.append(
        el("summary", "저장 충돌 복구"),
        button("내 입력을 새 초안으로 보관", duplicate),
      );
      menu.append(recovery);
    }
    // While a post is open for editing, background sync holds it so a change
    // from another device cannot replace unsaved input; it applies after release.
    let heldId = null, releaseHeld = null;
    function syncHold() {
      const want = host && valid() && mode === "edit" && doc?.id ? doc.id : null;
      if (want === heldId) return;
      try { releaseHeld?.(); } catch (_) {}
      heldId = want; releaseHeld = null;
      if (want) try { releaseHeld = blogSync?.holdPost?.(workspaceId, want) || null; } catch (_) {}
    }
    function render() {
      syncHold();
      if (!host || !valid()) return;
      cancelAutosave();
      cleanup();
      if (mode !== "edit") { offer = null; keptTick = -1; unstored = null; }
      const token = ++epoch;
      serverSequence++; serverBusy = false;
      serverStatus = serverActions = null;
      host.replaceChildren();
      host.dataset.mode = mode;
      onModeChange({ mode, id: shownId() });
      status = el("p", "", "life-help photo-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-atomic", "true");
      const check = glyph("check");
      check.classList.add("photo-status-check");
      statusText = el("span", "", "photo-status-text");
      statusDetail = el("span", "", "life-sr-only");
      status.append(check, statusText, statusDetail);
      host.append(status);
      if (mode === "list") {
        const toolbar = el("div", null, "life-actions");
        const file = el("input");
        file.type = "file";
        file.accept = ".zip,application/zip";
        file.hidden = true;
        file.setAttribute("aria-label", "사진 글 ZIP 백업");
        file.addEventListener("change", () => {
          const input = file.files[0];
          file.value = "";
          if (!input) return;
          run(async () => {
            const t = epoch;
            await beforeOpen();
            if (!current(t)) return;
            setBusy(true);
            try {
              const candidate = await M.readBackup(input, life.Core.id);
              for (const p of candidate.photos) {
                // HEIC originals are verified by signature and digest in
                // readBackup; their derived JPEG must decode at its size.
                const shownPhoto = p.view || p;
                const checked = await M.readPhoto(
                  new File([shown(p)], p.name, { type: shownPhoto.type }),
                  () => p.id,
                );
                if (checked.width !== shownPhoto.width || checked.height !== shownPhoto.height)
                  throw new Error("사진 해상도 정보가 실제 원본과 다릅니다.");
              }
              if (!current(t)) return;
              const review = el("section", null, "photo-import");
              review.setAttribute("aria-label", "사진 글 복원 확인");
              review.append(
                el("h3", candidate.title || "가져올 글 확인"),
                el(
                  "p",
                  candidate.photos.length +
                    "장 · 첨부 " +
                    candidate.attachments.length +
                    "개 · 원본 포함 · 비공개 새 초안으로 복원",
                ),
              );
              if (candidate.attachments.length)
                review.append(
                  life.PagePostsView.attachments(candidate.attachments),
                );
              review.append(
                button("새 초안으로 복원", async () => {
                  setBusy(true);
                  try {
                    const result = await storage.savePhotoPost(
                      workspaceId,
                      candidate,
                      0,
                    );
                    if (!current(t)) return;
                    doc = result;
                    mode = "edit";
                    resetTicks();
                    error = null;
                    render();
                  } finally {
                    setBusy(false);
                  }
                }),
                button("복원 취소", () => review.remove()),
              );
              host.querySelector(".photo-import")?.remove();
              host.append(review);
              review.tabIndex = -1;
              review.focus();
            } finally {
              setBusy(false);
            }
          });
        });
        const files = el("details", null, "life-details photo-files");
        files.append(
          el("summary", "사진 글 파일"),
          button("사진 글 백업 열기", () => file.click()),
          file,
        );
        toolbar.append(files);
        host.append(toolbar);
        const scope = el("details", null, "life-details");
        scope.append(
          el("summary", "사진 글 보관 안내"),
          el(
            "p",
            "글 저장 시 본문과 사진 원본의 비공개 서버 보관을 요청합니다. 보관 결과는 글의 서버 상태에서 확인하세요. 초안도 계정에 자동 저장되어 모든 기기에서 이어 쓸 수 있으며 공개는 따로 선택합니다. 일반 자료·구성 JSON에는 포함되지 않습니다. 다시 편집할 사본은 사진 포함 ZIP으로, 읽기만 할 파일은 HTML로 받으세요. 둘 다 원본 사진의 해상도와 바이트를 줄이지 않습니다. 사진 ZIP에는 인용 본문·출처 URL이 남지만 원문 근거 연결 정보는 포함되지 않습니다. 정확한 근거는 글의 더보기나 설정에서 근거 포함 파일로 보관하세요. 다운로드 후에는 기기의 파일 앱에서 저장 여부를 확인하세요.",
            "life-help",
          ),
        );
        files.append(scope);
        const list = el("div", null, "photo-feed");
        if (!feedListener) host.append(list);
        const retained = el("details", null, "life-details photo-retained"),
          retainedTitle = el("summary", "초안·숨긴 글");
        const drafts = el("div", null, "photo-draft-list"),
          archived = el("div", null, "photo-archived-list");
        const draftHeading = el("h3", "작성 중인 글"),
          archiveHeading = el("h3", "숨긴 글"),
          archiveHelp = el(
            "p",
            "숨긴 글과 사진은 지우지 않고 그대로 남습니다. 글을 열어 목록에 다시 보이게 할 수 있습니다.",
            "life-help",
          );
        retained.hidden = true;
        retained.append(
          retainedTitle,
          draftHeading,
          drafts,
          archiveHeading,
          archiveHelp,
          archived,
        );
        host.append(retained);
        storage
          .listPhotoPosts(workspaceId)
          .then((rows) => {
            if (!current(token)) return;
            const covers = new Map();
            for (const item of rows.sort((a, b) =>
              b.updatedAt.localeCompare(a.updatedAt),
            )) {
              const b = button("", () => open(item.id));
              b.classList.add("photo-entry");
              b.dataset.photoPostId = item.id;
              b.dataset.postDate = item.updatedAt;
              b.append(
                el(
                  "span",
                  item.status === "draft"
                    ? "작성 중"
                    : item.photos
                      ? "비공개 · 사진 " + item.photos + "장"
                      : "비공개",
                  "life-meta",
                ),
              );
              if (item.title.trim()) b.append(el("strong", item.title));
              b.append(el(
                  "span",
                  item.body.trim().slice(0, 120),
                  "photo-entry-excerpt",
                ));
              (item.archived
                ? archived
                : item.status === "draft"
                  ? drafts
                  : list
              ).append(b);
              if (item.photos) {
                const cover = el("img", null, "photo-entry-cover");
                cover.alt = "";
                cover.width = 96;
                cover.height = 72;
                cover.loading = "lazy";
                b.prepend(cover);
                (coverObserver ||= new IntersectionObserver((entries) => {
                  for (const entry of entries)
                    if (entry.isIntersecting) {
                      coverObserver?.unobserve(entry.target);
                      storage
                        .readPhotoPost(workspaceId, entry.target.dataset.postId)
                        .then((value) => {
                          if (!current(token) || !entry.target.isConnected)
                            return;
                          const first = value.ops.find((op) => op.insert?.photo)
                            ?.insert.photo.id;
                          const photo = value.photos.find(
                            (p) => p.id === first,
                          );
                          if (!photo || covers !== feedCovers) return;
                          const u = URL.createObjectURL(shown(photo));
                          covers.set(u, entry.target);
                          entry.target.src = u;
                        })
                        .catch(() => {
                          if (current(token)) entry.target.remove();
                        });
                    }
                })).observe(cover);
                cover.dataset.postId = item.id;
              }
            }
            retained.hidden =
              !drafts.children.length && !archived.children.length;
            retainedTitle.textContent =
              "초안 " +
              drafts.children.length +
              " · 숨긴 글 " +
              archived.children.length;
            draftHeading.hidden = !drafts.children.length;
            archiveHeading.hidden = archiveHelp.hidden =
              !archived.children.length;
            const previous = feedCovers;
            feedCovers = covers;
            try {
              feedListener?.([...list.children]);
            } finally {
              // The delivered rows replace the previous list in listHost. A
              // previous cover still on screen joins this list instead.
              for (const [u, image] of previous)
                if (image.isConnected && image.getAttribute("src") === u) {
                  covers.set(u, image);
                  previous.delete(u);
                }
              retireCovers(previous);
            }
            statusText.textContent = "";
          })
          .catch((e) => {
            if (current(token)) {
              showStatus(e);
              host.append(button("사진 글 목록 다시 읽기", () => render()));
            }
          });
      } else if (mode === "edit") renderEditor();
      else {
        // D1 (soft redesign): one line above the title — the privacy pill that
        // opens 글 정보, then edit, backup and more. Date and save state move
        // to the end of the post.
        const actions = el("div", null, "life-actions photo-read-actions");
        actions.classList.toggle("photo-read-standalone", standalone);
        if (readBackAction)
          actions.append(iconControl(button(readBackText, async () => {
            const token = epoch; await flush();
            if (current(token)) await readBackAction();
          }), "back", readBackText));
        else if (!standalone)
          actions.append(iconControl(button("사진 글 목록", list), "back", "사진 글 목록"));
        actions.append(privacyPill());
        const tools = el("div", null, "photo-read-tools");
        if (doc.archived) tools.append(button("목록에 다시 보이기", () => archive(false)));
        else {
          const edit = button("글 수정", () => open(doc.id, true));
          edit.classList.add("photo-read-edit");
          edit.replaceChildren(glyph("edit"), el("span", "수정"));
          edit.setAttribute("aria-label", "글 수정");
          edit.title = "글 수정";
          tools.append(edit);
        }
        tools.append(iconControl(button("사진 포함 백업", backup), "download", "사진 포함 백업"));
        const more = el("details", null, "photo-more life-details"),
          menu = el("div", null, "photo-more-menu");
        more.append(iconControl(el("summary"), "more", "더 보기"), menu);
        if (doc.status === "saved") {
          for (const [label, callback, action] of [["이 글 공개·보관", onManageServer, "manage"], ["근거 포함 파일", onPreservePost, "preserve"]]) {
            if (typeof callback !== "function") continue;
            const focusKey = "photo:" + action + ":" + doc.id;
            const control = button(label, () => openPostTask(callback, focusKey));
            control.dataset.focusKey = focusKey;
            control.dataset.postAction = action;
            menu.append(control);
          }
        }
        menu.append(
          button("HTML 읽기 파일 받기", exportHTML),
          button("사본으로 이어 쓰기", duplicate),
        );
        if (!doc.archived)
          menu.append(button("목록에서 숨기기", () => archive(true)));
        const remove = button("삭제", removePost);
        remove.dataset.postAction = "delete";
        remove.classList.add("photo-delete");
        menu.append(remove);
        tools.append(more);
        actions.append(tools);
        host.append(actions);
        const article = el("article", null, "photo-article"),
          heading = el("h2", doc.title || (doc.photos.length ? "사진 " + doc.photos.length + "장" : "내 글"), "photo-read-heading");
        if (!doc.title.trim()) heading.classList.add("life-sr-only");
        heading.tabIndex = -1;
        article.append(heading);
        renderRead(article, doc);
        const foot = el("footer", null, "photo-read-foot"),
          dated = el("p", null, "life-meta photo-read-meta"),
          stamp = when(doc.updatedAt);
        if (stamp) {
          const time = el("time", stamp);
          time.dateTime = doc.updatedAt;
          dated.append(time);
        }
        for (const label of [doc.archived && "숨긴 글", doc.status === "draft" && "초안"].filter(Boolean))
          dated.append(el("span", label, "photo-read-mark"));
        foot.append(dated);
        if (doc.status === "saved") {
          serverStatus = el("p", "", "life-help photo-server-status");
          serverStatus.id = "photoServerStatus";
          serverStatus.setAttribute("role", "status");
          serverStatus.setAttribute("aria-live", "polite");
          serverActions = el("div", null, "life-actions photo-server-actions");
          const state = el("div", null, "photo-read-sync");
          state.append(serverStatus, serverActions);
          foot.append(state);
        }
        const returnAction = el("div", null, "photo-read-return");
        returnAction.append(button("내 글로 돌아가기", list));
        foot.append(returnAction);
        article.append(foot);
        host.append(article);
        if (serverStatus) {
          showServerStatus();
          readServerState();
        }
      }
      dismissControls = bindDisclosureControls(host);
      showStatus(error);
      scheduleAutosave();
    }
    async function mount(
      target,
      { postId = null, expectedRevision = null, reset = false, onFeed = null, listHost = null, onReadBack = null, readBackLabel = "사진 글 목록", standalone: isolated = false } = {},
    ) {
      if ((reset || postId) && doc) { if (postId && postId === doc.id) await flush(); else await leave(); }
      host = target;
      standalone = isolated;
      feedListener = onFeed;
      feedHost = listHost;
      readBackAction = onReadBack;
      readBackText = readBackLabel;
      host.className = "photo-posts";
      unsubscribe?.();
      unsubscribeServer?.();
      unsubscribeServer = blogSync?.subscribe?.(event => {
        if (event.workspaceId === workspaceId && event.localPostId === doc?.id && !serverBusy && current(epoch)) readServerState();
      });
      unsubscribe = storage.subscribe(workspaceId, (event) => {
        if (
          event.type === "photo_posts_changed" &&
          !busy &&
          host?.isConnected &&
          mode === "list" &&
          !host.querySelector(".photo-reload")
        ) {
          const reload = button("사진 글 목록 다시 읽기", () => {
            if (host.querySelector(".photo-import"))
              throw new Error(
                "복원하거나 복원 취소한 뒤 목록을 다시 읽어 주세요.",
              );
            render();
          });
          reload.classList.add("photo-reload");
          host.append(reload);
          statusText.textContent =
            "다른 탭에서 사진 글이 바뀌었습니다. 목록을 다시 확인해 주세요.";
        }
      });
      if (reset || postId) {
        doc = null;
        mode = "list";
        error = null;
        committed = false;
        resetTicks();
      }
      render();
      if (postId) {
        try {
          await open(postId, false, expectedRevision);
          if (host?.isConnected && valid()) {
            const h = host.querySelector(".photo-read-heading,.ql-editor");
            h?.focus({ preventScroll: true });
            h?.scrollIntoView({ block: "nearest" });
          }
        } catch (e) {
          if (valid()) showStatus(e);
        }
      }
    }
    function detach() {
      epoch++;
      try { releaseHeld?.(); } catch (_) {}
      heldId = null; releaseHeld = null;
      serverSequence++; serverBusy = false; serverValue = null; serverStatus = serverActions = null;
      unsubscribeServer?.(); unsubscribeServer = null;
      cancelAutosave();
      cleanup();
      // Leaving the view: the feed rows go with it.
      retireCovers(feedCovers);
      host = null;
      status = null;
      feedListener = null;
      feedControls.forEach(([n, disabled]) => {
        if (n.isConnected) n.disabled = disabled;
      });
      feedControls = [];
      controls.forEach(([n, disabled]) => {
        if (n.isConnected) n.disabled = disabled;
      });
      controls = [];
      feedHost = null;
      unsubscribe?.();
      unsubscribe = null;
      onModeChange({ mode: "detached", id: doc?.id || null });
    }
    return {
      mount,
      begin,
      // Other screens call this before moving away from the post.
      flush: leave,
      checkpoint,
      dirty: () =>
        (busy && !loading) || composing || dirtyTick !== storedTick || !!attachmentUI?.pending(),
      detach,
      dispose() {
        disposed = true;
        detach();
      },
    };
  }
  life.PhotoPostUI = { create };
})(globalThis);
