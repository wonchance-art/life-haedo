(async function () {
  const auth = HaedoAuth,
    message = document.getElementById("timelineAccessMessage");
  // The notice, 다시 확인, and opening again by itself when the connection or the page comes back
  // (2026-11-11 m2, as platform-ui.js).
  let retryOffered = false, accountChecked = false;
  function offerRetry(text) {
    message.textContent = text;
    if (retryOffered) return;
    retryOffered = true;
    document.getElementById("timelineRetry").hidden = false;
    document.getElementById("timelineRetry").onclick = () => { auth.expectSlow?.(); location.reload(); };
    // (Not while the page is opening after its account was checked after all: only its own failure offers this again.)
    const again = () => { if (!accountChecked && !document.hidden && navigator.onLine !== false) location.reload(); };
    addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    addEventListener("pageshow", (event) => { if (event.persisted) again(); });
  }
  // A check allowed more than 10 s says so; after 10 s the notice is shown while it goes on (as platform-ui.js).
  const checkWait = Number(auth.verifyWait?.()) || 10000;
  if (checkWait > 10000) message.textContent = "로그인을 확인하고 있습니다. 연결이 느려 평소보다 오래 걸릴 수 있습니다.";
  const slowCheck = checkWait > 10000 ? setTimeout(() => offerRetry("연표를 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기 사본은 보존했습니다."), 10000) : null;
  try {
    const user = await auth.requireUser().finally(() => clearTimeout(slowCheck));
    if (!user) return;
    accountChecked = true;
    if (retryOffered) { message.textContent = "연표를 불러오고 있습니다."; document.getElementById("timelineRetry").hidden = true; }
    const model = HaedoPlatformData,
      store = HaedoPlatformStore.init(user.id);
    const checkAccount = store.captureAccount();
    try {
      await store.syncDocuments();
    } catch (_) {
      checkAccount();
      if (!model.registry(localStorage, user.id).docs.length)
        throw new Error(
          "연표를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.",
        );
    }
    checkAccount();
    const keys = model.keys(user.id),
      reg = model.registry(localStorage, user.id);
    if (!reg.docs.length) {
      location.replace("workspace.html");
      return;
    }
    const params = new URLSearchParams(location.search),
      requested = params.get("doc");
    if (requested && reg.docs.some((doc) => doc.id === requested)) {
      reg.current = requested;
      localStorage.setItem(keys.registry, JSON.stringify(reg));
    }
    window.HAEDO_CONTEXT = Object.freeze({ uid: user.id, keys });
    for (const source of ["assets/app.js", "assets/workspace.js"]) {
      checkAccount();
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = source;
        const fail = () => {
          removeEventListener("error", runtimeError);
          reject(
            new Error("연표 파일을 실행하지 못했습니다. 새로고침해 주세요."),
          );
        };
        const runtimeError = (event) => {
          if (event.filename?.endsWith(source)) fail();
        };
        addEventListener("error", runtimeError);
        script.onload = () => {
          removeEventListener("error", runtimeError);
          resolve();
        };
        script.onerror = fail;
        document.body.append(script);
      });
    }
    checkAccount();
    document.documentElement.classList.remove("auth-pending");
    document.getElementById("timelineAccess").hidden = true;
    if (params.get("view") === "records")
      document.getElementById("btnRecords").click();
    else if (params.get("view") === "map")
      document.getElementById("btnMap").click();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (error) {
    accountChecked = false;
    document.getElementById("timelineRetry").hidden = false;
    offerRetry(error.message || "연표를 열지 못했습니다. 인터넷 연결을 확인해 주세요. 기기 사본은 보존했습니다.");
  }
})();
