(async function () {
  const auth = HaedoAuth,
    model = HaedoPlatformData,
    store = HaedoPlatformStore;
  const page = document.body.dataset.page,
    byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#p-" + name);
    svg.append(use);
    return svg;
  };
  const link = (text, href, className = "") => {
    const node = el("a", className, text);
    node.href = href;
    return node;
  };
  let toastTimer,
    uid,
    editing,
    filter = "active",
    legacy,
    legacySaved = false,
    syncWarning = "",
    conflictId,
    syncing = false,
    syncChecked = false;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  function toast(message) {
    const node = byId("platformToast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 4200);
  }
  function download(data, name) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const anchor = link("", url);
    anchor.download = name + "-" + HaedoData.localDate() + ".json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setAccount(user) {
    const login = document.querySelector("[data-login-link]");
    if (login) login.hidden = true;
    const accountMenu = document.querySelector("[data-account-menu]");
    if (accountMenu) accountMenu.hidden = false;
    const logout = document.querySelector("[data-logout]");
    if (logout) logout.hidden = false;
    if (logout) logout.onclick = async () => {
      logout.disabled = true;
      try {
        await auth.signOut();
      } catch (_) {
        toast("로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.");
        logout.disabled = false;
      }
    };
    if (byId("accountLabel"))
      byId("accountLabel").textContent =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "내 계정";
  }
  if ("serviceWorker" in navigator && location.protocol.startsWith("http"))
    navigator.serviceWorker.register("sw.js").catch(() => {});
  if (page === "home" || page === "privacy") {
    try {
      const user = await auth.verify();
      if (user) setAccount(user);
    } catch (_) {
      /* Public home stays usable offline. */
    }
    return;
  }
  if (page === "login") {
    const message = byId("loginMessage"),
      button = byId("googleLogin");
    const next = auth.safeNext(
      new URLSearchParams(location.search).get("next"),
    );
    if (!auth.ready) {
      button.disabled = true;
      message.textContent =
        "Google 로그인 연결을 준비 중입니다. 기존 기록은 기기에 그대로 보관돼 있습니다.";
      return;
    }
    button.disabled = true;
    try {
      const user = await auth.verify();
      if (user) {
        location.replace(next);
        return;
      }
      const settings = await fetch(auth.config.url + "/auth/v1/settings", {
        headers: { apikey: auth.config.key },
      });
      if (!settings.ok) throw new Error();
      if (!(await settings.json()).external?.google) {
        message.textContent =
          "Google 로그인 연결을 준비 중입니다. 연결이 완료되면 이곳에서 시작할 수 있습니다.";
        return;
      }
      button.disabled = false;
      const params = new URLSearchParams(location.search);
      if (params.has("error")) {
        message.textContent =
          "로그인을 완료하지 못했습니다. 다시 시도해 주세요.";
        history.replaceState(
          null,
          "",
          "login.html?next=" + encodeURIComponent(next),
        );
      }
    } catch (_) {
      message.textContent =
        "로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.";
      return;
    }
    button.onclick = async () => {
      button.disabled = true;
      message.textContent = "Google 로그인으로 이동합니다.";
      try {
        await auth.login(next);
      } catch (_) {
        message.textContent =
          "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        button.disabled = false;
      }
    };
    return;
  }
  try {
    const user = await auth.requireUser();
    if (!user) return;
    uid = user.id;
    setAccount(user);
    store.init(uid);
    byId("accessState").hidden = true;
    document.querySelector("[data-private]").hidden = false;
  } catch (_) {
    byId("accessState").querySelector("p").textContent =
      "개인 공간을 열지 못했습니다. 인터넷 연결을 확인해 주세요. 기기의 기록은 보존돼 있습니다.";
    byId("accessRetry").hidden = false;
    byId("accessRetry").onclick = () => location.reload();
    return;
  }
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.onclick = () => byId(button.dataset.close).close();
  });
  document.querySelectorAll(".p-dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          dialog.close();
      }
    });
  });
  function empty(container, text, action, target) {
    const node = el("div", "p-empty");
    node.append(el("p", "", text));
    if (typeof target === "function") {
      const button = el("button", "p-button", action);
      button.onclick = target;
      node.append(button);
    } else if (target) node.append(link(action, target, "p-button"));
    container.append(node);
  }
  function status() {
    const states = store.items.map((item) => item.state);
    const docs = model.registry(localStorage, uid).docs;
    let text =
      syncWarning ||
      (syncChecked
        ? "서버와 기기 사본을 확인했습니다."
        : "서버 동기화를 확인하고 있습니다.");
    if (
      !syncWarning &&
      (states.includes("conflict") ||
        docs.some((d) => d.syncedAt && d.updated !== d.syncedAt))
    )
      text = "서버와 다른 변경 사항이 있습니다. 기기 사본을 보존했습니다.";
    else if (!syncWarning && states.includes("err"))
      text = "기기에 저장했습니다. 연결 후 동기화를 다시 시도해 주세요.";
    else if (
      !syncWarning &&
      (states.includes("sync") || docs.some((d) => !d.syncedAt))
    )
      text = "기기에 저장했습니다. 서버와 동기화하고 있습니다.";
    byId("syncMessage").textContent = text;
    byId("syncMessage").closest(".p-status-line").dataset.idle = String(text === "서버와 기기 사본을 확인했습니다.");
  }
  function resolveButton(item, parent) {
    if (item.state !== "conflict") return;
    const button = el("button", "p-text-link", "사본 선택");
    button.onclick = () => {
      conflictId = item.id;
      byId("useRemote").disabled = byId("useLocal").disabled = true;
      byId("conflictMessage").textContent = "";
      byId("conflictDialog").showModal();
    };
    parent.append(button);
  }
  function goalRow(item, compact = false) {
    const row = el("div", "goal-row"),
      copy = el("button", "goal-copy");
    copy.append(el("strong", "", item.data.title));
    const overdue =
      item.data.target &&
      item.data.target < HaedoData.localDate() &&
      item.data.progress < 100;
    copy.append(
      el(
        "small",
        "",
        item.data.target
          ? item.data.target + (overdue ? " · 마감일 지남" : " 마감")
          : "마감일 없음",
      ),
    );
    copy.setAttribute("aria-label", item.data.title + " 수정");
    copy.onclick = () => openItem("goal", item);
    const progress = el("div", "goal-progress"),
      meter = el("progress");
    meter.max = 100;
    meter.value = item.data.progress;
    meter.setAttribute("aria-label", item.data.title + " 진행률");
    progress.append(meter, el("span", "", item.data.progress + "%"));
    row.append(copy, progress);
    if (!compact) {
      const done = item.data.progress === 100,
        complete = el(
          "button",
          "p-icon-button goal-complete" + (done ? " done" : ""),
        );
      complete.append(icon("check"));
      complete.setAttribute(
        "aria-label",
        item.data.title + (done ? " 완료 취소" : " 완료"),
      );
      complete.onclick = () => {
        try {
          store.change(item.id, "goal", {
            ...item.data,
            progress: done ? item.data.previousProgress || 0 : 100,
            previousProgress: done ? 0 : item.data.progress,
          });
          toast(done ? "목표 완료를 취소했습니다." : "목표를 완료했습니다.");
        } catch (e) {
          toast(e.message);
        }
      };
      row.append(complete);
    }
    resolveButton(item, row);
    return row;
  }
  function checkHabit(item, date) {
    try {
      store.change(
        item.id,
        "habit",
        model.toggleHabit(item.data, date, HaedoData.localDate()),
      );
    } catch (e) {
      toast(e.message);
    }
  }
  function todayRow(item) {
    const today = HaedoData.localDate(),
      row = el("div", "today-row"),
      copy = el("div");
    copy.append(
      el("span", "", item.data.title),
      el("p", "", "연속 " + model.streak(item.data, today) + "회"),
    );
    const done = item.data.checks.includes(today),
      button = el(
        "button",
        "habit-check" + (done ? " done" : ""),
        done ? "✓" : "",
      );
    button.setAttribute(
      "aria-label",
      item.data.title + (done ? " 오늘 완료 취소" : " 오늘 완료"),
    );
    button.setAttribute("aria-pressed", String(done));
    button.onclick = () => checkHabit(item, today);
    row.append(copy, button);
    resolveButton(item, row);
    return row;
  }
  function renderWorkspace() {
    const list = byId("documentList"),
      k = model.keys(uid),
      docs = model.registry(localStorage, uid).docs;
    list.replaceChildren();
    for (const doc of docs) {
      const row = el("div", "document-row"),
        copy = el("div"),
        data = model.read(localStorage, k.docs + doc.id, null);
      copy.append(
        link(doc.name, "timeline.html?doc=" + encodeURIComponent(doc.id)),
      );
      copy.firstChild.className = "document-title";
      if (data)
        copy.append(
          el(
            "p",
            "",
            "사건 " +
              (data.events?.length || 0) +
              " · 기간 " +
              (data.spans?.length || 0),
          ),
        );
      else
        copy.append(
          el("p", "", "기기 사본을 읽지 못했습니다. 원본은 보존했습니다."),
        );
      const links = el("div", "document-links");
      links.append(
        link("연표", "timeline.html?doc=" + encodeURIComponent(doc.id)),
        link(
          "기록",
          "timeline.html?view=records&doc=" + encodeURIComponent(doc.id),
        ),
        link(
          "지도",
          "timeline.html?view=map&doc=" + encodeURIComponent(doc.id),
        ),
      );
      row.append(copy, links);
      list.append(row);
    }
    if (!docs.length)
      empty(
        list,
        "아직 연결된 연표가 없습니다. 새 연표를 만들거나 기존 백업을 가져오세요.",
        "새 연표",
        openNewTimeline,
      );
  }
  function renderGoals() {
    const goals = store.items.filter((item) => item.kind === "goal"),
      visible = goals.filter(
        (item) =>
          filter === "all" ||
          (item.data.progress === 100
            ? filter === "done"
            : filter === "active"),
      );
    visible.sort((a, b) =>
      (a.data.target || "9999").localeCompare(b.data.target || "9999"),
    );
    byId("itemCount").textContent = visible.length + "개";
    byId("goalList").replaceChildren(...visible.map((item) => goalRow(item)));
    if (!visible.length)
      empty(
        byId("goalList"),
        filter === "done"
          ? "완료한 목표가 아직 없습니다."
          : "첫 목표를 정해보세요.",
        filter === "done" ? "" : "목표 추가",
        filter === "done" ? null : () => openItem("goal"),
      );
  }
  function renderHabits() {
    const today = HaedoData.localDate(),
      dates = Array.from({ length: 7 }, (_, i) => model.addDays(today, i - 6));
    const habits = store.items.filter((item) => item.kind === "habit");
    byId("habitWeekLabel").textContent =
      dates[0].slice(5) + " — " + today.slice(5);
    byId("itemCount").textContent = habits.length + "개";
    const rows = habits.map((item) => {
      const row = el("div", "habit-row"),
        copy = el("button", "habit-copy");
      copy.append(
        el("strong", "", item.data.title),
        el(
          "small",
          "",
          "연속 " +
            model.streak(item.data, today) +
            "회 · " +
            item.data.days.map((n) => weekdays[n]).join(", "),
        ),
      );
      copy.setAttribute("aria-label", item.data.title + " 수정");
      copy.onclick = () => openItem("habit", item);
      const week = el("div", "habit-week");
      for (const date of dates) {
        const day = el("div", "habit-day");
        day.append(el("span", "", weekdays[model.dayOfWeek(date)]));
        const done = item.data.checks.includes(date),
          button = el(
            "button",
            "habit-check" + (done ? " done" : ""),
            done ? "✓" : date.slice(8),
          );
        button.disabled = !model.scheduled(item.data, date);
        button.setAttribute("aria-pressed", String(done));
        button.setAttribute(
          "aria-label",
          item.data.title + " " + date + (done ? " 완료 취소" : " 완료"),
        );
        button.onclick = () => checkHabit(item, date);
        if (date === today) button.setAttribute("aria-current", "date");
        day.append(button);
        week.append(day);
      }
      row.append(copy, week);
      resolveButton(item, row);
      return row;
    });
    byId("habitList").replaceChildren(...rows);
    if (!habits.length)
      empty(
        byId("habitList"),
        "반복하고 싶은 일을 정해보세요.",
        "습관 추가",
        () => openItem("habit"),
      );
  }
  function render() {
    if (auth.user?.id !== uid) return;
    if (page === "workspace") renderWorkspace();
    else if (page === "goals") renderGoals();
    else renderHabits();
    status();
  }
  function openItem(kind, item) {
    editing = { kind, item };
    byId("itemForm").reset();
    byId("itemFormMessage").textContent = "";
    byId("itemDialogTitle").textContent =
      (kind === "goal" ? "목표" : "습관") + (item ? " 수정" : " 추가");
    byId("itemTitle").value = item?.data.title || "";
    byId("deleteItem").hidden = !item;
    byId("goalFields").hidden = kind !== "goal";
    byId("habitFields").hidden = kind !== "habit";
    byId("goalTarget").value = item?.data.target || "";
    byId("goalProgress").value = item?.data.progress || 0;
    byId("goalProgress").disabled = kind !== "goal";
    const days = byId("habitDays");
    days.replaceChildren();
    for (let n = 0; n < 7; n++) {
      const label = el("label", "", weekdays[n]),
        input = el("input");
      input.type = "checkbox";
      input.value = n;
      input.checked = !item || item.data.days?.includes(n);
      label.append(input);
      days.append(label);
    }
    byId("itemDialog").showModal();
    byId("itemTitle").focus();
  }
  byId("itemForm").onsubmit = (event) => {
    event.preventDefault();
    try {
      const title = byId("itemTitle").value.trim();
      if (!title) throw new Error("이름을 입력해 주세요.");
      const data =
        editing.kind === "goal"
          ? {
              ...editing.item?.data,
              title,
              target: byId("goalTarget").value,
              progress: Number(byId("goalProgress").value),
            }
          : {
              ...editing.item?.data,
              title,
              days: [
                ...byId("habitDays").querySelectorAll("input:checked"),
              ].map((input) => Number(input.value)),
              created: editing.item?.data.created || HaedoData.localDate(),
              checks: editing.item?.data.checks || [],
            };
      if (editing.kind === "habit" && !data.days.length)
        throw new Error("반복 요일을 하나 이상 선택해 주세요.");
      store.change(editing.item?.id, editing.kind, data);
      byId("itemDialog").close();
      toast("기기에 저장했습니다.");
    } catch (e) {
      byId("itemFormMessage").textContent = e.message;
    }
  };
  byId("deleteItem").onclick = () => {
    if (
      !editing.item ||
      !confirm(
        "이 항목을 삭제할까요? 먼저 전체 백업으로 사본을 보관할 수 있습니다.",
      )
    )
      return;
    try {
      store.remove(editing.item.id);
      byId("itemDialog").close();
      toast("삭제했습니다.");
    } catch (e) {
      byId("itemFormMessage").textContent = e.message;
    }
  };
  byId("addItem")?.addEventListener("click", () =>
    openItem(page === "goals" ? "goal" : "habit"),
  );
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((node) =>
          node.setAttribute("aria-pressed", String(node === button)),
        );
      renderGoals();
    };
  });
  byId("conflictBackup").onclick = () => {
    download(store.backup(), "haedo-backup");
    byId("useRemote").disabled = byId("useLocal").disabled = false;
  };
  for (const [id, choice] of [
    ["useRemote", "remote"],
    ["useLocal", "local"],
  ])
    byId(id).onclick = async () => {
      byId(id).disabled = true;
      try {
        await store.resolve(conflictId, choice);
        byId("conflictDialog").close();
        toast("선택한 사본을 사용합니다.");
      } catch (e) {
        byId("conflictMessage").textContent = e.message;
        byId(id).disabled = false;
      }
    };
  function showTimelineManagement() {
    globalThis.HaedoNavigation?.activate("manage");
    document.querySelector(".haedo-page-head h1").textContent = "연표·목표·습관 관리";
    document.title = "연표·목표·습관 관리 · 해도";
    const back = document.querySelector(".haedo-back-link");
    back.href = "index.html?section=manage";
    back.querySelector("span:last-child").textContent = "관리";
    const backups = byId("timelineBackups");
    backups.open = true;
    document.querySelector(".space-documents").before(backups);
  }
  function openNewTimeline() {
    byId("timelineForm").reset();
    byId("timelineName").value = "내 연표";
    byId("timelineFormMessage").textContent = "";
    byId("timelineDialog").showModal();
    byId("timelineName").focus();
  }
  if (page === "workspace") {
    if (new URLSearchParams(location.search).get("section") === "manage") {
      showTimelineManagement();
    }
    byId("newTimeline").onclick = openNewTimeline;
    byId("timelineForm").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const birth = byId("timelineBirth").value;
        if (!HaedoData.validDate(birth))
          throw new Error("기준 날짜를 입력해 주세요.");
        const docs = model.importDocs(
          localStorage,
          uid,
          model.emptyDocument(
            byId("timelineName").value.trim() || "내 연표",
            birth,
          ),
        );
        byId("timelineDialog").close();
        location.href = "timeline.html?doc=" + encodeURIComponent(docs[0].id);
      } catch (e) {
        byId("timelineFormMessage").textContent = e.message;
      }
    };
    byId("backupAll").onclick = () => {
      try {
        download(store.backup(), "haedo-backup");
      } catch (_) {
        toast("백업을 만들지 못했습니다. 기기의 원본은 보존했습니다.");
      }
    };
    try {
      legacy = model.legacyBackup(localStorage);
      byId("openLegacy").hidden = !legacy.docs.length && !legacy.raw.length;
    } catch (_) {
      syncWarning = "기존 연표를 읽지 못했습니다. 기기의 원본은 보존했습니다.";
    }
    byId("openLegacy").onclick = () => {
      legacy = model.legacyBackup(localStorage);
      legacySaved = false;
      byId("legacyOwnership").checked = false;
      byId("legacyImport").disabled = true;
      byId("legacySummary").textContent =
        "기기에 남아 있는 연표 " + legacy.docs.length + "개를 찾았습니다.";
      byId("legacyMessage").textContent = "";
      byId("importDialog").showModal();
    };
    byId("legacyBackup").onclick = () => {
      download(legacy, "haedo-original");
      legacySaved = true;
      byId("legacyImport").disabled =
        !byId("legacyOwnership").checked || !legacy.docs.length;
    };
    byId("legacyOwnership").onchange = () => {
      byId("legacyImport").disabled =
        !legacySaved || !byId("legacyOwnership").checked || !legacy.docs.length;
    };
    byId("legacyImport").onclick = async () => {
      if (!legacySaved || !byId("legacyOwnership").checked) return;
      byId("legacyImport").disabled = true;
      try {
        const sources = new Set(
          model.registry(localStorage, uid).docs.map((doc) => doc.legacySource),
        );
        const pending = {
          ...legacy,
          docs: legacy.docs.filter((doc) => !sources.has(doc.id)),
        };
        if (!pending.docs.length) {
          byId("legacyMessage").textContent =
            "이 계정에 이미 사본을 연결했습니다.";
          return;
        }
        const docs = model.importDocs(
          localStorage,
          uid,
          pending,
          undefined,
          true,
        );
        render();
        await store.uploadDocuments(docs.map((doc) => doc.id));
        byId("importDialog").close();
        toast("기존 연표 사본을 계정에 연결했습니다.");
      } catch (e) {
        byId("legacyMessage").textContent =
          "기기 사본을 보존했습니다. " + e.message;
        byId("legacyImport").disabled = false;
      }
    };
    byId("importFile").onclick = () => byId("backupFile").click();
    byId("backupFile").onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      let checkAccount;
      try {
        checkAccount = store.captureAccount();
        if (file.size > 20 * 1024 * 1024)
          throw new Error("20MB 이하의 백업 파일을 선택해 주세요.");
        const backup = JSON.parse(await file.text());
        checkAccount();
        model.assertBackupFormat(backup);
        if (
          backup.items &&
          (!Array.isArray(backup.items) ||
            backup.items.some((item) => !model.validItem(item)))
        )
          throw new Error("목표·습관 백업 형식을 읽을 수 없습니다.");
        const documents =
          HaedoData.isDocument(backup) || backup.docs?.length
            ? model.importDocs(localStorage, uid, backup)
            : [];
        if (!documents.length && !backup.items?.length)
          throw new Error("기록이 들어 있는 JSON 백업을 선택해 주세요.");
        for (const item of backup.items || [])
          store.change(null, item.kind, structuredClone(item.data));
        render();
        toast("기기에 새 사본을 가져왔습니다.");
        if (documents.length)
          await store.uploadDocuments(documents.map((doc) => doc.id));
      } catch (e) {
        toast(
          "기존 기록은 보존했습니다. " +
            (e instanceof SyntaxError
              ? "JSON 파일을 읽을 수 없습니다."
              : e.message),
        );
      }
      event.target.value = "";
    };
  }
  async function sync() {
    if (syncing || auth.user?.id !== uid) return;
    syncing = true;
    byId("syncRetry").disabled = true;
    try {
      await Promise.all([store.pull(), store.syncDocuments()]);
      await store.uploadDocuments(
        model
          .registry(localStorage, uid)
          .docs.filter((doc) => doc.updated !== doc.syncedAt)
          .map((doc) => doc.id),
      );
      await store.flush();
      syncWarning = "";
      syncChecked = true;
    } catch (e) {
      syncWarning =
        e.message || "연결하지 못했습니다. 기기 사본은 보존했습니다.";
    } finally {
      syncing = false;
      if (auth.user?.id === uid) {
        byId("syncRetry").disabled = false;
        render();
      }
    }
  }
  byId("syncRetry").onclick = sync;
  document.addEventListener("haedo:store", render);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && auth.user?.id === uid) sync();
  });
  addEventListener("online", () => {
    if (auth.user?.id === uid) sync();
  });
  render();
  await sync();
})();
