/* The rich-text adapter reuses the existing picker, attachment projection and cards. */
(function (root) {
  "use strict";
  const life = root.HaedoLife;
  function create({
    host,
    storage,
    workspaceId,
    getValues,
    onChange,
    isCurrent,
    onDirty,
    report,
  }) {
    let review = null,
      closePicker = null,
      disposed = false,
      choosing = false;
    const node = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const valid = () => !disposed && host.isConnected && isCurrent();
    const pending = () => !!review || choosing || !!closePicker;
    function flush() {
      if (review) {
        if (!review.composing) review.title.focus();
        throw new Error(
          review.composing
            ? "한글 입력을 마친 뒤 첨부에 반영해 주세요."
            : "첨부 입력을 먼저 반영하거나 입력 취소를 눌러 주세요. 글은 그대로 남아 있습니다.",
        );
      }
      if (choosing || closePicker)
        throw new Error("대상 선택을 마치거나 선택창을 닫아 주세요.");
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
        if (!valid()) return;
        try {
          await task();
        } catch (e) {
          if (valid()) report(e);
        }
      });
      return b;
    }
    function apply(values) {
      life.PagePosts.validateAttachments(values);
      onChange(values);
      render();
    }
    function edit(seed, target = -1, notice = "") {
      flush();
      const form = node("section", null, "pp-manual photo-attachment-review");
      form.setAttribute("aria-label", "첨부 정보 확인");
      if (notice) form.append(node("p", notice, "life-help"));
      form.append(
        node(
          "p",
          target >= 0
            ? "이 글에 붙인 정보만 수정합니다. 컬렉션 원본은 유지됩니다."
            : "확인한 정보만 이 글에 붙입니다. 컬렉션 메모와 태그는 복사하지 않습니다.",
          "life-help",
        ),
      );
      const type = node("select");
      type.setAttribute("aria-label", "첨부 종류");
      for (const [key, label] of Object.entries(life.Collection.TYPES)) {
        const o = node("option", label);
        o.value = key;
        type.append(o);
      }
      type.value = seed.type || "music";
      const inputs = {};
      form.append(type);
      for (const [key, label] of [
        ["title", "제목 또는 이름"],
        ["creator", "아티스트·저자"],
        ["url", "출처 링크"],
      ]) {
        const wrapper = node("label", label),
          input = node("input");
        input.setAttribute("aria-label", label);
        input.value = seed[key] || "";
        input.maxLength = key === "url" ? 2048 : 500;
        inputs[key] = input;
        wrapper.append(input);
        form.append(wrapper);
      }
      const syncCreator = () => {
        inputs.creator.disabled = type.value === "person";
        if (inputs.creator.disabled) inputs.creator.value = "";
        inputs.creator.setAttribute(
          "aria-label",
          type.value === "artwork" ? "작가" : "아티스트·저자",
        );
      };
      type.addEventListener("change", syncCreator);
      syncCreator();
      review = { composing: false, title: inputs.title };
      onDirty();
      form.addEventListener("compositionstart", () => {
        if (review) review.composing = true;
      });
      form.addEventListener("compositionend", () => {
        if (review) review.composing = false;
      });
      const actions = node("div", null, "life-actions");
      actions.append(
        button(target >= 0 ? "수정 반영" : "첨부", () => {
          if (review.composing)
            throw new Error("한글 입력을 마친 뒤 다시 시도해 주세요.");
          const value = life.PagePosts.attachment({
            type: type.value,
            ...Object.fromEntries(
              Object.entries(inputs).map(([key, input]) => [key, input.value]),
            ),
          });
          const next = getValues().slice();
          if (target >= 0) next[target] = value;
          else next.push(value);
          // Validation and the owner's update must succeed before review input is removed.
          life.PagePosts.validateAttachments(next);
          onChange(next);
          review = null;
          render();
          onDirty();
          host
            .querySelector(
              '[data-attachment-index="' +
                (target >= 0 ? target : next.length - 1) +
                '"] .photo-attachment-edit',
            )
            ?.focus();
        }),
        button("입력 취소", () => {
          if (review.composing)
            throw new Error("한글 입력을 마친 뒤 다시 시도해 주세요.");
          review = null;
          render();
          report(null);
          onDirty();
          host.querySelector(".photo-attachment-add")?.focus();
        }),
      );
      form.append(actions);
      host.append(form);
      inputs.title.focus();
    }
    async function choose() {
      flush();
      choosing = true;
      onDirty();
      let items = [];
      try {
        try {
          items = (await storage.readCollection(workspaceId)).items;
        } catch (_) {
          if (valid())
            report(
              new Error(
                "컬렉션을 읽지 못했습니다. 직접 입력은 사용할 수 있습니다.",
              ),
            );
        }
        if (!valid()) return;
        closePicker = life.CollectionPicker.open({
          items,
          purpose: "attach",
          isCurrent: valid,
          onSelect: (value) => {
            closePicker = null;
            onDirty();
            if (!valid()) return;
            try {
              if (value.item)
                apply(
                  getValues().concat(life.PagePosts.attachment(value.item)),
                );
              else edit(value.seed || {}, -1, value.review || "");
            } catch (e) {
              report(e);
            }
          },
          onClose: () => {
            closePicker = null;
            onDirty();
          },
        });
      } finally {
        choosing = false;
        onDirty();
      }
    }
    function render() {
      if (!valid()) return;
      host.replaceChildren();
      const rows = node("div", null, "photo-edit-attachments");
      getValues().forEach((item, i) => {
        const row = node("section", null, "photo-edit-attachment"),
          actions = node("div", null, "life-actions");
        row.dataset.attachmentIndex = String(i);
        row.append(life.PagePostsView.attachments([item], { compact: true }));
        const move = (direction) => {
          flush();
          const next = getValues().slice();
          [next[i], next[i + direction]] = [next[i + direction], next[i]];
          apply(next);
          host
            .querySelector(
              '[data-attachment-index="' +
                (i + direction) +
                '"] .photo-attachment-edit',
            )
            ?.focus();
        };
        const up = button(item.title + " 위로", () => move(-1), "up"),
          down = button(item.title + " 아래로", () => move(1), "chevron");
        up.disabled = i === 0;
        down.disabled = i === getValues().length - 1;
        const editButton = button(
          item.title + " 첨부 정보 수정",
          () => edit(item, i),
          "edit",
        );
        editButton.classList.add("photo-attachment-edit");
        actions.append(
          up,
          down,
          editButton,
          button(
            item.title + " 첨부 해제",
            () => {
              flush();
              apply(getValues().filter((_, at) => at !== i));
              host.querySelector(".photo-attachment-add")?.focus();
            },
            "close",
          ),
        );
        row.append(actions);
        rows.append(row);
      });
      const add = button("음악·책·대상 붙이기", choose);
      add.classList.add("photo-attachment-add");
      add.disabled = getValues().length >= life.PagePosts.LIMITS.attachments;
      host.append(rows, add);
    }
    render();
    return {
      flush,
      pending,
      composing: () => review?.composing === true,
      dispose() {
        disposed = true;
        closePicker?.();
        closePicker = null;
        review = null;
      },
    };
  }
  life.PhotoPostAttachments = { create };
})(globalThis);
