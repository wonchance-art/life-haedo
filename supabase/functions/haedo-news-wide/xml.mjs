/* Strict XML reading for supplier feeds, on the fast-xml-parser bundle that
 * haedo-rss already vendors (../haedo-rss/vendor, MIT, pinned 5.12.0). The
 * parser is injected by index.ts; nothing here imports a dependency.
 *
 * Same refusals as haedo-rss/feed.mjs: no DOCTYPE or ENTITY, no processing
 * instruction other than the XML declaration, UTF-8 only, only the five
 * predefined entities and valid numeric references, bounded nesting and node
 * count. With no DOCTYPE an entity can only become one character, so the
 * expansion budget below cannot be used to grow the input. */

const fail = () => Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
const need = ok => { if (!ok) throw fail(); };

function checkEntities(xml) {
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml));
  need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(xml));
  for (let at = 0; at < xml.length; at++) {
    if (xml.startsWith('<![CDATA[', at) || xml.startsWith('<!--', at)) {
      const cdata = xml.startsWith('<![CDATA[', at), end = xml.indexOf(cdata ? ']]>' : '-->', at + (cdata ? 9 : 4));
      need(end >= 0); at = end + 2; continue;
    }
    if (xml[at] !== '&') continue;
    const end = xml.indexOf(';', at + 1); need(end > at && end - at <= 16);
    const ref = xml.slice(at + 1, end);
    if (!['amp', 'lt', 'gt', 'quot', 'apos'].includes(ref)) {
      need(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(ref));
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      need([9, 10, 13].includes(code) || code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff);
    }
    at = end;
  }
}

/** @param {{ XMLParser: any, XMLValidator: any, arrays: readonly string[], maxBytes: number }} options
 *  @returns {(xml: string) => any} parsed document, or an invalid_response failure */
export function createXMLReader({ XMLParser, XMLValidator, arrays, maxBytes }) {
  if (typeof XMLParser !== 'function' || typeof XMLValidator?.validate !== 'function') throw Object.assign(new Error('setup_required'), { code: 'setup_required' });
  let nodes = 0;
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: false,
    parseTagValue: false, parseAttributeValue: false, alwaysCreateTextNode: true, ignoreDeclaration: true,
    maxNestedTags: 16, updateTag: name => { need(++nodes <= 20000); return name; },
    // htmlEntities turns numeric references (&#39; &#x1F33F;) into characters. Named HTML
    // entities never get this far: checkEntities refuses every name but the five XML ones.
    htmlEntities: true, processEntities: { enabled: true, maxTotalExpansions: 200000, maxExpandedLength: maxBytes },
    isArray: (_name, path) => arrays.includes(path) });
  return xml => {
    need(typeof xml === 'string' && xml.length <= maxBytes);
    checkEntities(xml);
    need(!/<!DOCTYPE|<!ENTITY/i.test(xml) && !/<\?(?!xml(?:\s|\?>))/i.test(xml));
    need(!/^\s*<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])/i.test(xml));
    need(XMLValidator.validate(xml) === true);
    nodes = 0;
    try { return parser.parse(xml); } catch (_) { throw fail(); }
  };
}

/** Text of an element parsed with alwaysCreateTextNode, or null. */
export function text(value) {
  if (typeof value === 'string') return value;
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value['#text'] === 'string' ? value['#text'] : null;
}
