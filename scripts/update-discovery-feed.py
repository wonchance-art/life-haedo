#!/usr/bin/env python3
"""Fetch reviewed public feeds and explicitly licensed Frontiers article text.

No third-party dependencies or user interests. Other sources remain metadata-only.
Frontiers uses official RSS abstracts and bounded, individually licensed JATS XML.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
from contextlib import nullcontext
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from lib.discovery_article_content import (ArticleContentError, CC_BY_4, MAX_IMAGE_BYTES,
    MAX_XML_BYTES, frontiers_xml_url, image_payload, parse_frontiers_xml, retained_image, rss_abstract)

DEFAULT_OUTPUT = ROOT / 'assets/life/discovery-feed.json'
USER_AGENT = 'HaedoDiscoveryFeed/1.1 (reviewed public feeds and CC BY article text)'
MAX_FEED_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 128 * 1024
MAX_PREVIOUS_BYTES = 4 * 1024 * 1024
MAX_FEED_IMAGE_BYTES = 768 * 1024
MAX_FRONTIERS_TEXT_BYTES = 2 * 1024 * 1024
FRONTIERS_ADAPTER = 'frontiers-jats-v1'
STALE_AFTER_DAYS = 7
TRACKING = {'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', '_hsenc', '_hsmi', 'mc_cid', 'mc_eid'}
ATOM = 'http://www.w3.org/2005/Atom'
DC = 'http://purl.org/dc/elements/1.1/'
SOURCES = (
    {'id': 'naver-d2', 'name': 'NAVER D2', 'url': 'https://d2.naver.com/home',
     'feedUrl': 'https://d2.naver.com/d2.atom', 'allowedHosts': ['d2.naver.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://d2.naver.com/home'}},
    {'id': 'seoul-culture', 'name': '서울시 문화', 'url': 'https://news.seoul.go.kr/culture',
     'feedUrl': 'https://news.seoul.go.kr/culture/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/culture'}},
    {'id': 'woowahan-tech', 'name': '우아한형제들 기술블로그', 'url': 'https://techblog.woowahan.com/',
     'feedUrl': 'https://techblog.woowahan.com/feed/', 'allowedHosts': ['techblog.woowahan.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://techblog.woowahan.com/'}},
    {'id': 'readersnews-books', 'name': '독서신문', 'url': 'https://www.readersnews.com/',
     'feedUrl': 'https://www.readersnews.com/rss/allArticle.xml', 'allowedHosts': ['www.readersnews.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '공식 RSS 제목·링크 이용 범위 · 본문 미확보', 'url': 'https://www.readersnews.com/rssIndex.html'}},
    {'id': 'seoul-environment', 'name': '서울시 환경', 'url': 'https://news.seoul.go.kr/env',
     'feedUrl': 'https://news.seoul.go.kr/env/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/env'}},
    {'id': 'arxiv-cs-cl', 'name': 'arXiv cs.CL · 영문 사전공개 논문', 'url': 'https://arxiv.org/',
     'feedUrl': 'https://rss.arxiv.org/rss/cs.CL', 'allowedHosts': ['arxiv.org', 'rss.arxiv.org'],
     'language': 'en', 'requestIntervalSeconds': 3, 'rights': {'mode': 'metadata_only',
     'label': '메타데이터 CC0 · 영문 사전공개 논문 · 날짜는 RSS 공지일 · 원문별 권리 유지 · 초록·본문 미제공', 'url': 'https://info.arxiv.org/help/api/tou.html'}},
    {'id': 'mit-linguistics', 'name': 'MIT News · 언어학 · 영문', 'url': 'https://news.mit.edu/topic/linguistics',
     'feedUrl': 'https://news.mit.edu/topic/mitlinguistics-rss.xml', 'allowedHosts': ['news.mit.edu'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': 'MIT News 공식 RSS · 영문 제목·링크·작성자·분류만 · 본문 미제공', 'url': 'https://news.mit.edu/terms-of-use'}},
    {'id': 'llt-journal', 'name': 'Language Learning & Technology', 'url': 'https://www.lltjournal.org/',
     'feedUrl': 'https://www.lltjournal.org/feedlet/', 'allowedHosts': ['www.lltjournal.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '공식 RSS · 언어교육 동료심사 연구 · 제목·링크만 보관 · 2020년 이후 원문 CC BY-NC-ND 4.0(출처표시·비상업·원형유지)',
     'url': 'https://www.lltjournal.org/about/'}},
    {'id': 'frontiers-psychology', 'name': 'Frontiers in Psychology · 영문 심리학 연구',
     'url': 'https://www.frontiersin.org/journals/psychology',
     'feedUrl': 'https://www.frontiersin.org/journals/psychology/rss', 'allowedHosts': ['www.frontiersin.org'],
     'language': 'en', 'contentAdapter': FRONTIERS_ADAPTER, 'rights': {'mode': 'full_text_allowed',
     'label': '공식 RSS 초록 · 원문 CC-BY(출처표시·변경명시) · 개별 CC BY 4.0 확인 글은 본문·허용 그림 제공',
     'url': 'https://www.frontiersin.org/journals/psychology/about#copyright-statement'}},
)


class FeedError(ValueError):
    pass


class PlainText(HTMLParser):
    """Plain metadata only; never preserve element attributes or executable content."""
    BLOCKED = {'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.blocked = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCKED:
            self.blocked.append(tag)
        elif not self.blocked and tag in {'br', 'p', 'div', 'li'}:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in self.blocked:
            index = len(self.blocked) - 1 - self.blocked[::-1].index(tag)
            del self.blocked[index:]
        elif not self.blocked and tag in {'p', 'div', 'li'}:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.blocked:
            self.parts.append(data)


def plain(value, limit=500):
    parser = PlainText()
    parser.feed(str(value or ''))
    parser.close()
    text = ''.join(parser.parts)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]', '', text)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_date(value, source, now):
    value = plain(value, 160)
    if not value:
        return None, 'unknown'
    try:
        try:
            date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            # Seoul's official RSS emits local post_date without an offset.
            date = date.replace(tzinfo=timezone(timedelta(hours=9))) if source.get('timezone') == '+09:00' else None
        if date is None:
            return None, 'invalid'
        # Keep the official timestamp, but never call a scheduled/future item
        # a published fresh item. This matches the browser's five-minute grace.
        return iso(date), 'future' if date > now + timedelta(minutes=5) else 'valid'
    except (ValueError, TypeError, OverflowError):
        return None, 'invalid'


def approved_url(value, hosts, *, canonical=False):
    """Fixed HTTPS host allowlist, no credentials, custom ports or literal controls."""
    if not isinstance(value, str) or not value or re.search(r'[\x00-\x20\x7f\\]', value):
        raise FeedError('허용되지 않은 URL')
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme.lower() != 'https' or parsed.username is not None or parsed.password is not None:
            raise FeedError('HTTPS 원문만 허용')
        if parsed.hostname is None or parsed.hostname.lower() not in hosts or parsed.port not in (None, 443):
            raise FeedError('등록되지 않은 원문 호스트')
        host = parsed.hostname.lower()
        # Keep the original link's required query. Only identity removes tracking and fragment.
        query = parsed.query
        fragment = parsed.fragment
        if canonical:
            # Do not decode/re-encode identity values: parse_qsl/urlencode
            # changes %20 to +, percent-escape case and signed query spelling.
            # Decode just each key to recognize known marketing parameters.
            parts = query.split('&') if query else []
            kept = []
            for part in parts:
                key = part.split('=', 1)[0]
                try:
                    key = urllib.parse.unquote_plus(key, encoding='utf-8', errors='strict')
                except UnicodeError:
                    pass
                if not key.lower().startswith('utm_') and key.lower() not in TRACKING:
                    kept.append(part)
            query = '&'.join(kept)
            # Match the browser URL constructor for unescaped Unicode and the
            # HTTPS special-query encode set without changing existing %XX,
            # plus signs, duplicate keys, delimiters or key order.
            safe_query = ''.join(chr(code) for code in range(33, 127) if chr(code) not in '\"#<>\'')
            query = urllib.parse.quote(query, safe=safe_query, encoding='utf-8', errors='strict')
            fragment = ''
        return urllib.parse.urlunsplit(('https', host, parsed.path or '/', query, fragment))
    except FeedError:
        raise
    except (ValueError, UnicodeError) as cause:
        raise FeedError('올바르지 않은 URL') from cause


class RequestPacer:
    """One source's complete connection plus minimum request-start spacing.

    The HTTPS handler calls wait for every actual attempt, including redirects.
    Clock/sleeper injection is only for deterministic offline policy tests.
    """
    def __init__(self, interval, *, clock=time.monotonic, sleeper=time.sleep):
        self.interval = interval
        self.clock = clock
        self.sleeper = sleeper
        self.lock = threading.RLock()
        self.last_started = None

    def __enter__(self):
        self.lock.acquire()
        return self

    def __exit__(self, *args):
        self.lock.release()

    def wait(self):
        with self.lock:
            if self.last_started is not None:
                remaining = self.interval - (self.clock() - self.last_started)
                while remaining > 0:
                    self.sleeper(remaining)
                    remaining = self.interval - (self.clock() - self.last_started)
            self.last_started = self.clock()


_PACERS = {}
_PACERS_LOCK = threading.Lock()


def source_pacer(source):
    interval = source.get('requestIntervalSeconds', 0)
    if not interval:
        return None
    with _PACERS_LOCK:
        if source['id'] not in _PACERS:
            _PACERS[source['id']] = RequestPacer(interval)
        return _PACERS[source['id']]


class PacedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, pacer):
        super().__init__()
        self.pacer = pacer

    def https_open(self, request):
        # HTTPRedirectHandler closes the previous response before opening the
        # next HTTPS attempt, so pacing never holds two redirect connections.
        self.pacer.wait()
        return super().https_open(request)


class RestrictedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 2

    def __init__(self, hosts, robots_allowed=None):
        super().__init__()
        self.hosts = hosts
        self.robots_allowed = robots_allowed

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            approved_url(newurl, self.hosts)
        except FeedError as cause:
            raise FeedError('허용되지 않은 피드 이동 (HTTPS·등록 호스트만 허용)') from cause
        if self.robots_allowed:
            self.robots_allowed(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url, source, limit, timeout=20, *, pacer=None):
    url = approved_url(url, source['allowedHosts'])
    pacer = pacer if pacer is not None else source_pacer(source)
    handlers = [RestrictedRedirect(source['allowedHosts'], source.get('_robotsAllowed'))]
    if pacer is not None:
        handlers.append(PacedHTTPSHandler(pacer))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT, 'Accept': 'application/atom+xml, application/rss+xml, application/xml, text/plain, text/html;q=0.5, */*;q=0.1',
        'Accept-Encoding': 'identity',
    }, method='GET')
    # Hold only this source's gate through read/close and all redirects. Other
    # registered sources keep their existing independent parallel execution.
    with pacer if pacer is not None else nullcontext():
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as cause:
            # Error responses also own a connection; close before releasing the
            # source gate so a retry cannot overlap a still-open HTTP failure.
            cause.close()
            raise
        with response:
            approved_url(response.url, source['allowedHosts'])
            if response.headers.get('Content-Encoding', 'identity').lower() not in ('identity', ''):
                raise FeedError('지원하지 않는 압축 피드')
            body = response.read(limit + 1)
            if len(body) > limit:
                raise FeedError('피드 크기 제한 초과')
            return body, {'url': url, 'finalUrl': response.url, 'status': response.status,
                          'contentType': response.headers.get('Content-Type', ''), 'bytes': len(body),
                          'sha256': hashlib.sha256(body).hexdigest()}


def fixture_fetch(directory):
    """Synthetic offline fixtures only. Never a custom external URL input."""
    root = Path(directory)

    def fetch(url, source, limit):
        suffix = 'robots.txt' if urllib.parse.urlsplit(url).path == '/robots.txt' else 'xml'
        path = root / f"{source['id']}.{suffix}"
        if not path.is_file():
            raise FeedError('오프라인 검증 피드 없음')
        data = path.read_bytes()
        if len(data) > limit:
            raise FeedError('피드 크기 제한 초과')
        return data, {'url': url, 'finalUrl': url, 'status': 200,
                      'contentType': 'text/plain' if suffix == 'robots.txt' else 'application/xml',
                      'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    return fetch


def check_robots(source, fetcher, target_url=None):
    target_url = approved_url(target_url or source['feedUrl'], source['allowedHosts'])
    robots_url = urllib.parse.urlunsplit(('https', urllib.parse.urlsplit(target_url).hostname, '/robots.txt', '', ''))
    try:
        body, metadata = fetcher(robots_url, source, MAX_ROBOTS_BYTES)
    except urllib.error.HTTPError as cause:
        if cause.code in (404, 410):
            return {'status': 'not_provided', 'url': robots_url, 'httpStatus': cause.code}
        raise
    text = body.decode('utf-8', 'replace')
    if not re.search(r'^\s*user-agent\s*:', text, re.I | re.M):
        # D2 explicitly publishes Atom, but its robots path returns NotFound HTML.
        return {'status': 'not_provided', 'url': robots_url, 'responseSHA256': metadata['sha256']}
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    parser.parse(text.splitlines())
    if not parser.can_fetch(USER_AGENT, target_url):
        raise FeedError('공식 robots 정책에서 수집을 허용하지 않음')
    return {'status': 'allowed', 'url': robots_url, 'responseSHA256': metadata['sha256']}


def child_text(element, name):
    node = element.find(name)
    if node is None:
        return ''
    def safe_text(item):
        parts = [item.text or '']
        for child in item:
            if str(child.tag).rsplit('}', 1)[-1].lower() not in PlainText.BLOCKED:
                parts.append(safe_text(child))
            parts.append(child.tail or '')
        return ''.join(parts)
    return safe_text(node)


def author_name(value):
    value = plain(value, 200)
    # RSS <author> sometimes contains an email address; keep only an explicit display name.
    if '@' in value:
        match = re.search(r'\(([^()@]+)\)', value)
        return plain(match.group(1), 120) if match else None
    return value[:120] or None


def article_date(article):
    if article.get('dateStatus') == 'valid':
        return article.get('publishedAt') or ''
    if article.get('updatedDateStatus') == 'valid':
        return article.get('updatedAt') or ''
    return ''


def content_digest(article):
    return hashlib.sha256(json.dumps({key: article.get(key) for key in ('coverage', 'summary', 'bodyText', 'rights')},
                                    ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def mark_content(article, adapter, url, now, response=None):
    article['contentEvidence'] = {'adapter': adapter, 'url': url, 'checkedAt': iso(now),
                                  'contentSHA256': content_digest(article)}
    if response:
        article['contentEvidence']['responseSHA256'] = response['sha256']


def parse_feed(body, source, now, limit=20):
    content_enabled = source['id'] == 'frontiers-psychology' and source.get('contentAdapter') == FRONTIERS_ADAPTER
    if source['rights']['mode'] != 'metadata_only' and not content_enabled:
        raise FeedError('검토되지 않은 재배포 권한')
    if len(body) > MAX_FEED_BYTES:
        raise FeedError('피드 크기 제한 초과')
    # The reviewed feeds are UTF-8. Reject other encodings before inspecting XML
    # so a UTF-16 declaration cannot bypass the DTD/entity check with NUL bytes.
    try:
        decoded = body.decode('utf-8-sig')
    except UnicodeDecodeError as cause:
        raise FeedError('검토되지 않은 피드 문자 인코딩') from cause
    if '\x00' in decoded:
        raise FeedError('검토되지 않은 피드 문자 인코딩')
    # Ignore harmless literal examples in CDATA/comments, but reject actual declarations.
    markup = re.sub(r'<!\[CDATA\[.*?\]\]>|<!--.*?-->', '', decoded, flags=re.S)
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', markup, re.I):
        raise FeedError('DTD 또는 entity 선언 피드 거절')
    try:
        root = ET.fromstring(body)
    except ET.ParseError as cause:
        raise FeedError('피드 XML을 읽을 수 없음') from cause
    if root.tag == f'{{{ATOM}}}feed':
        atom = True
        entries = root.findall(f'{{{ATOM}}}entry')
    elif root.tag == 'rss' and root.find('channel') is not None:
        atom = False
        entries = root.findall('./channel/item')
    else:
        raise FeedError('지원하지 않는 RSS/Atom 형식')
    if not entries or len(entries) > 1000:
        raise FeedError('비어 있거나 항목 제한을 넘은 피드')
    articles = {}
    rejected = 0
    for entry in entries:
        try:
            prefix = f'{{{ATOM}}}' if atom else ''
            title = plain(child_text(entry, prefix + 'title'), 400)
            if not title:
                raise FeedError('제목 없음')
            if atom:
                links = [item for item in entry.findall(prefix + 'link') if item.get('rel', 'alternate') == 'alternate']
                link = links[0].get('href', '') if links else ''
                published_raw = child_text(entry, prefix + 'published')
                updated_raw = child_text(entry, prefix + 'updated')
                author = author_name(child_text(entry, prefix + 'author/' + prefix + 'name'))
                tags = [plain(item.get('term', ''), 80) for item in entry.findall(prefix + 'category')]
            else:
                link = child_text(entry, 'link').strip()
                published_raw = child_text(entry, 'pubDate') or child_text(entry, f'{{{DC}}}date')
                if source['id'] == 'frontiers-psychology':
                    # This reviewed RSS uses lowercase pubdate; do not broaden
                    # the accepted date fields of any other registered feed.
                    published_raw = published_raw or child_text(entry, 'pubdate')
                updated_raw = child_text(entry, 'upDate')
                author = author_name(child_text(entry, f'{{{DC}}}creator') or child_text(entry, 'author'))
                tags = [plain(child_text(item, '.') if len(item) else item.text, 80) for item in entry.findall('category')]
                tags += [plain(item.text, 80) for item in entry.findall('tags')]
            if source['id'] == 'frontiers-psychology':
                # Its categories identify article types, not subject matter.
                # They must not become topic/recommendation evidence.
                tags = []
            url = approved_url(link, source['allowedHosts'])
            canonical = approved_url(url, source['allowedHosts'], canonical=True)
            published, date_status = parse_date(published_raw, source, now)
            updated, updated_status = parse_date(updated_raw, source, now)
            date_basis = 'published' if date_status == 'valid' else 'updated' if updated_status == 'valid' else 'unknown'
            article = {
                'id': 'article-' + source['id'] + '-' + hashlib.sha256(canonical.encode()).hexdigest()[:20],
                'sourceId': source['id'], 'url': url, 'canonicalUrl': canonical, 'title': title,
                'publishedAt': published, 'dateStatus': date_status,
                'updatedAt': updated, 'updatedDateStatus': updated_status, 'dateBasis': date_basis,
                'author': author, 'language': source['language'], 'tags': list(dict.fromkeys(tag for tag in tags if tag))[:20],
                'summary': '', 'coverage': 'link_only', 'rights': copy.deepcopy(source['rights']), 'fetchedAt': iso(now),
            }
            if content_enabled:
                summary = rss_abstract(child_text(entry, 'description'))
                if summary:
                    article.update({'summary': summary, 'coverage': 'summary',
                        'rights': {'mode': 'summary_allowed', 'url': CC_BY_4,
                                   'label': 'CC BY 4.0 · ' + ((author + ' et al. · ') if author else '') + 'Frontiers · 공식 RSS 저자 초록(서식 단순화)'}})
                    mark_content(article, 'frontiers-rss-v1', canonical, now)
                else:
                    article['rights'] = {'mode': 'metadata_only', 'label': '공식 RSS 제목·링크 · 원문 권리 유지', 'url': source['rights']['url']}
            prior = articles.get(canonical)
            if prior is None or article_date(article) > article_date(prior):
                articles[canonical] = article
        except (FeedError, ValueError, TypeError):
            rejected += 1
    ordered = sorted(articles.values(), key=lambda item: (article_date(item), item['canonicalUrl']), reverse=True)
    if not ordered:
        raise FeedError('허용되는 글 항목이 없는 피드')
    return ordered[:limit], {'feedEntries': len(entries), 'acceptedEntries': len(ordered), 'rejectedEntries': rejected}


def retained_content(item, source):
    """Reuse only a matching, bounded payload from this reviewed adapter."""
    if source['id'] != 'frontiers-psychology' or source.get('contentAdapter') != FRONTIERS_ADAPTER:
        return {}
    evidence = item.get('contentEvidence')
    if not isinstance(evidence, dict) or evidence.get('adapter') not in ('frontiers-rss-v1', FRONTIERS_ADAPTER):
        return {}
    canonical = approved_url(item['url'], source['allowedHosts'], canonical=True)
    if evidence.get('url') != canonical or evidence.get('contentSHA256') != content_digest(item):
        return {}
    permission = item.get('rights', {})
    summary, body = item.get('summary'), item.get('bodyText', '')
    if (not isinstance(permission, dict) or permission.get('url') != CC_BY_4
            or not isinstance(permission.get('label'), str) or len(permission['label']) > 500
            or not isinstance(summary, str) or len(summary) > 50000
            or not isinstance(body, str) or len(body) > 200000):
        return {}
    coverage = item.get('coverage')
    if coverage == 'full_text':
        if evidence['adapter'] != FRONTIERS_ADAPTER or permission.get('mode') != 'full_text_allowed' or not body.strip():
            return {}
    elif coverage == 'summary':
        if body or not summary.strip() or permission.get('mode') not in ('full_text_allowed', 'summary_allowed'):
            return {}
    else:
        return {}
    kept = {key: copy.deepcopy(item[key]) for key in ('coverage', 'summary', 'rights', 'contentEvidence')}
    if body:
        kept['bodyText'] = body
    images = []
    try:
        article_number = frontiers_xml_url(canonical).rsplit('/', 2)[-2].rsplit('.', 1)[-1] if coverage == 'full_text' else None
    except ArticleContentError:
        return {}
    for image in item.get('images', [])[:2] if coverage == 'full_text' and isinstance(item.get('images', []), list) else []:
        try:
            if not re.fullmatch(r'https://www\.frontiersin\.org/files/Articles/' + re.escape(article_number)
                                + r'/xml-images/fpsyg-\d+-' + re.escape(article_number) + r'-g\d+\.(?:png|jpg|webp)', image.get('sourceUrl', '')):
                continue
            images.append(retained_image(image))
        except (ArticleContentError, TypeError, ValueError):
            continue
    if images:
        kept['images'] = images
    return kept


def previous_articles(previous, source):
    """Retain known metadata and verified content from the same opt-in adapter."""
    kept = []
    for item in previous.get('articles', []):
        if not isinstance(item, dict) or item.get('sourceId') != source['id']:
            continue
        try:
            url = approved_url(item['url'], source['allowedHosts'])
            canonical = approved_url(url, source['allowedHosts'], canonical=True)
            title = plain(item.get('title'), 400)
            if not title:
                continue
            safe = {key:copy.deepcopy(item[key]) for key in ('publishedAt','dateStatus','updatedAt','updatedDateStatus','dateBasis','author','language','fetchedAt') if key in item}
            safe.update({'id':'article-'+source['id']+'-'+hashlib.sha256(canonical.encode()).hexdigest()[:20],
                         'sourceId':source['id'],'url':url,'canonicalUrl':canonical,'title':title,
                         'tags':list(dict.fromkeys(plain(tag,80) for tag in item.get('tags',[]) if isinstance(tag,str)))[:20],
                         'summary':'','coverage':'link_only','rights':copy.deepcopy(source['rights'])})
            safe['author'] = author_name(safe.get('author'))
            safe['language'] = source['language']
            if source['id'] == 'frontiers-psychology':
                safe['tags'] = []
                safe['rights'] = {'mode': 'metadata_only', 'label': '공식 RSS 제목·링크 · 원문 권리 유지', 'url': source['rights']['url']}
                safe.update(retained_content(item, source))
            kept.append(safe)
        except (FeedError, KeyError, TypeError):
            continue
    return kept


def enrich_articles(articles, source, previous, now, fetcher, evidence):
    if source.get('contentAdapter') != FRONTIERS_ADAPTER or source['id'] != 'frontiers-psychology':
        return articles
    old = {item['canonicalUrl']: item for item in previous_articles(previous, source)}
    rss_payloads = {item['canonicalUrl']: copy.deepcopy(item) for item in articles}
    evidence['articleContent'] = []
    article_source = {**source, '_robotsAllowed': lambda url: check_robots(source, fetcher, url)}
    image_bytes = 0
    for index, article in enumerate(articles):
        prior = old.get(article['canonicalUrl'])
        same_version = prior and all(prior.get(k) == article.get(k) for k in ('title', 'publishedAt', 'updatedAt'))
        if index >= 3:
            if same_version and prior.get('coverage') == 'full_text':
                article.update(retained_content(prior, source))
                article['fetchedAt'] = prior['fetchedAt']
            continue
        row = {'articleId': article['id'], 'status': 'error'}
        try:
            xml_url = frontiers_xml_url(article['canonicalUrl'])
            check_robots(source, fetcher, xml_url)
            data, response = fetcher(xml_url, article_source, MAX_XML_BYTES)
            check_robots(source, fetcher, approved_url(response.get('finalUrl', xml_url), source['allowedHosts']))
            if response.get('contentType', '').split(';', 1)[0].strip().lower() not in ('application/xml', 'text/xml'):
                raise FeedError('본문 XML 응답 형식 오류')
            payload, candidates = parse_frontiers_xml(data, article['canonicalUrl'])
            article.update(payload)
            mark_content(article, FRONTIERS_ADAPTER, article['canonicalUrl'], now, response)
            images = []
            for candidate in candidates:
                if image_bytes >= MAX_FEED_IMAGE_BYTES:
                    break
                try:
                    image_url = approved_url(candidate['sourceUrl'], source['allowedHosts'])
                    check_robots(source, fetcher, image_url)
                    image_data, image_response = fetcher(image_url, article_source, min(MAX_IMAGE_BYTES, MAX_FEED_IMAGE_BYTES - image_bytes))
                    check_robots(source, fetcher, approved_url(image_response.get('finalUrl', image_url), source['allowedHosts']))
                    images.append(image_payload(image_data, image_response.get('contentType', ''), candidate))
                    image_bytes += len(image_data)
                except (ArticleContentError, FeedError, ValueError, OSError, urllib.error.URLError):
                    continue
            if images:
                article['images'] = images
            row.update({'status': 'ok', 'coverage': article['coverage'], 'responseSHA256': response['sha256'], 'imageCount': len(images)})
        except (ArticleContentError, FeedError, ValueError, OSError, urllib.error.URLError) as cause:
            if same_version and prior.get('coverage') == 'full_text':
                article.update(retained_content(prior, source))
                article['fetchedAt'] = prior['fetchedAt']
                row['retainedContent'] = True
            row['error'] = error_label(cause)
        evidence['articleContent'].append(row)
    # Retained articles can carry older images; apply the same global bound to
    # fresh and retained payloads, in the stable article order.
    remaining = MAX_FEED_IMAGE_BYTES
    remaining_text = MAX_FRONTIERS_TEXT_BYTES
    for article in articles:
        text_bytes = len((article.get('summary', '') + article.get('bodyText', '')).encode())
        if text_bytes > remaining_text and article.get('coverage') == 'full_text':
            original = rss_payloads[article['canonicalUrl']]
            article['fetchedAt'] = original['fetchedAt']
            for field in ('bodyText', 'images', 'contentEvidence'):
                article.pop(field, None)
            for field in ('coverage', 'summary', 'rights', 'contentEvidence'):
                if field in original:
                    article[field] = original[field]
            text_bytes = len(article.get('summary', '').encode())
        remaining_text = max(0, remaining_text - text_bytes)
        kept = []
        for image in article.get('images', []):
            size = len(image['dataBase64']) * 3 // 4 - image['dataBase64'].count('=')
            if size <= remaining:
                kept.append(image)
                remaining -= size
        if kept:
            article['images'] = kept
        else:
            article.pop('images', None)
    return articles


def error_label(cause):
    if isinstance(cause, urllib.error.HTTPError):
        return f'피드 응답 오류 (HTTP {cause.code})'
    if isinstance(cause, (FeedError, ArticleContentError)):
        return str(cause)
    if isinstance(cause, (TimeoutError, urllib.error.URLError, OSError)):
        return '공급원에 연결하지 못함'
    return '피드를 갱신하지 못함'


def refresh_one(source, previous, now, fetcher):
    old = next((item for item in previous.get('sources', []) if isinstance(item, dict) and item.get('id') == source['id']), {})
    public = {key:copy.deepcopy(source[key]) for key in ('id','name','url','feedUrl','language','rights')}
    public.update({'freshnessMaxAgeDays':STALE_AFTER_DAYS,'lastAttemptAt':iso(now),'attemptAt':iso(now),'lastSuccessAt':old.get('lastSuccessAt'),
                   'fetchedAt':old.get('lastSuccessAt'),'status':'error','stale':True,'error':None})
    evidence = {'sourceId':source['id'],'attemptAt':iso(now),'requests':[]}
    stage = 'robots'
    original_fetcher, robots_cache = fetcher, {}
    def checked_fetcher(url, source, limit):
        if urllib.parse.urlsplit(url).path != '/robots.txt':
            return original_fetcher(url, source, limit)
        if url not in robots_cache:
            robots_cache[url] = original_fetcher(url, source, limit)
        return robots_cache[url]
    fetcher = checked_fetcher
    try:
        robots = check_robots(source, fetcher)
        public['robotsStatus'] = robots['status']
        public['robotsCheckedAt'] = iso(now)
        evidence['robots'] = robots
        stage = 'feed'
        body, response = fetcher(source['feedUrl'], source, MAX_FEED_BYTES)
        evidence['requests'].append(response)
        stage = 'parse'
        articles, stats = parse_feed(body, source, now)
        stage = 'article-content'
        articles = enrich_articles(articles, source, previous, now, fetcher, evidence)
        public.update({'lastSuccessAt':iso(now),'fetchedAt':iso(now),'status':'ok','stale':False,'error':None,
                       'entryCount':len(articles),'latestArticleAt':max((article_date(a) for a in articles),default=None) or None})
        if any(row.get('retainedContent') for row in evidence.get('articleContent', [])):
            public['stale'] = True
        evidence.update(stats)
        evidence['status'] = 'ok'
        return public, articles, evidence
    except Exception as cause:
        public['error'] = error_label(cause)
        public['robotsStatus'] = public.get('robotsStatus', 'unavailable')
        articles = previous_articles(previous, source)
        public['entryCount'] = len(articles)
        public['latestArticleAt'] = old.get('latestArticleAt')
        evidence.update({'status':'error','error':public['error'],'failureStage':stage,
                         'failureType':type(cause).__name__,'retainedArticles':len(articles)})
        if isinstance(cause, urllib.error.HTTPError):
            evidence['httpStatus'] = cause.code
        return public, articles, evidence


def refresh_catalog(previous, now, fetcher=fetch_public):
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SOURCES)) as executor:
        pending = [executor.submit(refresh_one, source, previous, now, fetcher) for source in SOURCES]
        for future in pending:
            results.append(future.result())
    catalog = {'schemaVersion':1,'generatedAt':iso(now),'sources':[row[0] for row in results],
               'articles':[article for row in results for article in row[1]]}
    remaining_images = MAX_FEED_IMAGE_BYTES
    for article in catalog['articles']:
        images = []
        for image in article.get('images', []):
            size = len(image['dataBase64']) * 3 // 4 - image['dataBase64'].count('=')
            if size <= remaining_images:
                images.append(image)
                remaining_images -= size
        if images:
            article['images'] = images
        else:
            article.pop('images', None)
    if len((json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode()) > MAX_PREVIOUS_BYTES:
        raise FeedError('갱신 카탈로그 크기 제한 초과: 기존 파일 보존')
    report = {'generatedAt':iso(now),'sourceCount':len(results),'okSources':sum(row[0]['status']=='ok' for row in results),
              'articleCount':len(catalog['articles']),'coverageCounts':{coverage:sum(a['coverage']==coverage for a in catalog['articles']) for coverage in ('link_only','summary','full_text')},
              'sources':[row[2] for row in results], 'scope':'Reviewed official public feeds; Frontiers RSS abstracts and individually verified CC BY 4.0 JATS text and figures. No user interests, private documents or remote summarization.'}
    return catalog, report


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,prefix='.'+path.name+'.',suffix='.tmp',delete=False) as stream:
            temporary = stream.name
            json.dump(data,stream,ensure_ascii=False,indent=2)
            stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def load_previous(path):
    if not path.exists():
        return {'schemaVersion':1,'sources':[],'articles':[]}
    if path.stat().st_size > MAX_PREVIOUS_BYTES:
        raise FeedError('기존 카탈로그 크기 제한 초과: 파일 보존')
    previous = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(previous,dict) or previous.get('schemaVersion')!=1 or not isinstance(previous.get('sources'),list) or not isinstance(previous.get('articles'),list):
        raise FeedError('기존 카탈로그 형식 오류: 파일 보존')
    try:
        generated = previous.get('generatedAt')
        if not isinstance(generated, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', generated):
            raise ValueError('invalid timestamp')
        datetime.fromisoformat(generated.replace('Z', '+00:00'))
    except ValueError as cause:
        raise FeedError('기존 카탈로그 시각 형식 오류: 파일 보존') from cause
    source_ids = set()
    for source in previous['sources']:
        if not isinstance(source, dict) or not isinstance(source.get('id'), str) or not source['id'] or source['id'] in source_ids:
            raise FeedError('기존 공급 상태 형식 오류: 파일 보존')
        source_ids.add(source['id'])
        if source.get('status') not in ('ok', 'error', 'never_fetched') or not isinstance(source.get('stale'), bool):
            raise FeedError('기존 공급 상태 형식 오류: 파일 보존')
        stamps = {}
        for field in ('lastSuccessAt', 'lastAttemptAt'):
            value = source.get(field)
            if value is None:
                stamps[field] = None
                continue
            try:
                if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', value):
                    raise ValueError('invalid timestamp')
                stamps[field] = datetime.fromisoformat(value.replace('Z', '+00:00'))
            except ValueError as cause:
                raise FeedError('기존 공급 시각 형식 오류: 파일 보존') from cause
        if source['status'] == 'error' and stamps['lastAttemptAt'] is None:
            raise FeedError('기존 공급 시도 시각 없음: 파일 보존')
        if source['status'] == 'ok' and (stamps['lastSuccessAt'] is None or stamps['lastAttemptAt'] is None):
            raise FeedError('기존 공급 성공 시각 없음: 파일 보존')
        if stamps['lastSuccessAt'] and stamps['lastAttemptAt'] and stamps['lastSuccessAt'] > stamps['lastAttemptAt']:
            raise FeedError('기존 공급 시각 순서 오류: 파일 보존')
    return previous


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DEFAULT_OUTPUT)
    parser.add_argument('--report',type=Path)
    parser.add_argument('--fixtures',type=Path,help='Synthetic offline XML/robots files for regression checks; no network')
    parser.add_argument('--now',help='UTC ISO time for reproducible checks; defaults to the actual clock')
    args=parser.parse_args()
    try:
        now=datetime.fromisoformat(args.now.replace('Z','+00:00')) if args.now else datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise FeedError('--now에는 시간대가 필요함')
        previous=load_previous(args.output)
        catalog,report=refresh_catalog(previous,now,fixture_fetch(args.fixtures) if args.fixtures else fetch_public)
        atomic_json(args.output,catalog)
        if args.report:atomic_json(args.report,report)
        print(json.dumps({'output':str(args.output),'report':str(args.report) if args.report else None,
                          'generatedAt':catalog['generatedAt'],'articleCount':len(catalog['articles']),
                          'sources':[{'id':s['id'],'status':s['status'],'entryCount':s['entryCount'],'stale':s['stale'],'error':s['error']} for s in catalog['sources']]},ensure_ascii=False))
        return 0 if report['okSources']==len(SOURCES) else 2
    except (FeedError, ValueError, OSError, json.JSONDecodeError) as cause:
        print(error_label(cause),file=sys.stderr)
        return 1


if __name__=='__main__':
    raise SystemExit(main())
