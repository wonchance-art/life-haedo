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
 * 구분선이 보이지 않는 폭(CSS가 숨김)에서는 아무것도 바꾸지 않는다. */
(function (root) {
  'use strict';
  const STEP = 16, LARGE_STEP = 64;
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
      let range = null;
      if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(box.left + 2, y);
      else if (doc.caretPositionFromPoint) {
        const point = doc.caretPositionFromPoint(box.left + 2, y);
        if (point) { range = doc.createRange(); range.setStart(point.offsetNode, point.offset); }
      }
      if (!range || !target.contains(range.startContainer)) return null;
      const node = range.startContainer;
      if (node.nodeType === 3 && range.startOffset < node.length) range.setEnd(node, range.startOffset + 1);
      const top = () => range.getBoundingClientRect().top;
      const before = top();
      return () => { const moved = top() - before; if (Math.abs(moved) >= 1) view.scrollBy({ top: moved, behavior: 'instant' }); };
    }
    function apply(value) {
      if (disposed || !visible()) return;
      const range = bounds();
      const next = clamp(value ?? preferred ?? defaultWidth, range);
      const restore = next !== width && width !== null ? holdReading() : null;
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
      const current = drag; drag = null;
      if (frame) { view.cancelAnimationFrame(frame); frame = 0; }
      doc.removeEventListener('keydown', escape, true);
      delete doc.documentElement.dataset.haedoSplitDragging;
      delete separator.dataset.dragging;
      try { if (separator.hasPointerCapture(current.id)) separator.releasePointerCapture(current.id); } catch { /* already released */ }
      if (commit) choose(current.next); else apply(current.start);
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
      drag = { id: event.pointerId, x: event.clientX, start: width, next: width };
      try { separator.setPointerCapture(event.pointerId); } catch { /* the pointer already ended */ }
      doc.documentElement.dataset.haedoSplitDragging = 'true';
      separator.dataset.dragging = 'true';
      doc.addEventListener('keydown', escape, true);
    }
    function pointerMove(event) {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      drag.next = drag.start + event.clientX - drag.x;
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
  root.HaedoLife ||= {};
  root.HaedoLife.SplitResize = Object.freeze({ attach });
})(typeof window !== 'undefined' ? window : globalThis);
