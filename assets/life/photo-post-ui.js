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
  const photoSources = new Map();
  class Photo extends Embed {
    static blotName = "photo";
    static tagName = "figure";
    static className = "photo-block";
    static create(v) {
      const n = super.create();
      n.dataset.photoId = v.id;
      n.dataset.alt = v.alt || "";
      n.setAttribute("contenteditable", "false");
      n.setAttribute("role", "button");
      n.setAttribute(
        "aria-label",
        (v.caption || v.alt || "사진") + " · 사진 설명·순서 편집",
      );
      n.tabIndex = 0;
      const img = el("img");
      img.alt = v.alt || v.caption || "첨부 사진";
      const src = v.src || photoSources.get(v.id);
      if (src) img.src = src;
      const caption = el("figcaption", v.caption || "");
      caption.hidden = !v.caption;
      n.append(img, caption);
      return n;
    }
    static value(n) {
      return {
        id: n.dataset.photoId,
        alt: n.dataset.alt || "",
        caption: n.querySelector("figcaption")?.textContent || "",
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
      disposed = false;
    let status, inspector, captionInput, altInput;
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
    function cleanup() {
      closeViewer?.();
      closeViewer = null;
      for (const id of photoUrls.keys()) photoSources.delete(id);
      photoUrls.clear();
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
      editor = null;
      selected = null;
    }
    function showStatus(e) {
      error = e || null;
      if (status) {
        status.textContent =
          e?.message ||
          e ||
          (dirtyTick !== storedTick
            ? "초안 저장 대기 중…"
            : doc?.status === "saved"
              ? "이 브라우저에 저장됨"
              : "초안이 이 브라우저에 저장됨");
        status.setAttribute("role", e instanceof Error ? "alert" : "status");
      }
      onDirty();
    }
    function button(label, task) {
      const b = el("button", label, "life-button");
      b.type = "button";
      b.addEventListener("click", () => run(task));
      return b;
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
      if (host) {
        host.setAttribute("aria-busy", String(value));
        host
          .querySelectorAll("button,input,select")
          .forEach((n) => (n.disabled = value));
      }
      editor?.enable(!value);
      onDirty();
    }
    function guard() {
      if (!valid()) throw new Error("작업공간이 바뀌었습니다.");
      if (busy) throw new Error("사진 처리를 마친 뒤 이동해 주세요.");
      if (composing) throw new Error("한글 입력을 마친 뒤 다시 시도해 주세요.");
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
      if (!doc || mode !== "edit" || dirtyTick === storedTick) return;
      guard();
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
    async function backup() {
      guard();
      if (!doc) return;
      M.validate(doc);
      setBusy(true);
      try {
        download(await M.backup(doc), "haedo-photo-post.zip");
      } finally {
        setBusy(false);
      }
    }
    async function list() {
      await flush();
      doc = null;
      mode = "list";
      error = null;
      render();
    }
    async function open(id, editing = false) {
      const token = epoch;
      await flush();
      await beforeOpen();
      if (!current(token)) return;
      setBusy(true);
      try {
        const next = await storage.readPhotoPost(workspaceId, id);
        if (!current(token)) return;
        if (editing && next.status === "saved") {
          doc = {
            ...structuredClone(next),
            id: life.Core.id(),
            revision: 0,
            status: "draft",
            replaces: { id: next.id, revision: next.revision },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          dirtyTick = 1;
          storedTick = 0;
        } else {
          doc = next;
          dirtyTick = storedTick = 0;
        }
        mode = editing || next.status === "draft" ? "edit" : "read";
        error = null;
        render();
      } finally {
        setBusy(false);
      }
    }
    async function finish(asNew = false) {
      guard();
      const token = epoch;
      await persist();
      if (!current(token)) return;
      const payload = structuredClone(doc);
      payload.status = "saved";
      if (asNew) payload.replaces = null;
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
        render();
        host.querySelector(".photo-read-heading")?.focus();
      } finally {
        setBusy(false);
      }
    }
    function viewer(p, caption, origin) {
      closeViewer?.();
      const dialog = el("dialog", null, "photo-viewer"),
        bar = el("div", null, "life-actions"),
        title = el("h2", caption || "원본 사진");
      title.id = "photoViewerTitle";
      dialog.setAttribute("aria-labelledby", title.id);
      const img = el("img");
      img.src = url(p.blob);
      img.alt = caption || "첨부 사진";
      const stage = el("div", null, "photo-original");
      stage.append(img);
      let full = false;
      const zoom = button("원본 크기로 보기", () => {
        full = !full;
        stage.classList.toggle("photo-actual-size", full);
        zoom.textContent = full ? "화면에 맞추기" : "원본 크기로 보기";
        zoom.setAttribute("aria-pressed", String(full));
      });
      zoom.setAttribute("aria-pressed", "false");
      const exit = button("사진 닫기", () => dialog.close());
      bar.append(
        zoom,
        button("원본 내려받기", () => download(p.blob, p.name)),
        exit,
      );
      dialog.append(
        title,
        el("p", p.width + " × " + p.height + " · 원본", "life-meta"),
        bar,
        stage,
      );
      document.body.append(dialog);
      const cleanup = () => {
        dialog.remove();
        closeViewer = null;
        if (origin?.isConnected) origin.focus();
      };
      dialog.addEventListener("close", cleanup, { once: true });
      closeViewer = () => {
        dialog.close();
        if (dialog.isConnected) cleanup();
      };
      dialog.showModal();
      exit.focus();
    }
    function renderRead(target, value) {
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
            b = button("", () =>
              viewer(p, op.insert.photo.caption || op.insert.photo.alt, b),
            );
          b.className = "photo-expand";
          b.setAttribute(
            "aria-label",
            (op.insert.photo.caption || p.name) + " · 사진 크게 보기",
          );
          image.src = url(p.blob);
          image.alt = op.insert.photo.alt || op.insert.photo.caption || p.name;
          image.width = p.width;
          image.height = p.height;
          image.loading = "lazy";
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
      selected = node;
      const value = Photo.value(node);
      captionInput.value = value.caption;
      altInput.value = value.alt;
      inspector.hidden = false;
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
      const at = editor.getIndex(root.Quill.find(selected)),
        value = Photo.value(selected),
        p = doc.photos.find((p) => p.id === value.id);
      const next = {
        ...value,
        caption: captionInput.value,
        alt: altInput.value,
      };
      M.validate({
        ...doc,
        ops: doc.ops.map((op) =>
          op.insert?.photo?.id === p.id
            ? { ...op, insert: { photo: next } }
            : op,
        ),
      });
      const Delta = root.Quill.import("delta");
      editor.updateContents(
        new Delta()
          .retain(at)
          .delete(1)
          .insert({ photo: imageValue(p, next) }),
        "user",
      );
      selected = host.querySelector('[data-photo-id="' + p.id + '"]');
      selected?.classList.add("photo-selected");
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
      editor.history.cutoff();
      editor.deleteText(at, 1, "user");
      editor.insertEmbed(destination, "photo", imageValue(p, value), "user");
      editor.history.cutoff();
      selected = host.querySelector('[data-photo-id="' + p.id + '"]');
      selected?.classList.add("photo-selected");
      selected?.scrollIntoView({ block: "nearest" });
    }
    function renderEditor() {
      const form = el("section", null, "photo-editor"),
        title = el("input");
      title.id = "photoTitle";
      title.value = doc.title;
      title.placeholder = "제목";
      title.maxLength = 500;
      title.setAttribute("aria-label", "사진 글 제목");
      title.addEventListener("input", () => {
        doc.title = title.value;
        mark();
      });
      form.append(title);
      const toolbar = el("div", null, "photo-toolbar");
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "본문 서식");
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
      toolbar.append(heading);
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
        toolbar.append(b);
      }
      const undo = button("실행 취소", () => editor.history.undo()),
        redo = button("다시 실행", () => editor.history.redo());
      toolbar.append(undo, redo);
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
      toolbar.append(
        button("사진", () => {
          photoInput.click();
        }),
        photoInput,
      );
      const area = el("div", null, "photo-quill");
      form.append(toolbar, area);
      host.append(form);
      editor = new root.Quill(area, {
        theme: "snow",
        placeholder: "글을 쓰고 사진을 넣어 보세요.",
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
      editor.root.setAttribute("aria-label", "사진 글 본문");
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
        const n = e.target.closest(".photo-block");
        if (n) selectPhoto(n);
      });
      editor.root.addEventListener(
        "keydown",
        (e) => {
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
      captionInput = el("input");
      captionInput.setAttribute("aria-label", "사진 설명");
      captionInput.maxLength = 2000;
      altInput = el("input");
      altInput.setAttribute("aria-label", "사진 대체 텍스트");
      altInput.maxLength = 2000;
      for (const input of [captionInput, altInput]) {
        input.addEventListener("compositionstart", () => {
          composing = true;
          clearTimeout(timer);
        });
        input.addEventListener("compositionend", () => {
          composing = false;
          run(changePhoto);
        });
        input.addEventListener("input", () => {
          if (!composing) run(changePhoto);
        });
      }
      captionLabel.append(captionInput);
      altLabel.append(altInput);
      inspector.append(
        el("p", "", "life-meta photo-original-info"),
        captionLabel,
        altLabel,
        button("사진 앞으로", () => movePhoto(-1)),
        button("사진 뒤로", () => movePhoto(1)),
        button("사진 빼기", () => {
          guard();
          if (selected?.isConnected) {
            editor.deleteText(
              editor.getIndex(root.Quill.find(selected)),
              1,
              "user",
            );
            selected = null;
            inspector.hidden = true;
          }
        }),
        button("사진 편집 닫기", () => {
          inspector.hidden = true;
          editor.focus();
        }),
      );
      host.append(inspector);
      const actions = el("div", null, "life-actions photo-save");
      actions.append(
        button("글 저장", () => finish()),
        button("사진 포함 백업", backup),
        button("닫기", list),
        button("초안 다시 저장", persist),
      );
      if (doc.replaces)
        actions.append(button("새 글로 저장", () => finish(true)));
      host.append(actions);
      const recovery = el("details", null, "life-details");
      recovery.append(
        el("summary", "저장 충돌 복구"),
        button("내 입력을 새 초안으로 보관", async () => {
          guard();
          if (saving) await saving.catch(() => {});
          doc = structuredClone(doc);
          doc.id = life.Core.id();
          doc.revision = 0;
          doc.status = "draft";
          doc.replaces = null;
          mark();
          await persist();
        }),
      );
      host.append(recovery);
    }
    function render() {
      if (!host || !valid()) return;
      cleanup();
      const token = ++epoch;
      host.replaceChildren();
      host.dataset.mode = mode;
      status = el("p", "", "life-help photo-status");
      status.setAttribute("role", "status");
      host.append(status);
      if (mode === "list") {
        const toolbar = el("div", null, "life-actions");
        toolbar.append(
          button("사진 글쓰기", async () => {
            const token = epoch;
            await flush();
            await beforeOpen();
            if (!current(token)) return;
            doc = M.create(life.Core.id);
            mode = "edit";
            dirtyTick = storedTick = 0;
            error = null;
            render();
            host.querySelector("#photoTitle")?.focus();
          }),
        );
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
                el("h3", candidate.title || "제목 없는 글"),
                el(
                  "p",
                  candidate.photos.length +
                    "장 · 원본 포함 · 비공개 새 초안으로 복원",
                ),
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
        toolbar.append(
          button("사진 글 백업 열기", () => file.click()),
          file,
        );
        host.append(toolbar);
        const scope = el("details", null, "life-details");
        scope.append(
          el("summary", "사진 글 보관 안내"),
          el(
            "p",
            "사진 글과 원본은 현재 계정·작업공간의 이 브라우저에만 보관합니다. 사진 포함 ZIP 백업으로 다른 기기에 옮길 수 있습니다. 일반 자료·구성 JSON, 기기 간 동기화와 공개 사본에는 포함되지 않습니다. JPEG·PNG·WebP 원본을 재압축하거나 해상도를 줄이지 않습니다.",
            "life-help",
          ),
        );
        host.append(scope);
        const list = el("div", null, "photo-feed");
        host.append(list);
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
              b.append(
                el(
                  "span",
                  item.status === "draft"
                    ? "작성 중"
                    : "비공개 · 사진 " + item.photos + "장",
                  "life-meta",
                ),
                el("strong", item.title || "제목 없는 글"),
                el(
                  "span",
                  item.body.trim().slice(0, 120),
                  "photo-entry-excerpt",
                ),
              );
              list.append(b);
            }
            status.textContent = "";
          })
          .catch((e) => {
            if (current(token)) {
              showStatus(e);
              host.append(button("사진 글 목록 다시 읽기", () => render()));
            }
          });
      } else if (mode === "edit") renderEditor();
      else {
        const actions = el("div", null, "life-actions");
        actions.append(
          button("사진 글 목록", list),
          button("글 수정", () => open(doc.id, true)),
          button("사진 포함 백업", backup),
        );
        host.append(actions);
        const article = el("article", null, "photo-article"),
          heading = el("h2", doc.title || "제목 없는 글", "photo-read-heading");
        heading.tabIndex = -1;
        article.append(heading, el("p", "비공개 · 이 브라우저", "life-meta"));
        renderRead(article, doc);
        host.append(article);
      }
      showStatus(error);
    }
    async function mount(target, { postId = null, reset = false } = {}) {
      host = target;
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
          status.textContent =
            "다른 탭에서 사진 글이 바뀌었습니다. 목록을 다시 확인해 주세요.";
        }
      });
      if (reset || postId) {
        doc = null;
        mode = "list";
        error = null;
        dirtyTick = storedTick = 0;
      }
      render();
      if (postId) {
        try {
          await open(postId);
          if (host?.isConnected && valid()) {
            const h = host.querySelector(".photo-read-heading,#photoTitle");
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
      unsubscribe?.();
      unsubscribe = null;
    }
    return {
      mount,
      flush,
      dirty: () => busy || dirtyTick !== storedTick,
      detach,
      dispose() {
        disposed = true;
        detach();
      },
    };
  }
  life.PhotoPostUI = { create };
})(globalThis);
