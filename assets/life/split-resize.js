/* 목록과 읽기 칸 사이 너비 조절 (2026-11-07 소유자 요청: 목록·읽기 칸 너비를 마우스로 직접 조절).
 * 자료(records)와 뉴스(news)의 1101px 이상 2단 배치에서 쓴다. 고른 목록 너비는 창 크기에 따라 달라지는
 * 이 기기의 화면 상태라서 계정에 동기화하지 않고 이 브라우저의 localStorage에만 둔다
 * (caeyeon_life_split_<view>). 저장 실패·잘못된 값은 무시하고 기본 너비를 쓴다.
 *
 * attach(container, options) → dispose()
 *   container  격자 요소. 목록 너비를 options.cssVar(기본 --haedo-split-list)에 px로 쓴다.
 *   before     구분선을 넣을 자리(읽기 칸 요소). 구분선은 그 앞에 들어간다.
 *   key        localStorage 키. min/readerMin/defaultWidth는 px. controls는 목록 요소 id.
 *   keepVisible 너비가 바뀌는 동안 읽던 줄을 같은 높이에 둘 읽기 본문 요소(또는 그것을 돌려주는 함수).
 *   lineKept   읽기 본문이 keepLine으로 읽던 줄을 스스로 잡고 있으면 true를 돌려주는 함수. 그때는 여기서 다시 잡지 않는다.
 * 구분선이 보이지 않는 폭(CSS가 숨김)에서는 아무것도 바꾸지 않는다.
 *
 * keepLine(host, { capture, top }) → { get(), peek(), set(anchor), restore(), pause(), resume(), dispose() }
 *   읽기 본문(host)의 너비가 어떤 이유로든 바뀔 때(창 크기·기기 회전·목록이 옆에 열림·구분선) 읽던 줄을 같은 화면
 *   높이에 둔다. 이런 변화는 배치가 끝난 뒤에야 알 수 있어서, 사람이 스크롤하는 동안 읽던 줄을 기억해 둔다.
 *   capture()  지금 읽는 줄의 한 점과 그 화면 높이 { top, viewport, … } 또는 null(본문이 읽는 줄에 걸치지 않음).
 *   top(anchor) 그 점이 지금 있는 화면 높이.
 *   기억한 점은 이 모듈이 아닌 것이 스크롤했을 때만 바뀐다. 그래서 너비가 여러 번 바뀌어도(끌기) 같은 글자로
 *   돌아오고 줄 단위로 밀리지 않으며, 사람이 스크롤하는 동안에는 보정이 끼어들지 않는다(너비가 바뀐 그때 한 번뿐).
 *   줄은 스크롤이 멎은 뒤(120ms) 한 번만 잰다. 긴 원문 한 덩이에서 글자 위치를 재는 일은 스크롤 프레임마다 하기에는
 *   비싸다. 아직 재지 않은 스크롤 뒤에 너비가 바뀌면, 본문을 잠깐 이전 너비로 되돌려 그때 화면에 있던 줄을 잰다. */
(function (root) {
  'use strict';
  const STEP = 16, LARGE_STEP = 64;
  // Shared by every separator on the page: a drag in progress, or a scroll this module just made to keep the
  // reading line in place. assets/life/ui.js does not count that time as reading (reading-position.js).
  let dragging = 0, holdingScroll = 0;
  const adjusting = () => dragging > 0 || holdingScroll > 0;
  function readStored(key) {
    try {
      const raw = root.localStorage.getItem(key);
      if (raw === null || !/^\d{2,5}$/.test(raw)) return null;
      const value = Number(raw);
      return value >= 100 && value <= 20000 ? value : null;
    } catch { return null; }
  }
  function writeStored(key, value) {
    try {
      if (value === null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, String(Math.round(value)));
    } catch { /* Private mode or blocked storage: the width still applies for this view. */ }
  }
  function attach(container, options = {}) {
    const doc = container.ownerDocument, view = doc.defaultView || root;
    const { key, before = null, controls = null, label = '목록 너비 조절', cssVar = '--haedo-split-list' } = options;
    const min = options.min ?? 280, readerMin = options.readerMin ?? 420, defaultWidth = options.defaultWidth ?? 400;
    const separator = doc.createElement('div');
    separator.className = 'haedo-split-handle';
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-orientation', 'vertical');
    separator.setAttribute('aria-label', label);
    if (controls) separator.setAttribute('aria-controls', controls);
    separator.tabIndex = 0;
    separator.title = label + ' · 끌기, 화살표 키 · 두 번 누르면 기본 너비';
    const grip = doc.createElement('span'); grip.className = 'haedo-split-grip'; grip.setAttribute('aria-hidden', 'true');
    separator.append(grip);
    container.insertBefore(separator, before && before.parentNode === container ? before : null);

    // preferred: what the person chose (stored); width: what is shown after clamping to this window.
    let preferred = key ? readStored(key) : null, width = null, frame = 0, drag = null, disposed = false;
    const visible = () => separator.isConnected && separator.getClientRects().length > 0;
    function bounds() {
      const style = view.getComputedStyle(container);
      const inner = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      return { min, max: Math.max(min, Math.floor(inner - separator.offsetWidth - readerMin)) };
    }
    const clamp = (value, range) => Math.min(range.max, Math.max(range.min, Math.round(value)));
    // Keep the line the person was reading at the same height while the reading column reflows.
    // This is a program scroll, so it is not taken as reading input (assets/life/reading-position.js).
    function holdReading() {
      const target = typeof options.keepVisible === 'function' ? options.keepVisible() : options.keepVisible;
      if (!target?.isConnected) return null;
      const box = target.getBoundingClientRect(), y = view.innerHeight / 3;
      if (box.top >= y || box.bottom <= y) return null;
      // One exact text node (the original reader): find the character on that line by binary search on range
      // geometry (caretRangeFromPoint ignores text while dragging turns selection off). Other content: the element there.
      let top = null;
      const text = target.firstChild;
      if (text && text.nodeType === 3 && target.childNodes.length === 1 && text.length) {
        const range = doc.createRange();
        let low = 0, high = text.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          range.setStart(text, mid); range.setEnd(text, mid + 1);
          if (range.getBoundingClientRect().bottom < y) low = mid + 1; else high = mid;
        }
        range.setStart(text, low); range.setEnd(text, low + 1);
        top = () => range.getBoundingClientRect().top;
      } else {
        const element = doc.elementFromPoint(box.left + 2, y);
        if (!element || !target.contains(element)) return null;
        top = () => element.getBoundingClientRect().top;
      }
      const before = top();
      return () => {
        const moved = top() - before;
        if (Math.abs(moved) < 1) return;
        // The scroll event fires in the next frame before its animation callbacks, so one frame covers it.
        holdingScroll++; view.requestAnimationFrame(() => { holdingScroll--; });
        view.scrollBy({ top: moved, behavior: 'instant' });
      };
    }
    function apply(value) {
      if (disposed || !visible()) return;
      const range = bounds();
      const next = clamp(value ?? preferred ?? defaultWidth, range);
      const restore = next !== width && width !== null && !options.lineKept?.() ? holdReading() : null;
      width = next;
      container.style.setProperty(cssVar, width + 'px');
      restore?.();
      separator.setAttribute('aria-valuemin', String(range.min));
      separator.setAttribute('aria-valuemax', String(range.max));
      separator.setAttribute('aria-valuenow', String(width));
      separator.setAttribute('aria-valuetext', '목록 ' + width + 'px');
    }
    function schedule(value) {
      if (frame) view.cancelAnimationFrame(frame);
      frame = view.requestAnimationFrame(() => { frame = 0; apply(drag ? drag.next : value); });
    }
    function choose(value) {
      // Keys and the end of a drag store the shown (clamped) width as the new preference.
      apply(value);
      if (width === null) return;
      preferred = width; if (key) writeStored(key, width);
    }
    function reset() { preferred = null; if (key) writeStored(key, null); apply(defaultWidth); }

    function endDrag(commit) {
      if (!drag) return;
      const current = drag; drag = null; dragging--;
      if (frame) { view.cancelAnimationFrame(frame); frame = 0; }
      doc.removeEventListener('keydown', escape, true);
      delete doc.documentElement.dataset.haedoSplitDragging;
      delete separator.dataset.dragging;
      try { if (separator.hasPointerCapture(current.id)) separator.releasePointerCapture(current.id); } catch { /* already released */ }
      // Only a pointer that actually moved the line chooses a width. A press without movement (click, tap)
      // keeps the stored preference, so a width clamped by a narrow window is never stored by accident.
      if (commit && current.moved) choose(current.next);
      else if (commit) apply();
      else apply(current.start);
    }
    function escape(event) {
      if (event.key !== 'Escape' || !drag) return;
      // The drag owns Escape: it must not also close the reader.
      event.preventDefault(); event.stopPropagation(); endDrag(false);
    }
    function pointerDown(event) {
      if (drag || !visible() || event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      apply();
      drag = { id: event.pointerId, x: event.clientX, start: width, next: width, moved: false }; dragging++;
      try { separator.setPointerCapture(event.pointerId); } catch { /* the pointer already ended */ }
      doc.documentElement.dataset.haedoSplitDragging = 'true';
      separator.dataset.dragging = 'true';
      doc.addEventListener('keydown', escape, true);
    }
    function pointerMove(event) {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      drag.next = drag.start + event.clientX - drag.x;
      if (Math.round(drag.next) !== drag.start) drag.moved = true;
      schedule();
    }
    const pointerUp = event => { if (drag && event.pointerId === drag.id) endDrag(true); };
    const pointerCancel = event => { if (drag && event.pointerId === drag.id) endDrag(false); };
    const lostCapture = event => { if (drag && event.pointerId === drag.id) endDrag(true); };
    function keyDown(event) {
      if (drag || !visible() || event.altKey || event.ctrlKey || event.metaKey) return;
      const range = bounds(), step = event.shiftKey ? LARGE_STEP : STEP, now = width ?? clamp(preferred ?? defaultWidth, range);
      let next = null;
      if (event.key === 'ArrowLeft') next = now - step;
      else if (event.key === 'ArrowRight') next = now + step;
      else if (event.key === 'Home') next = range.min;
      else if (event.key === 'End') next = range.max;
      else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); reset(); return; }
      if (next === null) return;
      event.preventDefault(); event.stopPropagation();
      choose(next);
    }
    const doubleClick = event => { event.preventDefault(); reset(); };
    separator.addEventListener('pointerdown', pointerDown);
    separator.addEventListener('pointermove', pointerMove);
    separator.addEventListener('pointerup', pointerUp);
    separator.addEventListener('pointercancel', pointerCancel);
    separator.addEventListener('lostpointercapture', lostCapture);
    separator.addEventListener('keydown', keyDown);
    separator.addEventListener('dblclick', doubleClick);
    // A narrower window shows a clamped width; the stored preference returns when it widens again.
    const resized = () => { if (!drag) schedule(); };
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(resized) : null;
    if (observer) observer.observe(container);
    view.addEventListener('resize', resized);
    apply();

    return function dispose() {
      if (disposed) return;
      endDrag(false);
      disposed = true;
      if (frame) view.cancelAnimationFrame(frame);
      observer?.disconnect();
      view.removeEventListener('resize', resized);
      separator.remove();
      container.style.removeProperty(cssVar);
    };
  }
  function keepLine(host, adapter) {
    const doc = host.ownerDocument, view = doc.defaultView || root;
    const SETTLE = 120;
    let anchor = null, width = null, dirty = false, timer = null, paused = 0, expected = null, seenY = null, lastY = null, disposed = false;
    const hostWidth = () => host.getBoundingClientRect().width;
    function measure() {
      dirty = false; view.clearTimeout(timer); timer = null;
      if (disposed || paused || !host.isConnected) return;
      // A width that differs from the last one seen means the layout already reflowed: what is on the reading
      // line now is not what the person was reading. The observer below takes the line at the earlier width.
      if (width !== null && Math.abs(hostWidth() - width) >= 0.5) return;
      anchor = adapter.capture(); seenY = view.scrollY;
    }
    // The line that was on screen before the reflow: lay the text out at its earlier width for one measurement.
    // Used only when the page was scrolled after the last measurement and the width changed before the next one.
    function measureAt(previous) {
      dirty = false; view.clearTimeout(timer); timer = null;
      const style = host.style, saved = { boxSizing: style.boxSizing, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth };
      Object.assign(style, { boxSizing: 'border-box', width: previous + 'px', minWidth: previous + 'px', maxWidth: previous + 'px' });
      try { anchor = adapter.capture(); } finally { Object.assign(style, saved); }
      seenY = view.scrollY;
    }
    function scrolled() {
      if (disposed) return;
      // This module's own correction is not a new place to read from.
      if (expected !== null && Math.abs(view.scrollY - expected) < 1.5) { expected = null; return; }
      expected = null; lastY = view.scrollY;
      if (paused) return;
      // Measured once the scrolling has stopped, not in every scrolled frame.
      dirty = true; view.clearTimeout(timer); timer = view.setTimeout(() => { timer = null; if (dirty) measure(); }, SETTLE);
    }
    function restore() {
      if (disposed || paused || !anchor || !host.isConnected) return false;
      const now = adapter.top(anchor);
      if (!Number.isFinite(now)) return false;
      // The same height on screen; after a rotation, the same share of the new screen height.
      const want = anchor.viewport && anchor.viewport !== view.innerHeight ? anchor.top * view.innerHeight / anchor.viewport : anchor.top;
      const limit = Math.max(0, doc.documentElement.scrollHeight - view.innerHeight);
      const target = Math.min(limit, Math.max(0, view.scrollY + now - want));
      if (Math.abs(target - view.scrollY) < 1) return false;
      expected = target;
      // A program scroll, not reading (see holdReading): the scroll event fires in the next frame before its animation callbacks.
      holdingScroll++; view.requestAnimationFrame(() => { holdingScroll--; });
      view.scrollTo({ top: target, behavior: 'instant' });
      seenY = view.scrollY;
      return true;
    }
    function resized() {
      if (disposed || !host.isConnected) return;
      const now = hostWidth();
      if (width !== null && Math.abs(now - width) >= 0.5 && !paused) {
        // Only a line that was measured where the page still is can be put back. If the page was scrolled since
        // (by the person a moment ago, or by the app in this very frame), the remembered line is another place and
        // moving the page there would undo that scroll: the line is taken where the page is now, as it was laid
        // out before this reflow. (A reflow that shortened the page and pulled the scroll back to its end is not such a scroll.)
        const limit = Math.max(0, doc.documentElement.scrollHeight - view.innerHeight);
        const still = seenY !== null && (Math.abs(view.scrollY - seenY) < 1.5 || view.scrollY < seenY && view.scrollY >= limit - 1.5);
        if (!still) measureAt(width);
        dirty = false; view.clearTimeout(timer); timer = null;
        restore();
      }
      width = now;
    }
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(resized) : null;
    let resizeFrame = 0;
    const windowResized = () => { if (!resizeFrame) resizeFrame = view.requestAnimationFrame(() => { resizeFrame = 0; resized(); }); };
    if (observer) observer.observe(host); else view.addEventListener('resize', windowResized);
    view.addEventListener('scroll', scrolled, { passive: true });
    return {
      // The line being read now. A scroll that has not been measured yet (or whose event has not arrived) is measured here.
      get() { if (dirty || view.scrollY !== seenY) measure(); return anchor ? { ...anchor } : null; },
      // The line last read, for when the screen may already be changing (a reader closing): a pending measurement is
      // taken only if the page is still where the last scroll left it; otherwise the last measured line stands.
      peek() { if (dirty && lastY !== null && Math.abs(view.scrollY - lastY) < 1.5) measure(); return anchor ? { ...anchor } : null; },
      // The caller has just put the page where this line is: the scroll event of that move (it arrives in the next
      // frame) is not a new place to read from, so the given point stays the remembered one.
      set(value) { anchor = value ? { ...value } : null; dirty = false; view.clearTimeout(timer); timer = null; seenY = lastY = expected = view.scrollY; if (host.isConnected) width = hostWidth(); },
      restore,
      pause() { if (dirty || view.scrollY !== seenY) measure(); paused++; },
      resume() { paused = Math.max(0, paused - 1); },
      dispose() {
        if (disposed) return;
        disposed = true;
        view.clearTimeout(timer);
        if (resizeFrame) view.cancelAnimationFrame(resizeFrame);
        observer?.disconnect();
        view.removeEventListener('resize', windowResized);
        view.removeEventListener('scroll', scrolled);
      }
    };
  }
  root.HaedoLife ||= {};
  root.HaedoLife.SplitResize = Object.freeze({ attach, adjusting, keepLine });
})(typeof window !== 'undefined' ? window : globalThis);
