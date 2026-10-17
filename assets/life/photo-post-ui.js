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
  function create({
    storage,
    workspaceId,
    isCurrent,
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
      epoch = 0,
      busy = false,
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
    let status, statusText, inspector, captionInput, altInput, recoveryActions;
    let dismissControls = null;
    const urls = new Set(),
      photoUrls = new Map();
    let closeViewer = null;
    const valid = () => !disposed && isCurrent(),
      current = (t) => valid() && t === epoch && !!host?.isConnected;
    const url = (blob) => {
      const u = URL.createObjectURL(blob);
      urls.add(u);
      return u;
    };
    function retireImageURL(value) {
      // show() may assign another src in this task. Let the final queued image
      // update cancel the previous request before retiring its URL.
      queueMicrotask(() => queueMicrotask(() => URL.revokeObjectURL(value)));
    }
    function cleanup() {
      if (status) root.HaedoMotion?.cancel(status);
      dismissControls?.();
      dismissControls = null;
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
      editor = null;
      selected = null;
      recoveryActions = null;
    }
    function showStatus(e) {
      error = e || null;
      if (status) {
        status.hidden = mode === "read" && !e && !committed;
        const message =
          e?.message ||
          e ||
          (dirtyTick !== storedTick
            ? "초안 보관 중…"
            : mode === "read" && committed
              ? "비공개 글을 저장했어요"
              : doc?.revision
                ? "초안 보관됨"
                : "사진 없이도 바로 쓸 수 있어요");
        const state = e instanceof Error ? "error" : e ? "notice" :
          dirtyTick !== storedTick ? "pending" :
          mode === "read" && committed ? "success" : doc?.revision ? "draft" : "idle";
        const changed = status.dataset.state !== state || statusText.textContent !== message;
        if (statusText.textContent !== message) statusText.textContent = message;
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
    function glyph(name) {
      const paths = {
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
        undo: '<path d="m9 5-5 5 5 5"/><path d="M4 10h10a6 6 0 0 1 6 6v3"/>',
        redo: '<path d="m15 5 5 5-5 5"/><path d="M20 10H10a6 6 0 0 0-6 6v3"/>',
      };
      if (!Object.hasOwn(paths, name)) return life.Icons.create(name);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({
        width: "20", height: "20", viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round",
        "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
      })) svg.setAttribute(key, value);
      svg.innerHTML = paths[name]; // Fixed local control geometry, never document content.
      return svg;
    }
    function iconControl(node, name, label) {
      node.classList.add("photo-icon-button");
      node.setAttribute("aria-label", label);
      node.title = label;
      node.replaceChildren(glyph(name), el("span", label, "life-sr-only"));
      return node;
    }
    async function run(task) {
      if (busy || !valid()) return;
      try {
        await task();
      } catch (e) {
        if (valid()) showStatus(e);
      }
    }
    function setBusy(value) {
      busy = value;
      if (value) clearTimeout(timer);
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
      editor?.enable(!value);
      onDirty();
      if (
        !value &&
        valid() &&
        mode === "edit" &&
        dirtyTick !== storedTick &&
        !composing &&
        !saving
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => persist().catch(showStatus), 500);
      }
    }
    function guard(acceptedOnly = false) {
      if (!valid()) throw new Error("작업공간이 바뀌었습니다.");
      if (busy) throw new Error("사진 처리를 마친 뒤 이동해 주세요.");
      if (composing) throw new Error("한글 입력을 마친 뒤 다시 시도해 주세요.");
      if (!acceptedOnly && attachmentUI?.composing())
        throw new Error("첨부의 한글 입력을 마친 뒤 다시 시도해 주세요.");
    }
    function mark() {
      dirtyTick++;
      doc.updatedAt = new Date().toISOString();
      showStatus();
      clearTimeout(timer);
      if (!composing)
        timer = setTimeout(() => persist().catch(showStatus), 500);
    }
    async function persist() {
      clearTimeout(timer);
      if (saving) {
        await saving;
        return persist();
      }
      if (mode === "edit" && selected?.isConnected) changePhoto();
      if (!doc || mode !== "edit" || dirtyTick === storedTick) return;
      guard(true);
      M.validate(doc);
      const tick = dirtyTick,
        payload = structuredClone(doc),
        token = epoch;
      saving = storage
        .savePhotoPost(workspaceId, payload, doc.revision)
        .then((saved) => {
          if (!valid()) return;
          doc.revision = saved.revision;
          storedTick = tick;
          if (current(token)) {
            showStatus();
            onSaved();
          }
        })
        .finally(() => {
          saving = null;
          onDirty();
        });
      await saving;
      if (dirtyTick !== storedTick) return persist();
    }
    async function flush() {
      attachmentUI?.flush();
      if (mode === "edit" && selected?.isConnected) changePhoto();
      if (
        !busy &&
        !composing &&
        (!doc || mode !== "edit" || dirtyTick === storedTick)
      )
        return;
      guard();
      await persist();
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
      attachmentUI?.flush();
      if (mode === "edit" && selected?.isConnected) changePhoto();
      M.validate(doc);
      return M.compact(doc);
    }
    async function backup() {
      const value = outputSnapshot(),
        token = epoch;
      setBusy(true);
      try {
        const blob = await M.backup(value);
        if (current(token)) download(blob, "haedo-photo-post.zip");
      } finally {
        setBusy(false);
      }
    }
    async function list() {
      await flush();
      if (onReturn && (await onReturn({ id: doc?.id || null, committed })) !== false)
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
        await flush();
        await beforeOpen();
        if (!current(token)) return;
        setBusy(true);
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
        } finally {
          setBusy(false);
        }
        mode = "edit";
        dirtyTick = storedTick = 0;
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
      await flush();
      await beforeOpen();
      if (!current(token)) return;
      setBusy(true);
      try {
        const next = await storage.readPhotoPost(workspaceId, id);
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
          dirtyTick = retained ? 0 : 1;
          storedTick = 0;
        } else {
          doc = next;
          dirtyTick = storedTick = 0;
        }
        mode =
          !next.archived && (editing || next.status === "draft")
            ? "edit"
            : "read";
        if (mode === "edit") doc = M.upgrade(doc);
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
        setBusy(false);
      }
    }
    async function finish(asNew = false) {
      if (asNew) return saveIndependent("saved");
      guard();
      const token = epoch;
      await flush();
      if (!current(token)) return;
      const payload = structuredClone(doc);
      const previousId = payload.replaces?.id || payload.id;
      payload.status = "saved";
      payload.updatedAt = new Date().toISOString();
      M.validate(payload);
      setBusy(true);
      try {
        const saved = await storage.savePhotoPost(
          workspaceId,
          payload,
          doc.revision,
        );
        if (!current(token)) return;
        doc = saved;
        dirtyTick = storedTick = 0;
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
        dirtyTick = storedTick = 0;
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
      clearTimeout(timer);
      const token = epoch;
      if (saving) await saving.catch(() => {});
      if (!current(token)) return;
      const next = M.upgrade(outputSnapshot()),
        now = new Date().toISOString();
      const previousId = doc.replaces?.id || doc.id;
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
        doc = saved;
        dirtyTick = storedTick = 0;
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
    }
    const duplicate = () => saveIndependent("draft");
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
        source = url(photo.blob);
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
          " · 원본";
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
          if (!portable) image.src = url(p.blob);
          else image.dataset.photoId = p.id;
          image.alt = op.insert.photo.alt || op.insert.photo.caption || p.name;
          image.width = p.width;
          image.height = p.height;
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
            reader.readAsDataURL(photo.blob);
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
      if (!photoUrls.has(p.id)) photoUrls.set(p.id, url(p.blob));
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
        const incoming = await Promise.all(
          [...files].map((f) => M.readPhoto(f, life.Core.id)),
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
      const next = {
        ...value,
        caption: captionInput.value,
        alt: altInput.value,
      };
      if (next.caption === value.caption && next.alt === value.alt) return;
      M.validate({
        ...doc,
        ops: doc.ops.map((op) =>
          op.insert?.photo?.id === p.id
            ? { ...op, insert: { photo: next } }
            : op,
        ),
      });
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
      const form = el("section", null, "photo-editor"),
        title = el("input");
      title.id = "photoTitle";
      title.value = doc.title;
      title.placeholder = "제목 추가 (선택)";
      title.maxLength = 500;
      title.setAttribute("aria-label", "글 제목");
      title.addEventListener("input", () => {
        doc.title = title.value;
        mark();
      });
      title.addEventListener("compositionstart", () => {
        composing = true;
        clearTimeout(timer);
      });
      title.addEventListener("compositionend", () => {
        composing = false;
        doc.title = title.value;
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
        button("보관함으로 옮기기", () => archive(true)),
        button("초안 다시 저장", persist),
      );
      if (doc.replaces) menu.append(button("새 글로 저장", () => finish(true)));
      const commandState = el("div", null, "photo-command-state"),
        save = button("글 저장", () => finish());
      commandState.append(el("span", "비공개 · 이 브라우저", "photo-command-scope"), status);
      if (doc.replaces)
        commandState.prepend(el("span", "기존 글 수정 중", "photo-editing-label"));
      save.classList.add("photo-save");
      save.title = "이 브라우저에 비공개로 저장";
      commands.append(iconControl(button("닫기", list), "close", "닫기"), commandState, save, more);
      sticky.append(commands);
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
      const toolbar = el("div", null, "photo-toolbar");
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "본문 서식");
      const primaryFormats = el("span", null, "photo-format-primary"),
        extraFormats = el("details", null, "photo-format-options"),
        formatSummary = el("summary"),
        formatPanel = el("span", null, "photo-format-panel");
      formatSummary.setAttribute("aria-label", "추가 서식");
      formatSummary.title = "추가 서식";
      formatSummary.append(el("span", "서식"), glyph("chevron"));
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
      const undo = button("실행 취소", () => editor.history.undo()),
        redo = button("다시 실행", () => editor.history.redo());
      const history = el("span", null, "photo-history");
      history.append(iconControl(undo, "undo", "실행 취소"), iconControl(redo, "redo", "다시 실행"));
      const photoInput = el("input");
      photoInput.type = "file";
      photoInput.multiple = true;
      photoInput.accept = "image/jpeg,image/png,image/webp";
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
      toolbar.append(insertPhoto, primaryFormats, extraFormats, history, photoInput);
      const area = el("div", null, "photo-quill");
      form.append(sticky, title, toolbar, area);
      host.append(form);
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
          "photo",
        ],
        modules: { toolbar, history: { userOnly: true, delay: 700 } },
      });
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
      editor.on("text-change", () => {
        doc.ops = editor.getContents().ops;
        mark();
      });
      editor.root.addEventListener("compositionstart", () => {
        composing = true;
        clearTimeout(timer);
      });
      editor.root.addEventListener("compositionend", () => {
        composing = false;
        mark();
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
          const files = [...(e.clipboardData?.files || [])];
          if (files.length) {
            run(() => insertFiles(files));
            return;
          }
          const text = e.clipboardData?.getData("text/plain") || "",
            range = editor.getSelection(true);
          if (text) {
            if (range.length)
              editor.deleteText(range.index, range.length, "user");
            editor.insertText(range.index, text, "user");
            editor.setSelection(range.index + text.length, 0, "silent");
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
          composing = true;
          clearTimeout(timer);
        });
        input.addEventListener("compositionend", (e) => {
          e.stopPropagation();
          composing = false;
          run(changePhoto);
        });
        input.addEventListener("input", (e) => {
          e.stopPropagation();
          if (!composing) run(changePhoto);
        });
        input.addEventListener("blur", () => editor.history.cutoff());
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
          const next = M.upgrade(doc);
          next.attachments = structuredClone(values);
          M.validate(next);
          doc.attachments = next.attachments;
          doc.format = next.format;
          doc.archived = next.archived;
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
    function render() {
      if (!host || !valid()) return;
      cleanup();
      const token = ++epoch;
      host.replaceChildren();
      host.dataset.mode = mode;
      onModeChange({ mode, id: doc?.id || null });
      status = el("p", "", "life-help photo-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-atomic", "true");
      const check = glyph("check");
      check.classList.add("photo-status-check");
      statusText = el("span", "", "photo-status-text");
      status.append(check, statusText);
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
                const checked = await M.readPhoto(
                  new File([p.blob], p.name, { type: p.type }),
                  () => p.id,
                );
                if (checked.width !== p.width || checked.height !== p.height)
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
                    dirtyTick = storedTick = 0;
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
            "글과 사진은 먼저 이 브라우저에 보관합니다. 글 관리에서 한 편씩 서버 보관·선택 공개할 수 있습니다. 일반 자료·구성 JSON과 기존 전체 동기화에는 포함되지 않습니다. 사진 포함 ZIP으로 원본을 옮길 수 있으며 해상도와 바이트를 줄이지 않습니다. 원문 근거 연결 정보는 ZIP에 포함되지 않지만 인용 본문과 출처 URL은 유지합니다.",
            "life-help",
          ),
        );
        files.append(scope);
        const list = el("div", null, "photo-feed");
        if (!feedListener) host.append(list);
        const retained = el("details", null, "life-details photo-retained"),
          retainedTitle = el("summary", "초안·보관함");
        const drafts = el("div", null, "photo-draft-list"),
          archived = el("div", null, "photo-archived-list");
        const draftHeading = el("h3", "작성 중인 글"),
          archiveHeading = el("h3", "보관함"),
          archiveHelp = el(
            "p",
            "보관한 글과 사진은 그대로 남습니다. 글을 열어 목록으로 복원할 수 있습니다.",
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
                          if (photo) entry.target.src = url(photo.blob);
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
              " · 보관함 " +
              archived.children.length;
            draftHeading.hidden = !drafts.children.length;
            archiveHeading.hidden = archiveHelp.hidden =
              !archived.children.length;
            feedListener?.([...list.children]);
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
        const actions = el("div", null, "life-actions photo-read-actions");
        actions.classList.toggle("photo-read-standalone", standalone);
        if (readBackAction)
          actions.append(iconControl(button(readBackText, async () => {
            const token = epoch; await flush();
            if (current(token)) await readBackAction();
          }), "back", readBackText));
        else if (!standalone)
          actions.append(iconControl(button("사진 글 목록", list), "back", "사진 글 목록"));
        actions.append(
          doc.archived
            ? button("목록으로 복원", () => archive(false))
            : button("글 수정", () => open(doc.id, true)),
          iconControl(button("사진 포함 백업", backup), "download", "사진 포함 백업"),
        );
        const more = el("details", null, "photo-more life-details"),
          menu = el("div", null, "photo-more-menu");
        more.append(iconControl(el("summary"), "more", "더 보기"), menu);
        menu.append(
          button("HTML 읽기 파일 받기", exportHTML),
          button("사본으로 이어 쓰기", duplicate),
        );
        if (!doc.archived)
          menu.append(button("보관함으로 옮기기", () => archive(true)));
        actions.append(more);
        host.append(actions);
        const article = el("article", null, "photo-article"),
          heading = el("h2", doc.title || (doc.photos.length ? "사진 " + doc.photos.length + "장" : "내 글"), "photo-read-heading");
        if (!doc.title.trim()) heading.classList.add("life-sr-only");
        heading.tabIndex = -1;
        const metadata = el("p", (doc.archived ? "보관함 · " : "") +
          (doc.status === "draft" ? "초안 · " : "비공개 · ") + "이 브라우저", "life-meta photo-read-meta");
        const modified = new Date(doc.updatedAt);
        if (Number.isFinite(modified.getTime())) {
          const time = el("time", new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(modified));
          time.dateTime = doc.updatedAt;
          metadata.append(document.createTextNode(" · 수정 "), time);
        }
        article.append(heading, metadata);
        renderRead(article, doc);
        const returnAction = el("div", null, "photo-read-return");
        returnAction.append(button("내 글로 돌아가기", list));
        article.append(returnAction);
        host.append(article);
      }
      dismissControls = bindDisclosureControls(host);
      showStatus(error);
    }
    async function mount(
      target,
      { postId = null, expectedRevision = null, reset = false, onFeed = null, listHost = null, onReadBack = null, readBackLabel = "사진 글 목록", standalone: isolated = false } = {},
    ) {
      if ((reset || postId) && doc) await flush();
      host = target;
      standalone = isolated;
      feedListener = onFeed;
      feedHost = listHost;
      readBackAction = onReadBack;
      readBackText = readBackLabel;
      host.className = "photo-posts";
      unsubscribe?.();
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
        dirtyTick = storedTick = 0;
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
      clearTimeout(timer);
      cleanup();
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
      flush,
      dirty: () =>
        busy || dirtyTick !== storedTick || !!attachmentUI?.pending(),
      detach,
      dispose() {
        disposed = true;
        detach();
      },
    };
  }
  life.PhotoPostUI = { create };
})(globalThis);
