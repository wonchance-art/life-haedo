#!/usr/bin/env python3
"""Fetch reviewed public RSS/Atom metadata; never receives user interests or article bodies.

No third-party dependencies. The fixed sources intentionally have metadata-only
rights: descriptions, content, images, comments and embedded HTML are not copied.
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
DEFAULT_OUTPUT = ROOT / 'assets/life/discovery-feed.json'
USER_AGENT = 'HaedoDiscoveryFeed/1.0 (public RSS metadata only)'
MAX_FEED_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 128 * 1024
MAX_PREVIOUS_BYTES = 2 * 1024 * 1024
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
        if date is None or date > now + timedelta(days=1):
            return None, 'invalid'
        return iso(date), 'valid'
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
            pairs = [(key, val) for key, val in urllib.parse.parse_qsl(query, keep_blank_values=True)
                     if not key.lower().startswith('utm_') and key.lower() not in TRACKING]
            query = urllib.parse.urlencode(pairs)
            fragment = ''
        return urllib.parse.urlunsplit(('https', host, parsed.path or '/', query, fragment))
    except FeedError:
        raise
    except (ValueError, UnicodeError) as cause:
        raise FeedError('올바르지 않은 URL') from cause


class RestrictedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 2

    def __init__(self, hosts):
        super().__init__()
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            approved_url(newurl, self.hosts)
        except FeedError as cause:
            raise FeedError('허용되지 않은 피드 이동 (HTTPS·등록 호스트만 허용)') from cause
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url, source, limit, timeout=20):
    url = approved_url(url, source['allowedHosts'])
    opener = urllib.request.build_opener(RestrictedRedirect(source['allowedHosts']))
    request = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT, 'Accept': 'application/atom+xml, application/rss+xml, application/xml, text/plain, text/html;q=0.5, */*;q=0.1',
        'Accept-Encoding': 'identity',
    }, method='GET')
    with opener.open(request, timeout=timeout) as response:
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


def check_robots(source, fetcher):
    robots_url = urllib.parse.urlunsplit(('https', urllib.parse.urlsplit(source['feedUrl']).hostname, '/robots.txt', '', ''))
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
    if not parser.can_fetch(USER_AGENT, source['feedUrl']):
        raise FeedError('공식 robots 정책에서 피드 수집을 허용하지 않음')
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


def parse_feed(body, source, now, limit=20):
    if source['rights']['mode'] != 'metadata_only':
        raise FeedError('검토되지 않은 재배포 권한')
    if len(body) > MAX_FEED_BYTES:
        raise FeedError('피드 크기 제한 초과')
    # The three reviewed feeds are UTF-8. Reject other encodings before inspecting XML
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
                updated_raw = child_text(entry, 'upDate')
                author = author_name(child_text(entry, f'{{{DC}}}creator') or child_text(entry, 'author'))
                tags = [plain(child_text(item, '.') if len(item) else item.text, 80) for item in entry.findall('category')]
                tags += [plain(item.text, 80) for item in entry.findall('tags')]
            url = approved_url(link, source['allowedHosts'])
            canonical = approved_url(url, source['allowedHosts'], canonical=True)
            published, date_status = parse_date(published_raw, source, now)
            updated, updated_status = parse_date(updated_raw, source, now)
            date_basis = 'published' if published else 'updated' if updated else 'unknown'
            article = {
                'id': 'article-' + source['id'] + '-' + hashlib.sha256(canonical.encode()).hexdigest()[:20],
                'sourceId': source['id'], 'url': url, 'canonicalUrl': canonical, 'title': title,
                'publishedAt': published, 'dateStatus': date_status,
                'updatedAt': updated, 'updatedDateStatus': updated_status, 'dateBasis': date_basis,
                'author': author, 'language': source['language'], 'tags': list(dict.fromkeys(tag for tag in tags if tag))[:20],
                'summary': '', 'coverage': 'link_only', 'rights': copy.deepcopy(source['rights']), 'fetchedAt': iso(now),
            }
            prior = articles.get(canonical)
            if prior is None or (published or updated or '') > (prior['publishedAt'] or prior['updatedAt'] or ''):
                articles[canonical] = article
        except (FeedError, ValueError, TypeError):
            rejected += 1
    ordered = sorted(articles.values(), key=lambda item: (item['publishedAt'] or item['updatedAt'] or '', item['canonicalUrl']), reverse=True)
    if not ordered:
        raise FeedError('허용되는 글 항목이 없는 피드')
    return ordered[:limit], {'feedEntries': len(entries), 'acceptedEntries': len(ordered), 'rejectedEntries': rejected}


def previous_articles(previous, source):
    """Retain only known public metadata from the last catalog, never unknown body fields."""
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
            kept.append(safe)
        except (FeedError, KeyError, TypeError):
            continue
    return kept


def error_label(cause):
    if isinstance(cause, urllib.error.HTTPError):
        return f'피드 응답 오류 (HTTP {cause.code})'
    if isinstance(cause, FeedError):
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
        public.update({'lastSuccessAt':iso(now),'fetchedAt':iso(now),'status':'ok','stale':False,'error':None,
                       'entryCount':len(articles),'latestArticleAt':max((a['publishedAt'] or a['updatedAt'] or '' for a in articles),default=None) or None})
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
    report = {'generatedAt':iso(now),'sourceCount':len(results),'okSources':sum(row[0]['status']=='ok' for row in results),
              'articleCount':len(catalog['articles']),'coverageCounts':{'link_only':len(catalog['articles']),'summary':0,'full_text':0},
              'sources':[row[2] for row in results], 'scope':'Official public feeds only. No user interests, private documents, article-page scraping or remote summarization.'}
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
