(async function () {
  const auth = HaedoAuth,
    message = document.getElementById("timelineAccessMessage");
  try {
    const user = await auth.requireUser();
    if (!user) return;
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
    message.textContent =
      error.message ||
      "연표를 열지 못했습니다. 인터넷 연결을 확인해 주세요. 기기 사본은 보존했습니다.";
    document.getElementById("timelineRetry").hidden = false;
    document.getElementById("timelineRetry").onclick = () => location.reload();
  }
})();
