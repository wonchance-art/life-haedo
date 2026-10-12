/* Source-derived presentation only. No media preferences/data enter saved posts. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.HaedoLife ||= {}).PageMedia = api;
})(globalThis, function (root) {
  "use strict";
  const media = () =>
    root.HaedoLife?.CollectionMedia ||
    (typeof require === "function" && require("./collection-media.js"));
  function describe(item) {
    if (!item || !["book", "video", "music", "film"].includes(item.type))
      return null;
    const value = media().describe(
      item.type === "music" || item.type === "film"
        ? { ...item, type: "video" }
        : item,
    );
    if (!value) return null;
    return Object.freeze({
      ...value,
      label: value.videoId ? "연결한 영상 썸네일" : value.label,
      embed: value.videoId
        ? "https://www.youtube-nocookie.com/embed/" +
          value.videoId +
          "?autoplay=0&playsinline=1&rel=0"
        : null,
    });
  }
  function create({ timeout = 18000 } = {}) {
    const life = root.HaedoLife,
      records = new Set(),
      controls = new Set();
    let enabled = false,
      disposed = false,
      closePlayer = null;
    const node = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    function paintControl() {
      for (const el of controls) {
        el.setAttribute("aria-pressed", String(enabled));
        el.textContent = enabled ? "외부 이미지 끄기" : "외부 이미지 보기";
      }
    }
    function start(record) {
      if (disposed || record.stop) return;
      record.stop = media().mount({
        host: record.host,
        descriptor: record.descriptor,
        lookup: life.CollectionMetadata.lookup,
        timeout,
        onState: (state) => {
          record.host.dataset.mediaState = state;
          record.onState(state);
        },
      });
    }
    function setEnabled(value) {
      enabled = value;
      for (const r of records) {
        r.stop?.();
        r.stop = null;
        r.host.dataset.mediaState = "off";
        r.onState("off");
        if (enabled) start(r);
      }
      paintControl();
    }
    function control() {
      const wrapper = node("details", null, "pp-media-options");
      wrapper.append(node("summary", "표지·영상"));
      const info = node(
        "p",
        "이미지를 켜면 Open Library·YouTube에 연결합니다. 영상은 별도로 눌러 열 수 있습니다.",
        "life-help",
      );
      const b = node("button", "", "life-button");
      b.type = "button";
      b.addEventListener("click", () => setEnabled(!enabled));
      controls.add(b);
      paintControl();
      wrapper.append(info, b);
      return wrapper;
    }
    function cover(host, descriptor, onState = () => {}) {
      const record = { host, descriptor, onState, stop: null };
      records.add(record);
      host.dataset.mediaState = "off";
      if (enabled) start(record);
      return () => {
        record.stop?.();
        records.delete(record);
      };
    }
    function retry(host) {
      const r = [...records].find((r) => r.host === host);
      if (!r || !enabled) return;
      r.stop?.();
      r.stop = null;
      start(r);
    }
    function video(item, descriptor, origin) {
      if (disposed || !descriptor?.embed) return;
      closePlayer?.();
      const dialog = node("dialog", null, "pp-video-dialog"),
        head = node("header", null, "pp-video-head"),
        title = node("h2", item.title);
      title.id = "ppVideoTitle";
      dialog.setAttribute("aria-labelledby", title.id);
      const exit = node("button", "", "life-icon-button");
      exit.type = "button";
      exit.setAttribute("aria-label", "영상 닫기");
      exit.append(life.Icons.create("close"));
      head.append(title, exit);
      const frameHost = node("div", null, "pp-player"),
        status = node("p", "YouTube 플레이어를 불러오는 중…", "life-help");
      status.setAttribute("role", "status");
      const link = node("a", "YouTube에서 열기", "life-button");
      link.href = descriptor.source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      const note = node(
        "p",
        "YouTube에 연결합니다. 재생은 플레이어에서 직접 시작하세요. 영상이 제한되면 원래 출처에서 확인할 수 있습니다.",
        "life-help",
      );
      const frame = document.createElement("iframe");
      frame.title = item.title + " · YouTube 플레이어";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allow = "encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
      frame.src = descriptor.embed;
      let alive = true,
        settled = false;
      const timer = setTimeout(() => {
        if (!alive || settled) return;
        settled = true;
        frame.remove();
        status.textContent =
          "플레이어 연결을 확인하지 못했습니다. YouTube에서 열어 주세요.";
      }, timeout);
      frame.addEventListener("load", () => {
        if (!alive || settled) return;
        settled = true;
        clearTimeout(timer);
        status.textContent = "재생이 제한되면 YouTube에서 열어 주세요.";
      });
      frame.addEventListener("error", () => {
        if (!alive || settled) return;
        settled = true;
        clearTimeout(timer);
        frame.remove();
        status.textContent =
          "플레이어를 불러오지 못했습니다. YouTube에서 열어 주세요.";
      });
      const scrollStyle = document.body.style.overflow;
      function close() {
        if (!alive) return;
        alive = false;
        clearTimeout(timer);
        frame.remove();
        dialog.close();
        dialog.remove();
        document.body.style.overflow = scrollStyle;
        closePlayer = null;
        if (origin?.isConnected) origin.focus({ preventScroll: true });
      }
      closePlayer = close;
      exit.addEventListener("click", close);
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        close();
      });
      // Explicit boundary controls keep a keyboard exit available around the cross-origin frame.
      const end = node("button", "영상 닫기", "life-button");
      end.type = "button";
      end.addEventListener("click", close);
      dialog.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        if (e.shiftKey && document.activeElement === exit) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          exit.focus();
        }
      });
      frameHost.append(frame);
      dialog.append(head, frameHost, status, note, link, end);
      document.body.append(dialog);
      document.body.style.overflow = "hidden";
      dialog.showModal();
      exit.focus();
    }
    function clear() {
      closePlayer?.();
      for (const r of records) r.stop?.();
      records.clear();
      controls.clear();
    }
    function suspend() {
      if (document.hidden || disposed) {
        closePlayer?.();
        setEnabled(false);
      }
    }
    const pagehide = () => {
      closePlayer?.();
      setEnabled(false);
    };
    document.addEventListener("visibilitychange", suspend);
    root.addEventListener("pagehide", pagehide);
    return {
      control,
      cover,
      retry,
      video,
      clear,
      reset() {
        setEnabled(false);
        clear();
      },
      dispose() {
        disposed = true;
        setEnabled(false);
        clear();
        document.removeEventListener("visibilitychange", suspend);
        root.removeEventListener("pagehide", pagehide);
      },
    };
  }
  return Object.freeze({ describe, create });
});
