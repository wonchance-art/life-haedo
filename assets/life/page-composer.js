/* Local drafts; explicit atomic save into the owner's page. No automatic publication. */
(function (root) {
  "use strict";
  const life = root.HaedoLife,
    M = life.PagePosts;
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
  }) {
    let state = null,
      loading = null,
      edit = 0,
      stored = 0,
      saving = null,
      timer = null,
      host = null,
      active = null,
      dialogClose = null,
      epoch = 0,
      busy = false,
      disposed = false,
      composing = false,
      error = null;
    const media = life.PageMedia.create();
    const now = () => new Date().toISOString();
    const valid = () => !disposed && isCurrent();
    function message(value) {
      error = value;
      if (host) {
        const n = host.querySelector(".pp-status");
        if (n) {
          n.textContent = value?.message || value || "";
          n.setAttribute("role", value ? "alert" : "status");
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
            state = value;
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
      if (!composing) timer = setTimeout(() => flush().catch(message), 650);
    }
    async function flush() {
      clearTimeout(timer);
      if (saving) {
        await saving;
        return flush();
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
      if (edit !== stored) return flush();
    }
    function backup() {
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
      if (file.size > 2097152)
        throw new Error("2 MiB 이하의 초안 파일을 골라 주세요.");
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
      if (
        !value ||
        value.format !== "life-page-drafts-v1" ||
        Object.keys(value).some((k) => !["format", "posts"].includes(k))
      )
        throw new Error("페이지 초안 파일을 골라 주세요.");
      M.validate(value.posts);
      if (value.posts.some((p) => p.status !== "draft"))
        throw new Error("작성 중인 초안만 불러올 수 있습니다.");
      if (!valid()) return;
      const added = value.posts.map((p) => ({
        ...p,
        id: life.Core.id(),
        replaces: null,
        baseUpdatedAt: null,
        visibility: "private",
      }));
      M.validate(state.posts.concat(added));
      state.posts.push(...added);
      mark();
      await flush();
      active = added[0]?.id || null;
      render();
    }
    async function begin(target = null) {
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
    function render() {
      if (!host || !state || !valid()) return;
      dialogClose?.();
      dialogClose = null;
      media.clear();
      host.replaceChildren();
      host.className = "pp-workspace";
      const bar = node("div", null, "pp-toolbar");
      bar.append(button("글쓰기", () => begin(), "edit"));
      const drafts = state.posts.filter((p) => p.id !== active);
      if (drafts.length) {
        const list = node("details", null, "pp-drafts");
        list.append(node("summary", "초안 " + drafts.length));
        for (const d of drafts)
          list.append(
            button(
              d.body.trim().slice(0, 45) ||
                d.attachments[0]?.title ||
                "작성 중인 글",
              () => {
                active = d.id;
                render();
              },
            ),
          );
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
        importDrafts(input.files[0]).catch(message),
      );
      tools.append(input);
      bar.append(tools);
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
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const p of posts) {
        const article = life.PagePostsView.post(p, { media }),
          meta = node("div", null, "pp-post-meta");
        meta.append(
          node(
            "span",
            (p.visibility === "private" ? "비공개" : "공개 후보") +
              " · " +
              p.createdAt.slice(0, 10),
            "life-meta",
          ),
          button("글 수정", () => begin(p.id), "edit"),
        );
        article.prepend(meta);
        feed.append(article);
      }
      if (!posts.length && !d)
        feed.append(
          node(
            "p",
            "지금 떠오른 생각, 좋아하는 것부터 남겨 보세요.",
            "pp-empty",
          ),
        );
      host.append(feed);
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
        attached.replaceChildren();
        d.attachments.forEach((a, index) => {
          const row = node("div", null, "pp-edit-attachment");
          row.append(life.PagePostsView.attachments([a], { compact: true }));
          const actions = node("div", null, "pp-card-actions");
          const up = button(
            a.title + " 위로",
            () => {
              [d.attachments[index - 1], d.attachments[index]] = [
                d.attachments[index],
                d.attachments[index - 1],
              ];
              mark();
              update();
            },
            "up",
          );
          up.disabled = index === 0;
          actions.append(
            up,
            button(
              a.title + " 첨부 해제",
              () => {
                d.attachments.splice(index, 1);
                mark();
                update();
              },
              "close",
            ),
          );
          row.append(actions);
          attached.append(row);
        });
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
      function enter(seed) {
        manual.hidden = false;
        manual.replaceChildren();
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
        const creator = () => {
          inputs.creator.disabled = select.value === "person";
          if (inputs.creator.disabled) inputs.creator.value = "";
        };
        select.addEventListener("change", creator);
        creator();
        manual.append(
          button("첨부", () => {
            attach({
              type: select.value,
              ...Object.fromEntries(
                Object.entries(inputs).map(([k, v]) => [k, v.value]),
              ),
            });
            manual.hidden = true;
          }),
          button("입력 취소", () => {
            manual.hidden = true;
          }),
        );
        inputs.title.focus();
      }
      const bottom = node("div", null, "pp-compose-actions"),
        add = button(
          "음악·책·대상 붙이기",
          async () => {
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
                    else enter(value.seed || {});
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
        busy = true;
        form
          .querySelectorAll("button,input,textarea,select")
          .forEach((el) => (el.disabled = true));
        try {
          await flush();
          const result = await commit(d.id, state.revision, { asNew });
          state = result.drafts;
          stored = edit;
          active = null;
          render();
          if (!valid() || !host) return;
          const target = [...host.querySelectorAll("[data-post-id]")].find(
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
      const save = button("저장", () => finish());
      save.classList.add("pp-save");
      bottom.append(
        add,
        scope,
        button("초안 닫기", async () => {
          await flush();
          active = null;
          render();
        }),
        save,
      );
      const more = node("details", null, "pp-post-options");
      more.append(node("summary", "더 보기"));
      if (d.replaces) more.append(button("새 글로 저장", () => finish(true)));
      more.append(
        button("초안 버리기", async () => {
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
              state = result;
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
    async function mount(target, { draftId = null } = {}) {
      host = target;
      const token = ++epoch;
      host.append(node("p", "초안을 불러오는 중…", "life-help"));
      try {
        if (draftId) {
          await flush();
          const fresh = await storage.readPageDrafts(workspaceId);
          if (token !== epoch || !valid()) return;
          if (!fresh.posts.some(p => p.id === draftId)) throw new Error('선택한 초안을 찾지 못했습니다. 초안 보관함에서 다시 확인해 주세요.');
          state = fresh; active = draftId;
        } else await load();
        if (token === epoch && valid()) { render(); if (draftId) { const input = host?.querySelector('#ppBody'); input?.focus(); input?.setSelectionRange(0, 0); if (input) input.scrollTop = 0; } }
      } catch (e) {
        if (token === epoch) {
          host.replaceChildren(button("다시 불러오기", () => mount(target, { draftId })));
          const p = node("p", e.message, "pp-status");
          p.setAttribute("role", "alert");
          host.append(p);
        }
      }
    }
    function detach() {
      media.reset();
      epoch++;
      dialogClose?.();
      dialogClose = null;
      host = null;
      composing = false;
    }
    return {
      mount,
      detach,
      flush,
      dirty: () => !!saving || busy || edit !== stored,
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
