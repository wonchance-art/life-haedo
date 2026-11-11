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
  const icon = (name) => HaedoLife.Icons.create(name);
  const link = (text, href, className = "") => {
    const node = el("a", className, text);
    node.href = href;
    return node;
  };
  function iconControl(control, label, glyph) {
    control.classList.add("haedo-icon-button");
    control.setAttribute("aria-label", label);
    control.append(icon(glyph));
    const tip = el("span", "haedo-tooltip", label);
    tip.setAttribute("aria-hidden", "true");
    control.append(tip);
    const reset = () => { delete control.dataset.tooltipDismissed; };
    control.addEventListener("blur", reset);
    control.addEventListener("pointerleave", reset);
    return control;
  }
  let toastTimer,
    uid,
    editing,
    filter = "active",
    legacy,
    legacySaved = false,
    legacyAccountCheck,
    legacyLinking = false,
    syncWarning = "",
    conflictId,
    syncing = false,
    syncOffline = false,
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
      "개인 공간을 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기의 기록은 보존돼 있습니다.";
    byId("accessRetry").hidden = false;
    // 다시 확인: the next opening's account check waits the longest (a slow connection, platform-auth.js).
    byId("accessRetry").onclick = () => { auth.expectSlow?.(); location.reload(); };
    // The page opens again by itself when the connection or the page comes back (2026-11-11 m2). Nothing
    // has been entered on this screen yet. Each try follows one event; there is no timer here.
    const again = () => { if (!document.hidden && navigator.onLine !== false) location.reload(); };
    addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    addEventListener("pageshow", (event) => { if (event.persisted) again(); });
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
  // Two-step save state (2026-11-02 owner decision; 일정 통합 정리 S9). Items and timelines are
  // stored on this device first (synchronously), so the line only says whether the account has them:
  // 저장됨 · 계정에 올림 / 계정에 올리기 대기 / 계정에 올리지 못함 · [다시 시도]. The conflict and
  // recovery-copy sentences stay as they were, after the state. 'unknown' says nothing: before the
  // first account check (or offline with nothing to send) 저장됨 · 계정에 올림 is not yet known.
  const STATE_TEXT = { ok: "저장됨 · 계정에 올림", pending: "계정에 올리기 대기", error: "계정에 올리지 못함 ·", unknown: "" };
  function saveState() {
    const states = store.items.map((item) => item.state);
    const docs = model.registry(localStorage, uid).docs;
    const unsent = states.includes("sync") || states.includes("err") || docs.some((d) => !d.syncedAt || d.updated !== d.syncedAt);
    // Offline is not a failure: what is unsent waits (the online event sends it), and with nothing to
    // send there is nothing to say. A failed upload or pass while online is.
    const offline = navigator.onLine === false;
    if (states.includes("conflict") || (states.includes("err") && !offline)) return "error";
    if (syncWarning && !(syncOffline && offline)) return "error";
    if (unsent) return "pending";
    return syncChecked ? "ok" : "unknown";
  }
  function status() {
    const state = saveState();
    const conflict = store.items.some((item) => item.state === "conflict");
    const message = byId("syncMessage");
    const line = message.closest(".p-status-line");
    let stateText = message.querySelector("[data-status-state]"),
      retry = byId("syncRetry"),
      detail = message.querySelector("[data-status-detail]");
    if (!stateText || !retry || !detail) {
      stateText = el("span");
      stateText.dataset.statusState = "";
      retry = el("button", "p-text-link p-status-retry", "다시 시도");
      retry.type = "button";
      retry.id = "syncRetry";
      retry.onclick = sync;
      detail = el("span", "p-status-detail");
      detail.dataset.statusDetail = "";
      message.replaceChildren(stateText, " ", retry, detail);
    }
    if (stateText.textContent !== STATE_TEXT[state]) stateText.textContent = STATE_TEXT[state];
    // A retry that succeeded hides its button: keep keyboard focus on the screen, not the page.
    const retryFocused = document.activeElement === retry;
    retry.hidden = state !== "error";
    if (retryFocused && retry.hidden) {
      const title = document.querySelector(".haedo-page-heading h1");
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
    }
    // Not `disabled`: a focused button that becomes disabled drops keyboard focus. sync() ignores
    // presses while a pass runs; the line's data-sync says busy/idle.
    retry.setAttribute("aria-disabled", String(syncing));
    const notes = [];
    if (state === "error" && conflict) notes.push("서버와 다른 변경 사항이 있습니다. 기기 사본을 보존했습니다.");
    else if (state === "error" && syncWarning) notes.push(syncWarning);
    // Conflict losers are kept, not shown as items (newest edit wins, 2026-11-01). The sentence
    // shows until the owner acknowledges it; the copies themselves are never removed.
    const unseen = store.recoveryUnseen;
    if (unseen) notes.push("다른 기기와 겹친 변경 " + unseen + "개를 복구 사본으로 남겼습니다.");
    const detailText = notes.length ? " " + notes.join(" ") : "";
    if (detail.textContent !== detailText) detail.textContent = detailText;
    let actions = byId("recoveryActions");
    if (!actions) {
      actions = el("span", "p-status-actions");
      actions.id = "recoveryActions";
      const view = el("button", "p-text-link", "보기"), seen = el("button", "p-text-link", "확인");
      view.type = seen.type = "button";
      view.setAttribute("aria-label", "복구 사본 보기");
      seen.setAttribute("aria-label", "복구 사본 알림 확인");
      view.onclick = openRecovery;
      seen.onclick = () => { store.acknowledgeRecovery(); render(); };
      actions.append(view, seen);
      line.append(actions);
    }
    actions.hidden = !unseen;
    line.dataset.state = state;
    line.dataset.sync = syncing || !syncChecked && !syncWarning ? "busy" : "idle";
    line.dataset.idle = String((state === "ok" || state === "unknown") && !notes.length);
  }
  // The kept copies, newest first. Reviving adds a new item; the kept copy stays (and in backups).
  function openRecovery() {
    let dialog = byId("recoveryDialog");
    if (!dialog) {
      dialog = el("dialog", "p-dialog");
      dialog.id = "recoveryDialog";
      dialog.setAttribute("aria-labelledby", "recoveryDialogTitle");
      const head = el("div", "p-dialog-head"), title = el("h2", "", "복구 사본"),
        close = el("button", "p-icon-button");
      title.id = "recoveryDialogTitle";
      close.type = "button";
      iconControl(close, "닫기", "close");
      close.onclick = () => dialog.close();
      head.append(title, close);
      dialog.append(head, el("p", "", "다른 기기와 겹쳐 남긴 변경입니다. 지우지 않고 백업에도 포함됩니다."), el("ul", "p-recovery-list"));
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
      });
      document.body.append(dialog);
    }
    const list = dialog.querySelector("ul");
    list.replaceChildren();
    for (const row of store.recovery) {
      const item = el("li", "p-recovery-row"), when = new Date(row.keptAt || "");
      item.append(
        el("strong", "", row.data?.title || "제목 없음"),
        el("span", "p-recovery-meta", (row.kind === "goal" ? "목표" : "습관") +
          (Number.isNaN(when.getTime()) ? "" : " · " + when.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }))),
      );
      const revive = el("button", "p-text-link", "새 항목으로 되살리기");
      revive.type = "button";
      revive.onclick = () => {
        try {
          store.reviveRecovery(row.rid);
          toast("새 항목으로 되살렸습니다. 복구 사본은 그대로 남습니다.");
          render();
        } catch (e) { toast(e.message); }
      };
      item.append(revive);
      list.append(item);
    }
    if (!store.recovery.length) list.append(el("li", "p-recovery-row", "남긴 복구 사본이 없습니다."));
    if (!dialog.open) {
      dialog.showModal();
      // Start on the title, not the close button, whose label would cover the text.
      const title = byId("recoveryDialogTitle");
      title.tabIndex = -1; title.focus();
    }
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
      complete.setAttribute("aria-pressed", String(done));
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
  // Toggled from the stored copy: a click on a cell that no longer shows the stored state does nothing.
  // A habit no longer in the list (removed here or on the server) is never saved from the old card.
  function checkHabit(item, date, wasDone) {
    try {
      const latest = store.items.find((row) => row.id === item.id);
      if (!latest) {
        toast("습관을 찾지 못했습니다. 화면을 다시 열어 주세요.");
        render();
        return;
      }
      if (wasDone !== undefined && latest.data.checks.includes(date) !== wasDone) return;
      store.change(
        latest.id,
        "habit",
        model.toggleHabit(latest.data, date, HaedoData.localDate()),
      );
    } catch (e) {
      toast(e.message);
    }
  }
  function renderWorkspace() {
    const list = byId("documentList"),
      k = model.keys(uid),
      docs = model.registry(localStorage, uid).docs;
    let previous;
    try { previous = model.legacyBackup(localStorage); } catch (_) { /* Keep recovery reachable without claiming absence. */ }
    const sourceIds = new Set(docs.map(doc => doc.legacySource));
    const available = previous?.docs.filter(doc => !sourceIds.has(doc.id)).length || 0;
    const waiting = previous?.docs.some(source => docs.some(doc => doc.legacySource === source.id && doc.updated !== doc.syncedAt));
    byId("timelineRecovery").hidden = !!docs.length && !available && !waiting && !previous?.raw.length && !!previous;
    byId("recoverLegacy").hidden = !previous?.docs.length && !previous?.raw.length;
    byId("openLegacy").hidden = byId("recoverLegacy").hidden;
    byId("recoverySummary").textContent = available
      ? "이 브라우저에 아직 계정에 연결하지 않은 연표 " + available + "개가 있습니다. 원본을 보관한 뒤 사본으로 연결할 수 있습니다."
      : waiting ? "기존 연표의 기기 사본이 있습니다. 연결 화면에서 서버 저장을 다시 시도할 수 있습니다."
      : previous?.raw.length ? "그대로 읽지 못한 기존 자료가 있습니다. 연결 화면에서 원본을 백업해 주세요."
      : "현재 계정의 목록과 예전 기기·서버의 연표는 별도로 확인합니다. 기존 백업이 있으면 새 사본으로 가져오세요.";
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
        iconControl(link("", "timeline.html?doc=" + encodeURIComponent(doc.id)), "연표로 보기", "timeline"),
        iconControl(link("", "timeline.html?view=records&doc=" + encodeURIComponent(doc.id)), "목록으로 보기", "book"),
        iconControl(link("", "timeline.html?view=map&doc=" + encodeURIComponent(doc.id)), "지도로 보기", "map"),
      );
      row.append(copy, links);
      list.append(row);
    }
    if (!docs.length)
      empty(
        list,
        "현재 계정에 표시할 연표가 없습니다.",
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
  // 습관 트래커(2026-11-07): one month per habit (HaedoHabitTracker). Not past the current month.
  // `habits.html?month=YYYY-MM` opens that month (일정 M's tracker rows link here); an invalid
  // value is ignored and a future month is shown as the current month.
  function requestedMonth() {
    const value = new URLSearchParams(location.search).get("month");
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value || "");
    return match && Number(match[1]) >= 1900 && Number(match[1]) <= 2199 ? value : null;
  }
  let habitMonth = page === "habits" ? requestedMonth() : null;
  // The day this page was last drawn with (2026-11-11 M1). When the page stays open over midnight a
  // screen that showed this month follows the new month; a chosen earlier month stays, and 오늘 marks,
  // "이번 달" and the cells that can be checked are drawn again for the new day (dayCheck below).
  let shownDay = HaedoData.localDate();
  function renderHabits() {
    const today = HaedoData.localDate(),
      tracker = HaedoHabitTracker,
      current = tracker.monthOf(today);
    if (shownDay !== today && habitMonth === tracker.monthOf(shownDay) && habitMonth !== current) { habitMonth = current; habitAddress(); }
    if (!habitMonth || habitMonth > current) habitMonth = current;
    const habits = store.items.filter((item) => item.kind === "habit");
    // Announced (aria-live) when the month changes; an unchanged label is not rewritten on repaints.
    const monthName = tracker.monthLabel(habitMonth);
    if (byId("habitMonthLabel").textContent !== monthName) byId("habitMonthLabel").textContent = monthName;
    byId("habitNextMonth").disabled = habitMonth >= current;
    byId("habitThisMonth").hidden = habitMonth === current;
    byId("itemCount").textContent = habits.length + "개";
    const list = byId("habitList"),
      active = document.activeElement,
      focusKey = list.contains(active) ? active?.dataset?.focusKey : null;
    tracker.render(list, {
      habits,
      month: habitMonth,
      today,
      model,
      focusScope: "habits",
      onOpen: (item) => openItem("habit", item),
      onToggle: checkHabit,
    });
    for (const item of habits) {
      const card = [...list.children].find((node) => node.dataset.habit === item.id);
      if (card) resolveButton(item, card);
    }
    if (!habits.length) {
      list.classList.remove("habit-tracker");
      empty(list, "반복하고 싶은 일을 정해보세요.", "습관 추가", () => openItem("habit"));
    }
    tracker.restoreFocus(list, focusKey);
  }
  // The same screen in another month: replace the address, so a reload keeps the month shown.
  function habitAddress() {
    try {
      const url = new URL(location.href);
      if (habitMonth === HaedoHabitTracker.monthOf(HaedoData.localDate())) url.searchParams.delete("month");
      else url.searchParams.set("month", habitMonth);
      if (url.href !== location.href) history.replaceState(history.state, "", url);
    } catch (_) { /* The month on screen stays; only the address is not updated. */ }
  }
  function showHabitMonth(month) {
    habitMonth = month;
    render();
    habitAddress();
    // A month button that is now disabled or hidden would drop focus to the page: keep it on the label.
    const active = document.activeElement;
    if (!active || active === document.body || active.disabled || active.hidden) byId("habitMonthLabel").focus();
  }
  if (page === "habits") {
    byId("habitPrevMonth").onclick = () => showHabitMonth(HaedoHabitTracker.shiftMonth(habitMonth, -1));
    byId("habitNextMonth").onclick = () => showHabitMonth(HaedoHabitTracker.shiftMonth(habitMonth, 1));
    byId("habitThisMonth").onclick = () => showHabitMonth(HaedoHabitTracker.monthOf(HaedoData.localDate()));
  }
  function render() {
    if (auth.user?.id !== uid) return;
    if (page === "workspace") renderWorkspace();
    else if (page === "goals") renderGoals();
    else renderHabits();
    shownDay = HaedoData.localDate();
    status();
  }
  // Drawn again when the day changed while the page was open: on return, on focus and right after midnight.
  let dayTimer;
  function dayCheck() {
    if (document.hidden || auth.user?.id !== uid || shownDay === HaedoData.localDate()) return;
    render();
  }
  function armDayTimer() {
    clearTimeout(dayTimer);
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dayTimer = setTimeout(() => { dayCheck(); armDayTimer(); }, Math.max(1000, next - now + 250));
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
      // The status line says where it is (계정에 올리기 대기 → 저장됨 · 계정에 올림); no third phrase.
      byId("itemDialog").close();
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
    // Opened from 설정 > 백업·복원: the 계획 tabs belong to 일정, not to this backup screen.
    const planning = document.querySelector("[data-haedo-planning-navigation]");
    if (planning) planning.hidden = true;
    document.querySelector(".haedo-page-heading h1").textContent = "백업·복원";
    document.title = "연표·목표·습관 관리 · 해도";
    const back = document.querySelector("[data-section-back]");
    back.href = "index.html?section=manage&view=backup";
    back.setAttribute("aria-label", "백업·복원으로 돌아가기");
    const tip = back.querySelector(".haedo-tooltip");
    if (tip) tip.textContent = "백업·복원으로 돌아가기";
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
    byId("openLegacy").onclick = () => {
      if (legacyLinking) return;
      try {
        legacyAccountCheck = store.captureAccount();
        if (auth.user?.id !== uid) throw new Error("계정이 변경됐습니다. 새로고침 후 다시 열어 주세요.");
        legacy = model.legacyBackup(localStorage);
      } catch (error) {
        toast("기존 연표를 읽지 못했습니다. 원본은 보존했습니다. " + error.message);
        return;
      }
      legacySaved = false;
      byId("legacyOwnership").checked = false;
      byId("legacyImport").disabled = true;
      byId("legacyImport").textContent = "내 계정에 사본 만들기";
      byId("legacySummary").textContent =
        "기기에 남아 있는 연표 " + legacy.docs.length + "개를 찾았습니다.";
      byId("legacyMessage").textContent = "";
      byId("importDialog").showModal();
    };
    byId("recoverLegacy").onclick = () => byId("openLegacy").click();
    byId("recoverBackup").onclick = () => byId("backupFile").click();
    byId("legacyBackup").onclick = () => {
      download(legacy, "haedo-original");
      legacySaved = true;
      byId("legacyImport").disabled =
        legacyLinking || !byId("legacyOwnership").checked || !legacy.docs.length;
    };
    byId("legacyOwnership").onchange = () => {
      byId("legacyImport").disabled =
        legacyLinking || !legacySaved || !byId("legacyOwnership").checked || !legacy.docs.length;
    };
    byId("legacyImport").onclick = async () => {
      if (legacyLinking || !legacySaved || !byId("legacyOwnership").checked) return;
      legacyLinking = true;
      byId("legacyImport").disabled = true;
      byId("legacyImport").textContent = "사본 연결 중…";
      try {
        legacyAccountCheck();
        const sources = new Set(
          model.registry(localStorage, uid).docs.map((doc) => doc.legacySource),
        );
        const pending = {
          ...legacy,
          docs: legacy.docs.filter((doc) => !sources.has(doc.id)),
        };
        if (pending.docs.length) model.importDocs(
          localStorage,
          uid,
          pending,
          undefined,
          true,
        );
        // A failed upload already has account copies: retry their IDs, not the source import.
        const sourceIds = new Set(legacy.docs.map(doc => doc.id));
        const uploadIds = model.registry(localStorage, uid).docs
          .filter(doc => sourceIds.has(doc.legacySource) && doc.updated !== doc.syncedAt)
          .map(doc => doc.id);
        render();
        await store.uploadDocuments(uploadIds);
        legacyAccountCheck();
        byId("importDialog").close();
        toast("기존 연표 사본을 계정에 연결했습니다.");
      } catch (e) {
        if (e.code === "account_changed" || auth.user?.id !== uid) return;
        const message = /^HTTP \d+$/.test(e.message)
          ? "서버에 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."
          : e.message;
        byId("legacyMessage").textContent =
          "기기 사본을 보존했습니다. " + message;
        byId("legacyImport").textContent = "사본 연결 다시 시도";
        byId("legacyImport").disabled = false;
      } finally {
        legacyLinking = false;
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
        if (backup.recovery !== undefined && (!Array.isArray(backup.recovery) || backup.recovery.some((item) => !model.validItem(item))))
          throw new Error("복구 사본 형식을 읽을 수 없습니다.");
        // 행복도(happinessDays) in a timeline backup goes into the restored copies (restoreBackupDays).
        const restored = model.restoreBackupDays ? model.restoreBackupDays(backup) : { backup, happinessOnly: false, days: 0 };
        const documents =
          HaedoData.isDocument(restored.backup) || restored.backup.docs?.length
            ? model.importDocs(localStorage, uid, restored.backup, undefined, false, { keepCurrent: restored.happinessOnly })
            : [];
        if (!documents.length && !backup.items?.length && !backup.recovery?.length)
          throw new Error("기록이 들어 있는 JSON 백업을 선택해 주세요.");
        for (const item of backup.items || [])
          store.change(null, item.kind, structuredClone(item.data));
        if (backup.recovery?.length) store.restoreRecovery(backup.recovery);
        if (Array.isArray(backup.recoveryDamaged)) store.restoreDamaged(backup.recoveryDamaged);
        render();
        toast(
          "기기에 새 사본을 가져왔습니다." +
            (restored.happinessOnly
              ? " 행복도 복원 연표를 새로 만들었습니다."
              : restored.days
                ? " 하루 행복도는 백업 당시 보이던 값으로 사본에 넣었습니다."
                : ""),
        );
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
    status();
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
      syncOffline = false;
      syncChecked = true;
    } catch (e) {
      syncOffline = navigator.onLine === false;
      syncWarning =
        e.message || "연결하지 못했습니다. 기기 사본은 보존했습니다.";
    } finally {
      syncing = false;
      if (auth.user?.id === uid) render();
    }
  }
  document.addEventListener("haedo:store", render);
  document.addEventListener("visibilitychange", () => {
    dayCheck();
    if (!document.hidden && auth.user?.id === uid) sync();
  });
  addEventListener("pageshow", dayCheck);
  addEventListener("focus", dayCheck);
  armDayTimer();
  addEventListener("online", () => {
    if (auth.user?.id === uid) sync();
  });
  // Going offline turns a failed upload into one that waits for the connection.
  addEventListener("offline", () => {
    if (auth.user?.id === uid) status();
  });
  render();
  // The 일정 screen's "보기" opens this list here (habits.html#recovery).
  if (location.hash === "#recovery") openRecovery();
  await sync();
})();
