/* Read-only timeline links for the verified platform account. */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  const readOnly = () => !!root.VIEW_ONLY || life.Shell?.isReadOnly();
  const denied = () => new Error('현재 계정의 연표만 열 수 있습니다. 다시 로그인해 주세요.');

  function forAccount(input) {
    const userId = input?.userId, projectUrl = input?.projectUrl;
    if (typeof userId !== 'string' || !userId || typeof projectUrl !== 'string' || !projectUrl) throw denied();
    function authorized() {
      return !readOnly() && root.HaedoAuth?.user?.id === userId && root.HaedoAuth?.config?.url === projectUrl;
    }
    function listDocuments() {
      if (!authorized()) return [];
      let registry;
      try {
        if (!root.HaedoPlatformData) throw denied();
        registry = root.HaedoPlatformData.registry(root.localStorage, userId);
      } catch (_) {
        throw new Error('이 계정의 연표 목록을 읽지 못했습니다. 원본은 그대로 있습니다.');
      }
      const seen = new Set();
      return registry.docs.filter(entry => {
        if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || seen.has(entry.id)) return false;
        seen.add(entry.id); return true;
      }).map(entry => ({ legacyDocId: entry.id, name: entry.name }));
    }
    function open(document) {
      if (!authorized() || !listDocuments().some(item => item.legacyDocId === document?.legacyDocId)) throw denied();
      const url = new URL('timeline.html', root.location.href);
      url.searchParams.set('doc', document.legacyDocId);
      return url.href;
    }
    return Object.freeze({ listDocuments, open });
  }
  // Loading the module never reads the old unowned registry or cloud settings.
  life.Legacy = Object.freeze({ forAccount, listDocuments: () => [], open: () => { throw denied(); } });
})(globalThis);
