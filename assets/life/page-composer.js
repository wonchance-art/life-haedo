/* Local drafts; explicit atomic save into the owner's page. No automatic publication. */
(function (root) {
  "use strict";
  const life = root.HaedoLife,
    M = life.PagePosts;
  const draftDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function create({
    storage,
    workspaceId,
    getPosts,
    commit,
    isCurrent,
    onDirty = () => {},
    onNewPost = null,
    onFeed = null,
    getFeedHost = null,
    onReturn = null,
    getReturnLabel = () => "내 글로 돌아가기",
    onModeChange = () => {},
    onCommitted = () => {},
  }) {
    let state = null,
      basePosts = [],
      loading = null,
      edit = 0,
      stored = 0,
      saving = null,
      timer = null,
      host = null,
      active = null,
      standalone = false,
      readId = null,
      committedId = null,
      dialogClose = null,
      epoch = 0,
      busy = false,
      disposed = false,
      composing = false,
      attachmentReview = null,
      importRequest = 0,
      draftConflict = false,
      recoveryLoading = false,
      error = null;
    const media = life.PageMedia.create();
    const now = () => new Date().toISOString();
    const valid = () => !disposed && isCurrent();
    function message(value) {
      error = value;
      if (value?.code === "page_draft_conflict") draftConflict = true;
      if (host) {
        const n = host.querySelector(".pp-status");
        if (n) {
          n.textContent = value?.code === "page_draft_conflict" ? "다른 탭에서 초안이 바뀌었습니다. 내 입력을 유지했으니 최신 초안과 비교해 주세요." : value?.message || value || "";
          n.setAttribute("role", value && typeof value !== "string" ? "alert" : "status");
          if (draftConflict)
            n.append(button("최신 초안과 비교", openDraftRecovery));
        }
      }
    }
    function button(label, task, glyph) {
      const b = node(
        "button",
        glyph ? null : label,
        glyph ? "life-icon-button" : "life-button",
      );
      b.type = "button";
      if (glyph) {
        b.setAttribute("aria-label", label);
        b.title = label;
        b.append(life.Icons.create(glyph));
      }
      b.addEventListener("click", async () => {
        if (busy || !valid()) return;
        try {
          await task();
        } catch (e) {
          message(e);
        }
      });
      return b;
    }
    async function load() {
      if (state) return;
      if (!loading)
        loading = storage
          .readPageDrafts(workspaceId)
          .then((value) => {
            adopt(value);
          })
          .finally(() => {
            loading = null;
          });
      await loading;
    }
    function mark() {
      edit++;
      onDirty();
      clearTimeout(timer);
      if (!composing) timer = setTimeout(() => persistDraft().catch(message), 650);
    }
    function adopt(value) {
      state = value;
      basePosts = structuredClone(value.posts);
      draftConflict = false;
    }
    async function persistDraft() {
      clearTimeout(timer);
      if (saving) {
        await saving;
        return persistDraft();
      }
      if (!state || edit === stored) return;
      if (!valid())
        throw new Error("작업공간이 바뀌어 초안을 저장하지 않았습니다.");
      const tick = edit,
        payload = structuredClone(state);
      saving = storage
        .savePageDrafts(workspaceId, payload, state.revision)
        .then((result) => {
          state.revision = result.revision;
          basePosts = structuredClone(result.posts);
          draftConflict = false;
          stored = tick;
          error = null;
        })
        .catch((e) => {
          message(e);
          throw e;
        })
        .finally(() => {
          saving = null;
          onDirty();
        });
      await saving;
      if (edit !== stored) return persistDraft();
    }
    function requireAppliedAttachment() {
      if (attachmentReview) {
        attachmentReview.focus();
        const pending = new Error(attachmentReview.composing ? '한글 입력을 마친 뒤 첨부에 반영해 주세요. 입력은 그대로 남아 있습니다.' : '첨부 입력을 먼저 반영하거나 입력 취소를 눌러 주세요. 글과 입력은 그대로 남아 있습니다.');
        pending.code = 'attachment_review_pending';
        throw pending;
      }
      if (composing) throw new Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
    }
    async function flush() {
      // The accepted body/attachments can autosave while the separate review is still on screen.
      await persistDraft();
      requireAppliedAttachment();
    }
    function backup() {
      requireAppliedAttachment();
      const blob = new Blob(
          [
            JSON.stringify(
              { format: "life-page-drafts-v1", posts: state.posts },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        url = URL.createObjectURL(blob),
        a = node("a");
      a.href = url;
      a.download = "haedo-page-drafts.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function importDrafts(file) {
      if (!file) return;
      requireAppliedAttachment();
      const token = epoch, request = ++importRequest;
      if (file.size > 2097152)
        throw new Error("2 MiB 이하의 초안 파일을 골라 주세요.");
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      } catch (_) {
        throw new Error("초안 파일을 읽지 못했습니다. UTF-8 JSON 파일인지 확인해 주세요. 기존 초안은 유지했습니다.");
      }
      const incoming = M.readDraftBackup(value);
      if (!valid() || token !== epoch || request !== importRequest || !host?.isConnected) return;
      await flush();
      if (!valid() || token !== epoch || request !== importRequest || !host?.isConnected) return;
      if (!incoming.length) { message("파일에 작성 중인 초안이 없습니다. 기존 초안은 유지했습니다."); return; }
      reviewImport(incoming, token);
    }
    function draftTitle(d) {
      return Array.from(d.body.trim().split("\n")[0]).slice(0, 80).join("") || d.attachments[0]?.title || "작성 중인 글";
    }
    function draftDescription(d) {
      const kind = d.replaces ? getPosts().some((p) => p.id === d.replaces) ? "수정 초안" : "수정 초안 · 원래 글 없음" : "새 글";
      const date = draftDate.format(new Date(d.updatedAt));
      return [kind, date, "첨부 " + d.attachments.length + "개"].join(" · ");
    }
    function draftDetail(d, { restoring = true, local = false } = {}) {
      const detail = node("details", null, "pp-import-detail");
      detail.append(node("summary", "본문·첨부 확인"));
      if (d.visibility === "page") detail.append(node("p", restoring ? local ? "공개 후보였던 내용도 비공개 새 초안으로 보관합니다." : "파일에서는 공개 후보입니다. 복원하면 비공개 초안이 됩니다." : "보관함의 공개 후보 초안입니다. 공개 게시와는 별도입니다.", "life-help"));
      if (d.body) detail.append(node("p", d.body, "pp-body"));
      if (d.attachments.length) {
        const attachments = life.PagePostsView.attachments(d.attachments, { compact: true });
        d.attachments.forEach((a, i) => {
          if (a.url) attachments.children[i].querySelector(".pp-attachment-copy").append(node("span", a.url, "life-meta pp-import-url"));
        });
        detail.append(attachments);
      }
      if (!d.body && !d.attachments.length) detail.append(node("p", "본문과 첨부가 없는 빈 초안입니다.", "life-help"));
      return detail;
    }
    async function openDraftRecovery() {
      if (recoveryLoading) return;
      requireAppliedAttachment();
      clearTimeout(timer);
      const token = epoch;
      recoveryLoading = true;
      try {
        if (saving) await saving.catch(() => {});
        const latest = await storage.readPageDrafts(workspaceId);
        if (!valid() || token !== epoch || !host?.isConnected) return;
        requireAppliedAttachment();
        const changed = M.changedDrafts(basePosts, state.posts);
        const input = host.querySelector("#ppBody");
        const position = input ? { draftId: active, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, scrollTop: input.scrollTop } : null;
        reviewImport(changed, token, { recovery: true, latest, position });
      } finally { recoveryLoading = false; }
    }
    function reviewImport(incoming, token, { recovery = false, latest: comparison = null, position = null } = {}) {
      dialogClose?.();
      const origin = document.activeElement, scroll = document.body.style.overflow;
      const dialog = node("dialog", null, "life-collection cl-picker pp-draft-import");
      dialog.classList.toggle("pp-draft-conflict", recovery);
      let alive = true, storing = false;
      function close() {
        if (!alive) return;
        alive = false; dialog.close(); dialog.remove();
        document.body.style.overflow = scroll;
        dialogClose = null;
        if (origin?.isConnected) origin.focus({ preventScroll: true });
        else if (recovery && valid()) host?.querySelector("#ppBody")?.focus({ preventScroll: true });
      }
      const current = () => alive && valid() && token === epoch && host?.isConnected;
      const head = node("header", null, "cl-picker-head"), title = node("h2", recovery ? "초안 충돌 확인" : "불러올 초안 확인");
      title.id = "ppImportTitle"; dialog.setAttribute("aria-labelledby", title.id);
      const exit = button(recovery ? "충돌 비교 닫기" : "초안 불러오기 취소", close, "close");
      head.append(title, exit);
      const body = node("div", null, "cl-picker-body");
      const hint = node("p", recovery ? "내 변경은 모두 비공개 새 초안으로 보관하고 최신 보관함을 함께 엽니다. 다른 탭의 초안과 저장한 글은 유지합니다. 수정하던 글의 연결은 새 사본에서 끊습니다." : "선택한 내용은 비공개 새 초안으로 보관합니다. 기존 글과 초안을 덮어쓰지 않고, 원래 글의 수정 연결도 가져오지 않습니다.", "life-help");
      hint.id = "ppImportHelp"; dialog.setAttribute("aria-describedby", hint.id); body.append(hint);
      const status = node("p", "", "life-help pp-import-status"); status.setAttribute("role", "status");
      const choices = [], badges = [];
      let reviewed = M.reviewDrafts(comparison?.posts || state.posts, incoming);
      if (recovery) {
        const saved = node("details", null, "pp-conflict-saved");
        saved.append(node("summary", "현재 보관된 초안 " + comparison.posts.length + "개"));
        for (const d of comparison.posts.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
          const row = node("section", null, "pp-import-row");
          row.append(node("strong", draftTitle(d)), node("p", draftDescription(d), "life-meta"), draftDetail(d, { restoring: false }));
          saved.append(row);
        }
        if (!comparison.posts.length) saved.append(node("p", "현재 보관함에는 초안이 없습니다.", "life-help"));
        body.append(saved, node("h3", "내 변경 " + incoming.length + "개"));
        if (!incoming.length) body.append(node("p", "마지막 보관본 이후 달라진 내 초안은 없습니다.", "life-help"));
      }
      for (const [index, d] of incoming.entries()) {
        const row = node("section", null, "pp-import-row"), label = node(recovery ? "div" : "label", null, "pp-import-choice"), input = node("input");
        input.type = "checkbox"; input.checked = recovery || !reviewed[index].existing && !reviewed[index].file;
        input.disabled = recovery;
        const copy = node("span", null, "pp-draft-copy"), name = node("strong", draftTitle(d)), meta = node("span", draftDescription(d), "life-meta");
        const badge = node("span", "", "life-meta pp-import-duplicate");
        name.id = "ppImportName-" + index; meta.id = "ppImportMeta-" + index; badge.id = "ppImportDuplicate-" + index;
        input.setAttribute("aria-labelledby", name.id); input.setAttribute("aria-describedby", meta.id + " " + badge.id);
        copy.append(name, meta, badge);
        if (!recovery) label.append(input);
        label.append(copy); row.append(label);
        const detail = draftDetail(d, { local: recovery });
        row.append(detail); body.append(row); choices.push(input); badges.push(badge);
      }
      function duplicateLabels() {
        badges.forEach((badge, i) => { badge.textContent = reviewed[i].existing ? "같은 본문·첨부가 보관함에 있습니다." : reviewed[i].file ? "파일 안에 같은 본문·첨부가 있습니다." : ""; });
      }
      const foot = node("footer", null, "cl-picker-foot"), count = node("span", "", "life-meta"); count.setAttribute("role", "status");
      const apply = button(recovery ? incoming.length ? "내 변경을 새 초안으로 보관" : "최신 초안 열기" : "선택한 초안 불러오기", async () => {
        if (!current() || storing) return;
        storing = true; busy = true; onDirty();
        const controls = [...dialog.querySelectorAll("button,input")].map((el) => [el, el.disabled]);
        controls.forEach(([el]) => { el.disabled = true; });
        status.setAttribute("role", "status"); status.textContent = "초안을 보관하는 중…";
        try {
          const latest = await storage.readPageDrafts(workspaceId);
          if (!current()) return;
          if (recovery && !incoming.length) {
            adopt(latest); stored = edit;
            active = latest.posts.some(d => d.id === active) ? active : null;
            close(); message(null); render(); host?.querySelector("#ppBody")?.focus(); onDirty(); return;
          }
          const nextReview = M.reviewDrafts(latest.posts, incoming);
          if (!recovery && nextReview.some((r, i) => choices[i].checked && r.existing && !reviewed[i].existing)) {
            reviewed = nextReview; duplicateLabels();
            throw new Error("다른 탭에서 같은 내용이 보관되었습니다. 선택을 확인하고 다시 눌러 주세요.");
          }
          const selected = incoming.filter((_, i) => choices[i].checked);
          if (!selected.length) throw new Error("불러올 초안을 선택해 주세요.");
          const added = M.restoreDrafts(latest.posts, selected, life.Core.id);
          const candidate = { revision: latest.revision, posts: latest.posts.concat(added) };
          const result = await storage.savePageDrafts(workspaceId, candidate, latest.revision);
          if (!current()) return;
          const resume = recovery ? selected.findIndex(d => d.id === position?.draftId) : 0;
          adopt(result); stored = edit; active = added[Math.max(0, resume)].id;
          close(); message(null); render();
          host?.querySelector("#ppBody")?.focus();
          if (recovery && resume >= 0 && position) {
            const input = host.querySelector("#ppBody");
            input?.setSelectionRange(position.start, position.end, position.direction);
            if (input) input.scrollTop = position.scrollTop;
          }
          message(added.length + "개를 비공개 새 초안으로 보관했습니다.");
        } catch (e) {
          if (!current()) return;
          status.setAttribute("role", "alert");
          status.textContent = (e.code === "page_draft_conflict" ? "다른 탭에서 초안이 바뀌었습니다." : e.message) + (recovery ? " 내 변경과 최신 보관본은 유지했습니다. 다시 시도하거나 초안 파일을 받을 수 있습니다." : " 기존 초안과 파일 선택은 유지했습니다. 다시 시도할 수 있습니다.");
        } finally {
          storing = false; busy = false;
          controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
          onDirty(); if (current()) { selection(); apply.focus({ preventScroll: true }); }
        }
      });
      function selection() { const n = choices.filter((el) => el.checked).length; count.textContent = recovery ? "내 변경 " + n + "개" : incoming.length + "개 중 " + n + "개 선택"; apply.disabled = !recovery && n === 0; }
      choices.forEach((input) => input.addEventListener("change", selection));
      foot.append(count);
      if (recovery) foot.append(button("내 초안 파일 받기", backup));
      foot.append(apply); body.append(status); dialog.append(head, body, foot);
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!storing) close(); });
      dialogClose = close; duplicateLabels(); selection(); document.body.append(dialog); document.body.style.overflow = "hidden"; dialog.showModal();
      if (recovery) exit.focus(); else choices[0].focus();
    }
    async function begin(target = null) {
      requireAppliedAttachment();
      await load();
      const previous = state.posts.find((p) =>
        target
          ? p.replaces === target
          : !p.replaces && !p.body && !p.attachments.length,
      );
      if (previous) {
        active = previous.id;
        render();
        return;
      }
      const d = M.draft(
        getPosts().concat(state.posts),
        life.Core.id(),
        now(),
        target,
      );
      state.posts.push(d);
      active = d.id;
      mark();
      render();
      host?.querySelector("#ppBody")?.focus();
    }
    async function returnToPosts() {
      await flush();
      if (onReturn && standalone) {
        await onReturn({ id: committedId || readId || active, committed: !!committedId });
        return;
      }
      active = null; readId = null; render();
    }
    function render() {
      if (!host || !state || !valid()) return;
      dialogClose?.();
      dialogClose = null;
      media.clear();
      host.replaceChildren();
      host.className = "pp-workspace";
      host.dataset.standalone = String(standalone);
      onModeChange({ mode: active ? "edit" : readId ? "read" : "list", id: active || readId });
      const bar = node("div", null, "pp-toolbar");
      if (standalone) bar.append(button(getReturnLabel(), returnToPosts, "back"));
      else bar.append(button("글쓰기", onNewPost || (() => begin()), "edit"));
      if (onNewPost && !standalone) {
        const legacy = node("details", null, "pp-legacy-writing");
        legacy.append(node("summary", "기존 글·첨부"), button("대상 첨부 글쓰기", () => begin()));
        bar.append(legacy);
      }
      const drafts = state.posts.filter((p) => p.id !== active).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (drafts.length && !standalone) {
        const list = node("details", null, "pp-drafts");
        list.append(node("summary", "초안 " + drafts.length));
        for (const d of drafts) {
          const name = draftTitle(d), row = button(name, () => {
            requireAppliedAttachment(); active = d.id; render();
            host?.querySelector("#ppBody")?.focus();
          });
          row.classList.add("pp-draft-row"); row.setAttribute("aria-label", name); row.replaceChildren(node("strong", name));
          const meta = node("span", draftDescription(d), "life-meta"); meta.id = "ppDraftMeta-" + d.id;
          row.setAttribute("aria-describedby", meta.id); row.append(meta); list.append(row);
        }
        bar.append(list);
      }
      const tools = node("details", null, "pp-draft-tools");
      tools.append(node("summary", "초안 파일"));
      tools.append(button("초안 파일 받기", backup));
      const input = node("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.setAttribute("aria-label", "초안 파일 불러오기");
      input.addEventListener("change", () =>
        importDrafts(input.files[0]).catch(message).finally(() => { input.value = ''; }),
      );
      tools.append(input);
      if (!standalone || active) bar.append(tools);
      if (
        getPosts().some((p) =>
          p.attachments.some((a) => life.PageMedia.describe(a)),
        ) ||
        state.posts.some((p) =>
          p.attachments.some((a) => life.PageMedia.describe(a)),
        )
      )
        bar.append(media.control());
      host.append(bar);
      const status = node("p", "", "life-help pp-status");
      status.setAttribute("role", "status");
      host.append(status);
      if (error) message(error);
      const d = state.posts.find((p) => p.id === active);
      if (d) editor(d);
      const feed = node("section", null, "pp-feed");
      feed.setAttribute("aria-label", "내 글 피드");
      const posts = getPosts()
        .filter(p => !standalone || !active && p.id === readId)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const p of posts) {
        const article = life.PagePostsView.post(p, { media, onCollect: collectAttachment }),
          meta = node("div", null, "pp-post-meta");
        meta.append(
          node(
            "span",
            (p.visibility === "private" ? "비공개" : "공개 후보") +
              " · " +
              '작성 ' + p.createdAt.slice(0, 10) +
              (p.updatedAt !== p.createdAt ? ' · 수정 ' + p.updatedAt.slice(0, 10) : ''),
            "life-meta",
          ),
          button("글 수정", () => begin(p.id), "edit"),
        );
        article.prepend(meta);
        article.dataset.postDate = p.updatedAt;
        feed.append(article);
      }
      if (!posts.length && !d && !standalone)
        feed.append(
          node(
            "p",
            "지금 떠오른 생각, 좋아하는 것부터 남겨 보세요.",
            "pp-empty",
          ),
        );
      if (onFeed && !standalone) onFeed([...feed.children]);
      else host.append(feed);
      if (standalone && readId && posts.length) {
        host.querySelector('.pp-read-more[aria-expanded="false"]')?.click();
        host.append(button(getReturnLabel(), returnToPosts));
      }
    }
    async function collectAttachment(value) {
      const token = epoch;
      if (!valid() || !host?.isConnected) return '';
      const item = life.Collection.fromAttachment(value, life.Core.id(), now());
      const collection = await storage.readCollection(workspaceId);
      if (!valid() || token !== epoch || !host?.isConnected) return '';
      const existing = life.Collection.attachmentMatch(collection.items,item);
      if (existing) return existing.archived ? '보관함에 있는 항목입니다. 기존 메모를 유지했습니다.' : '이미 컬렉션에 있습니다. 기존 메모를 유지했습니다.';
      collection.items.push(item);
      try { await storage.saveCollection(workspaceId,collection,collection.revision); }
      catch (e) {
        if (e.code === 'collection_conflict') throw new Error('다른 탭에서 컬렉션이 바뀌었습니다. 다시 누르면 최신 항목을 확인합니다.');
        throw e;
      }
      return valid() && token === epoch ? '컬렉션에 보관했습니다. 글과 별도로 이 브라우저에 저장됩니다.' : '';
    }
    function editor(d) {
      const form = node("section", null, "pp-composer");
      form.setAttribute("aria-label", "페이지 글쓰기");
      const area = node("textarea");
      area.id = "ppBody";
      area.maxLength = M.LIMITS.body;
      area.rows = 5;
      area.placeholder = "지금 어떤 생각을 하고 있나요?";
      area.setAttribute("aria-label", "글 본문");
      area.value = d.body;
      area.addEventListener("compositionstart", () => {
        composing = true;
        clearTimeout(timer);
      });
      area.addEventListener("compositionend", () => {
        composing = false;
        mark();
      });
      area.addEventListener("input", () => {
        d.body = area.value;
        d.updatedAt = now();
        mark();
      });
      form.append(area);
      const attached = node("div", null, "pp-edit-attachments");
      form.append(attached);
      function update() {
        if (attached.contains(manual)) form.insertBefore(manual, attached.nextSibling);
        attached.replaceChildren();
        d.attachments.forEach((a, index) => {
          const row = node("div", null, "pp-edit-attachment");
          row.dataset.attachmentIndex = String(index);
          row.append(life.PagePostsView.attachments([a], { compact: true }));
          const actions = node("div", null, "pp-card-actions");
          const up = button(
            a.title + " 위로",
            () => {
              requireAppliedAttachment();
              [d.attachments[index - 1], d.attachments[index]] = [
                d.attachments[index],
                d.attachments[index - 1],
              ];
              mark();
              update();
              focusAttachment(index - 1);
            },
            "up",
          );
          up.disabled = index === 0;
          const editAttachment = button(a.title + " 첨부 정보 수정", () => {
            requireAppliedAttachment();
            enter(a, '이 글에 붙인 정보만 수정합니다. 컬렉션 원본은 바꾸지 않습니다.', a);
          }, "edit");
          editAttachment.classList.add('pp-attachment-edit');
          actions.append(
            up,
            editAttachment,
            button(
              a.title + " 첨부 해제",
              () => {
                requireAppliedAttachment();
                d.attachments.splice(index, 1);
                mark();
                update();
                focusAttachment(Math.min(index, d.attachments.length - 1));
              },
              "close",
            ),
          );
          row.append(actions);
          attached.append(row);
        });
      }
      function focusAttachment(index) {
        const row = attached.querySelector('[data-attachment-index="' + index + '"]');
        (row?.querySelector('.pp-attachment-edit') || add).focus({preventScroll:true});
      }
      function attach(value) {
        if (d.attachments.length >= M.LIMITS.attachments)
          throw new Error("첨부는 12개까지 넣을 수 있습니다.");
        d.attachments.push(M.attachment(value));
        d.updatedAt = now();
        mark();
        update();
      }
      const manual = node("div", null, "pp-manual");
      manual.hidden = true;
      form.append(manual);
      manual.addEventListener('compositionstart', () => { if (attachmentReview) attachmentReview.composing = true; });
      manual.addEventListener('compositionend', () => { if (attachmentReview) attachmentReview.composing = false; });
      manual.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (attachmentReview?.composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
      });
      function enter(seed, review, target = null) {
        requireAppliedAttachment();
        const targetRow = target && attached.querySelector('[data-attachment-index="' + d.attachments.indexOf(target) + '"]');
        if (targetRow) attached.insertBefore(manual, targetRow.nextSibling);
        else form.insertBefore(manual, attached.nextSibling);
        manual.hidden = false;
        manual.replaceChildren();
        if (review) manual.append(node("p", review, "life-help"));
        manual.append(node('p', target ? '수정 반영 후 글을 저장하세요.' : '첨부를 눌러 반영한 뒤 글을 저장하세요.', 'life-help'));
        const select = node("select");
        select.setAttribute("aria-label", "첨부 종류");
        for (const [key, label] of Object.entries(life.Collection.TYPES)) {
          const option = node("option", label);
          option.value = key;
          select.append(option);
        }
        select.value = seed.type || "music";
        manual.append(select);
        const inputs = {};
        for (const [key, label] of [
          ["title", "제목 또는 이름"],
          ["creator", "아티스트·저자"],
          ["url", "출처 링크"],
        ]) {
          const input = node("input");
          input.setAttribute("aria-label", label);
          input.placeholder = label;
          input.value = seed[key] || "";
          input.maxLength = key === "url" ? 2048 : 500;
          inputs[key] = input;
          manual.append(input);
        }
        const source = node("a", "원출처 열기", "life-button");
        source.target = "_blank"; source.rel = "noopener noreferrer";
        source.setAttribute("aria-label", "원출처 열기 · 새 탭");
        function refreshSource() {
          try {
            const url = life.Share.safeURL(inputs.url.value);
            source.hidden = !url;
            if (url) source.href = url; else source.removeAttribute("href");
          } catch (_) { source.hidden = true; source.removeAttribute("href"); }
        }
        inputs.url.addEventListener("input", refreshSource);
        refreshSource(); manual.append(source);
        const creator = () => {
          const label = select.value === "artwork" ? "작가" : "아티스트·저자";
          inputs.creator.setAttribute("aria-label", label); inputs.creator.placeholder = label;
          inputs.creator.disabled = select.value === "person";
          if (inputs.creator.disabled) inputs.creator.value = "";
        };
        select.addEventListener("change", creator);
        creator();
        const pending = { composing: false, focus: () => { if (!pending.composing) inputs.title.focus({preventScroll:true}); } };
        attachmentReview = pending;
        onDirty();
        manual.append(
          button(target ? "수정 반영" : "첨부", () => {
            if (pending.composing) throw new Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
            const next = M.attachment({
              type: select.value,
              ...Object.fromEntries(
                Object.entries(inputs).map(([k, v]) => [k, v.value]),
              ),
            });
            const index = target ? d.attachments.indexOf(target) : -1;
            if (target && index < 0) throw new Error('수정할 첨부를 찾지 못했습니다. 입력은 그대로 남아 있습니다.');
            if (target) { d.attachments[index] = next; d.updatedAt = now(); mark(); update(); }
            else attach(next);
            attachmentReview = null;
            manual.hidden = true;
            message(null); onDirty();
            if (target) focusAttachment(index); else add.focus({ preventScroll: true });
          }),
          button("입력 취소", () => {
            if (pending.composing) throw new Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
            attachmentReview = null;
            manual.hidden = true;
            message(null); onDirty();
            if (target) focusAttachment(d.attachments.indexOf(target)); else add.focus({ preventScroll: true });
          }),
        );
        inputs.title.focus();
      }
      const bottom = node("div", null, "pp-compose-actions"),
        add = button(
          "음악·책·대상 붙이기",
          async () => {
            requireAppliedAttachment();
            const token = epoch;
            add.disabled = true;
            try {
              let items = [];
              try {
                items = (await storage.readCollection(workspaceId)).items;
              } catch (e) {
                message(
                  new Error(
                    "컬렉션을 읽지 못했습니다. 직접 입력은 사용할 수 있습니다.",
                  ),
                );
              }
              if (!valid() || token !== epoch || !host?.isConnected) return;
              add.disabled = false;
              add.focus({ preventScroll: true });
              dialogClose = life.CollectionPicker.open({
                items,
                purpose: "attach",
                isCurrent: () => valid() && token === epoch,
                onSelect: (value) => {
                  try {
                    if (value.item) attach(value.item);
                    else if (value.compact && value.seed.title)
                      attach({ ...value.seed, creator: "" });
                    else enter(value.seed || {}, value.review);
                  } catch (e) {
                    message(e);
                  }
                },
              });
            } finally {
              add.disabled = false;
            }
          },
          "plus",
        );
      const scope = node("select");
      scope.id = "ppVisibility";
      scope.setAttribute("aria-label", "글 공개 범위");
      for (const [value, label] of [
        ["private", "비공개"],
        ["page", "공개 후보"],
      ]) {
        const option = node("option", label);
        option.value = value;
        scope.append(option);
      }
      scope.value = d.visibility;
      scope.addEventListener("change", () => {
        d.visibility = scope.value;
        mark();
      });
      const hint = node(
        "p",
        "초안은 이 브라우저에 보관합니다. 공개 후보도 공개 사본을 갱신하기 전에는 공개되지 않습니다.",
        "life-help",
      );
      async function finish(asNew = false) {
        if (composing) return;
        requireAppliedAttachment();
        busy = true;
        form
          .querySelectorAll("button,input,textarea,select")
          .forEach((el) => (el.disabled = true));
        try {
          await flush();
          const result = await commit(d.id, state.revision, { asNew });
          adopt(result.drafts);
          stored = edit;
          active = null;
          if (standalone) { readId = result.id; committedId = result.id; }
          render();
          onCommitted({ id: result.id, previousId: d.replaces || null, status: "saved" });
          if (standalone) message("비공개 글을 저장했어요.");
          if (!valid() || !host) return;
          const target = [...(standalone ? host : getFeedHost?.() || host).querySelectorAll("[data-post-id]")].find(
            (el) => el.dataset.postId === result.id,
          );
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: "nearest" });
        } finally {
          busy = false;
          if (form.isConnected) {
            form
              .querySelectorAll("button,input,textarea,select")
              .forEach((el) => (el.disabled = false));
            update();
          }
        }
      }
      const save = button(standalone ? "글 저장" : "저장", () => finish());
      save.classList.add("pp-save");
      bottom.append(
        add,
        scope,
        button("초안 닫기", async () => {
          await returnToPosts();
        }),
        save,
      );
      const more = node("details", null, "pp-post-options");
      more.append(node("summary", "더 보기"));
      if (d.replaces) more.append(button("새 글로 저장", () => finish(true)));
      more.append(
        button("초안 버리기", async () => {
          requireAppliedAttachment();
          if (!root.confirm("이 초안만 버릴까요? 저장한 글은 유지됩니다."))
            return;
          await flush();
          busy = true;
          const controls = [
            ...form.querySelectorAll("button,input,textarea,select"),
          ].map((n) => [n, n.disabled]);
          controls.forEach(([n]) => {
            n.disabled = true;
          });
          const candidate = structuredClone(state);
          candidate.posts = candidate.posts.filter((p) => p.id !== d.id);
          saving = storage
            .savePageDrafts(workspaceId, candidate, state.revision)
            .then((result) => {
              adopt(result);
            });
          try {
            await saving;
            active = null;
            render();
          } finally {
            saving = null;
            busy = false;
            controls.forEach(([n, disabled]) => {
              if (n.isConnected) n.disabled = disabled;
            });
            onDirty();
          }
        }),
      );
      bottom.append(more);
      form.append(bottom, hint);
      host.append(form);
      update();
    }
    async function mount(target, { draftId = null, postId = null, standalone: isolated = false } = {}) {
      host = target; standalone = isolated; readId = isolated ? postId : null; committedId = null;
      if (isolated && !draftId) active = null;
      const token = ++epoch;
      host.append(node("p", "초안을 불러오는 중…", "life-help"));
      try {
        if (draftId) {
          await flush();
          const fresh = await storage.readPageDrafts(workspaceId);
          if (token !== epoch || !valid()) return;
          if (!fresh.posts.some(p => p.id === draftId)) throw new Error('선택한 초안을 찾지 못했습니다. 초안 보관함에서 다시 확인해 주세요.');
          adopt(fresh); active = draftId;
        } else await load();
        if (token === epoch && valid()) { render();
          if (postId) {
            const post = [...(standalone ? host : getFeedHost?.() || host).querySelectorAll('[data-post-id]')].find(el => el.dataset.postId === postId);
            if (!post) throw new Error('선택한 글이 없습니다. 검색 결과를 다시 불러와 주세요.');
            post.querySelector('.pp-read-more[aria-expanded="false"]')?.click(); post.focus({ preventScroll: true }); post.scrollIntoView({ block: 'start' });
          } if (draftId) { const input = host?.querySelector('#ppBody'); input?.focus(); input?.setSelectionRange(0, 0); if (input) input.scrollTop = 0; } }
      } catch (e) {
        if (token === epoch) {
          host.replaceChildren(button("다시 불러오기", () => mount(target, { draftId, postId, standalone: isolated })));
          const p = node("p", e.message, "pp-status");
          p.setAttribute("role", "alert");
          host.append(p);
        }
      }
    }
    function detach() {
      onModeChange({ mode: "detached", id: active || readId });
      media.reset();
      epoch++;
      dialogClose?.();
      dialogClose = null;
      host = null;
      composing = false;
      attachmentReview = null;
    }
    return {
      mount,
      context: () => ({ draftId: active, postId: readId, standalone }),
      detach,
      flush,
      hasUnappliedAttachment: () => !!attachmentReview,
      hasDraftConflict: () => draftConflict,
      dirty: () => !!saving || busy || edit !== stored || !!attachmentReview,
      dispose() {
        disposed = true;
        media.dispose();
        clearTimeout(timer);
        detach();
      },
    };
  }
  life.PageComposer = { create };
})(globalThis);
