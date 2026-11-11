/* Supplier adapter: Google News RSS search feed (checked 2026-11-11).
 *
 *   https://news.google.com/rss/search?q=<topic>&hl=ko&gl=KR&ceid=KR:ko
 *   https://news.google.com/rss/search?q=<topic>&hl=en-US&gl=US&ceid=US:en
 *
 * One call returns at most 100 items: <title>"headline - outlet"</title>,
 * <link> (a news.google.com address; it is used as it is and never resolved),
 * <pubDate>, <source url="outlet home">outlet</source>. There is no image.
 * <description> is HTML and is never read. The feed's own terms allow it only
 * inside a personal feed reader for personal, non-commercial use.
 *
 * SUPPLIER CONTRACT (enforced by ../upstream.mjs, fixed by tests/news-wide-*.test.cjs)
 *   id         stable name returned to the client and stored with the cache
 *   label      the receiver's name the settings screen must show
 *   host       the one HTTPS host a request may go to
 *   path       the one path on that host
 *   linkHosts  the only hosts an item link may point to
 *   accept     response media types
 *   arrays     element paths that are always lists
 *   url(topic, language)  the request address. upstream.mjs refuses anything
 *              that is not exactly https://<host><path>?<query>, so an adapter
 *              cannot send a request anywhere else. Only the topic and the
 *              language reach this function: no account, session or project
 *              value exists here to be sent.
 *   extract(document)     raw { title, link, published, sourceName, sourceUrl }
 *              strings as the feed gave them. Every value is validated again
 *              by ../items.mjs; an adapter never returns body text or HTML.
 * A second supplier (for example GDELT DOC 2.0, not verified on 2026-11-11 and
 * not implemented) is a new file with this shape plus its id in the SQL check. */
import { text } from '../xml.mjs';

const EDITIONS = Object.freeze({
  ko: Object.freeze({ hl: 'ko', gl: 'KR', ceid: 'KR:ko' }),
  en: Object.freeze({ hl: 'en-US', gl: 'US', ceid: 'US:en' }),
});
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const googleNews = Object.freeze({
  id: 'google-news-rss',
  label: 'Google 뉴스',
  host: 'news.google.com',
  path: '/rss/search',
  linkHosts: Object.freeze(['news.google.com']),
  accept: Object.freeze(['application/xml', 'text/xml', 'application/rss+xml']),
  arrays: Object.freeze(['rss.channel.item']),
  languages: Object.freeze(Object.keys(EDITIONS)),
  url(topic, language) {
    const edition = EDITIONS[language];
    if (!edition || typeof topic !== 'string') throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
    // encodeURIComponent leaves ! ' ( ) * as they are; they are encoded too, so the
    // topic is one opaque q value and the address is already in its final form.
    const q = encodeURIComponent(topic).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    return 'https://news.google.com/rss/search?q=' + q + '&hl=' + edition.hl + '&gl=' + edition.gl + '&ceid=' + edition.ceid;
  },
  extract(document) {
    const channel = document?.rss?.channel;
    if (!object(document) || document.rss?.['@_version'] !== '2.0' || !object(channel)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
    return list(channel.item).filter(object).map(item => {
      const source = Array.isArray(item.source) ? null : item.source;
      return {
        title: Array.isArray(item.title) ? null : text(item.title),
        link: Array.isArray(item.link) ? null : text(item.link),
        published: Array.isArray(item.pubDate) ? null : text(item.pubDate),
        sourceName: text(source),
        sourceUrl: object(source) && typeof source['@_url'] === 'string' ? source['@_url'] : null,
      };
    });
  },
});
