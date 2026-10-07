/* A single local reading point. User intent, exact text offsets, no network. */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  function safeOffset(text, offset) {
    const point = Math.max(0, Math.min(text.length, offset));
    return point > 0 && point < text.length && /[\uD800-\uDBFF]/.test(text[point - 1]) && /[\uDC00-\uDFFF]/.test(text[point]) ? point - 1 : point;
  }
  function visibleOffset(reader) {
    const text = reader.firstChild;
    if (!text || text.nodeType !== 3 || !text.length) return null;
    const box = reader.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= root.innerHeight) return null;
    const target = Math.max(box.top, Math.min(root.innerHeight / 3, box.bottom - 1));
    const range = reader.ownerDocument.createRange();
    let low = 0, high = text.length;
    // Range geometry keeps the exact original UTF-16 string, including CRLF.
    // Binary search avoids walking every glyph in a long original on each scroll.
    while (low < high) {
      const mid = Math.floor((low + high) / 2), start = safeOffset(text.data, mid);
      const end = Math.min(text.length, start + (text.data.codePointAt(start) > 0xFFFF ? 2 : 1));
      range.setStart(text, start); range.setEnd(text, end);
      const rect = range.getBoundingClientRect();
      if (rect.bottom < target) low = mid + 1;
      else high = mid;
    }
    return safeOffset(text.data, low);
  }
  function create({ storage, debounceMs = 400 }) {
    const sessions = new Set();
    let disposed = false;
    const guard = () => { if (disposed) throw Object.assign(new Error('읽기 화면이 닫혔습니다.'), { code: 'storage_scope_closed' }); };
    const read = workspaceId => { guard(); return storage.readReadingPosition(workspaceId); };
    function subscribe(workspaceId, listener) {
      return storage.subscribe(workspaceId, event => {
        if (!disposed && ['reading_position_changed', 'changed'].includes(event.type)) listener(event);
      });
    }
    async function clear(workspaceId, baseRevision) {
      guard();
      for (const session of sessions) if (session.workspaceId === workspaceId) session.suppress();
      return storage.clearReadingPosition(workspaceId, baseRevision);
    }
    function watchReader({ workspaceId, sourceId, sourceVersionId, reader, isReading, onError = () => {}, onSaved = () => {} }) {
      guard();
      let closed = false, state = null, pending = null, timer = null, inflight = null;
      let sequence = 0, intentUntil = 0, previousY = root.scrollY, frame = null;
      const document = reader.ownerDocument;
      const available = () => !disposed && !closed && reader.isConnected && document.visibilityState !== 'hidden' && isReading();
      const report = error => { if (available()) onError(error); };
      function suppress() {
        pending = null; intentUntil = 0;
        root.clearTimeout(timer); timer = null;
        if (frame !== null) root.cancelAnimationFrame(frame);
        frame = null;
      }
      async function refresh() {
        const token = ++sequence;
        state = null;
        try {
          const next = await read(workspaceId);
          if (!disposed && !closed && token === sequence) state = next;
        } catch (error) { if (token === sequence) report(error); }
      }
      async function flush() {
        root.clearTimeout(timer); timer = null;
        if (inflight) { await inflight; if (pending && !disposed) await flush(); return; }
        const candidate = pending; pending = null;
        if (!candidate || disposed) return;
        inflight = (async () => {
          let result = null, latest = null;
          try {
            // A conflicted old point is never retried with a newer revision.
            // Only a subsequent real reading action can propose another point.
            result = await storage.saveReadingPosition(workspaceId, candidate.position, candidate.revision);
          } catch (error) { report(error); }
          // A failed optional write must not leave this live reader permanently
          // without a revision. Recover read state; retry only on new user input.
          try { if (!disposed) latest = await read(workspaceId); }
          catch (error) { report(error); }
          if (disposed) { pending = null; return; }
          sequence += 1; state = latest;
          if (result?.status === 'stored' && latest && available()) onSaved();
          // Carry a NEW reading action across our own acknowledged write only.
          // A later tab/clear revision or a conflict invalidates that candidate.
          if (pending && result?.status === 'stored' && latest?.revision === result.state.revision && pending.revision === candidate.revision) {
            pending.revision = latest.revision;
          } else pending = null;
        })().finally(() => { inflight = null; });
        await inflight;
        if (pending && !disposed) await flush();
      }
      function queue(offset) {
        if (!available() || !state || !Number.isInteger(offset)) return;
        const text = reader.firstChild;
        if (!text || text.nodeType !== 3) return;
        const point = safeOffset(text.data, offset);
        if (!inflight && state.position?.sourceId === sourceId && state.position.sourceVersionId === sourceVersionId && state.position.offset === point) {
          pending = null; root.clearTimeout(timer); timer = null;
          return;
        }
        pending = { revision: state.revision, position: { sourceId, sourceVersionId, offset: point } };
        root.clearTimeout(timer); timer = root.setTimeout(flush, debounceMs);
      }
      function intent(event) {
        if (!event.isTrusted || !available()) return;
        if (event.type === 'keydown') {
          if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing ||
              event.target?.closest?.('input,textarea,select,[contenteditable="true"]') ||
              !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
        }
        intentUntil = root.performance.now() + 1200;
      }
      function scrolled() {
        const moved = root.scrollY !== previousY; previousY = root.scrollY;
        if (!moved || !available() || root.performance.now() > intentUntil) return;
        if (frame !== null) root.cancelAnimationFrame(frame);
        frame = root.requestAnimationFrame(() => { frame = null; if (available()) queue(visibleOffset(reader)); });
      }
      function selected(event) {
        if (!event.isTrusted || !available() || event.isComposing) return;
        if (event.type === 'keyup' && !event.shiftKey) return;
        const selection = root.getSelection();
        if (!selection || selection.rangeCount !== 1) return;
        const range = selection.getRangeAt(0), text = reader.firstChild;
        if (range.startContainer === text && range.endContainer === text && !range.collapsed) queue(range.startOffset);
      }
      const flushHidden = () => { if (document.visibilityState === 'hidden') { intentUntil = 0; flush(); } };
      const flushPage = () => { intentUntil = 0; flush(); };
      const off = subscribe(workspaceId, event => {
        // The fresh read after the receipt distinguishes our own notification
        // from a newer tab's write, without erasing newer user input prematurely.
        if (inflight && event.type === 'reading_position_changed') return;
        suppress(); refresh();
      });
      root.addEventListener('wheel', intent, { passive: true });
      root.addEventListener('touchmove', intent, { passive: true });
      root.addEventListener('keydown', intent);
      root.addEventListener('scroll', scrolled, { passive: true });
      root.addEventListener('resize', suppress);
      reader.addEventListener('pointerup', selected); reader.addEventListener('keyup', selected);
      document.addEventListener('visibilitychange', flushHidden);
      root.addEventListener('pagehide', flushPage);
      function close() {
        if (closed) return;
        flush(); closed = true; sequence++; intentUntil = 0; off();
        root.clearTimeout(timer); timer = null;
        if (frame !== null) root.cancelAnimationFrame(frame);
        frame = null;
        root.removeEventListener('wheel', intent); root.removeEventListener('touchmove', intent);
        root.removeEventListener('keydown', intent); root.removeEventListener('scroll', scrolled);
        root.removeEventListener('resize', suppress);
        reader.removeEventListener('pointerup', selected); reader.removeEventListener('keyup', selected);
        document.removeEventListener('visibilitychange', flushHidden); root.removeEventListener('pagehide', flushPage);
        sessions.delete(session);
      }
      const session = { workspaceId, flush, close, suppress };
      sessions.add(session); refresh(); return session;
    }
    function dispose() {
      disposed = true;
      for (const session of [...sessions]) session.close();
    }
    return Object.freeze({ read, clear, subscribe, watchReader, dispose });
  }
  life.ReadingPosition = Object.freeze({ create });
})(globalThis);
