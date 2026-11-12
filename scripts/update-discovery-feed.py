#!/usr/bin/env python3
"""Fetch reviewed public RSS/Atom metadata; never receives user interests or article bodies.

No third-party dependencies. The fixed sources intentionally have metadata-only
rights: descriptions, content, comments and embedded HTML are not copied. For a source
whose `images` entry is set, the address of the representative image its own feed names
(media:content, media:thumbnail or an image enclosure) is kept as a link; the image file
itself is never fetched or stored here.
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
DEFAULT_OUTPUT = ROOT / 'assets/life/discovery-feed.json'
USER_AGENT = 'HaedoDiscoveryFeed/1.0 (public RSS metadata only)'
MAX_FEED_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 128 * 1024
MAX_PREVIOUS_BYTES = 2 * 1024 * 1024
STALE_AFTER_DAYS = 7
TRACKING = {'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', '_hsenc', '_hsmi', 'mc_cid', 'mc_eid'}
ATOM = 'http://www.w3.org/2005/Atom'
DC = 'http://purl.org/dc/elements/1.1/'
MRSS = 'http://search.yahoo.com/mrss/'
MAX_IMAGE_URL = 2048
SAME_HOST_INTERVAL_SECONDS = 2
# Sources published before 2026-11-11. Browser validators shipped until then reject the whole
# catalog when `sources` lists any other id, so the file keeps exactly these in `sources` and
# `articles` and carries every later source in `extended` (which those validators never read).
LEGACY_SOURCE_IDS = ('naver-d2', 'seoul-culture', 'woowahan-tech', 'readersnews-books', 'seoul-environment',
                     'arxiv-cs-cl', 'mit-linguistics', 'llt-journal', 'frontiers-psychology')
# `publisher`: the 매체 a feed belongs to. The news list counts feeds of one publisher together when it spreads
# the latest order (assets/life/discovery.js PUBLISHERS must name the same publisher). Not written to the catalog.
SOURCES = (
    {'id': 'naver-d2', 'publisher': 'NAVER D2', 'name': 'NAVER D2', 'url': 'https://d2.naver.com/home',
     'feedUrl': 'https://d2.naver.com/d2.atom', 'allowedHosts': ['d2.naver.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://d2.naver.com/home'}},
    {'id': 'seoul-culture', 'publisher': '서울시', 'name': '서울시 문화', 'url': 'https://news.seoul.go.kr/culture',
     'feedUrl': 'https://news.seoul.go.kr/culture/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/culture'}},
    {'id': 'woowahan-tech', 'publisher': '우아한형제들', 'name': '우아한형제들 기술블로그', 'url': 'https://techblog.woowahan.com/',
     'feedUrl': 'https://techblog.woowahan.com/feed/', 'allowedHosts': ['techblog.woowahan.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://techblog.woowahan.com/'}},
    {'id': 'readersnews-books', 'publisher': '독서신문', 'name': '독서신문', 'url': 'https://www.readersnews.com/',
     'feedUrl': 'https://www.readersnews.com/rss/allArticle.xml', 'allowedHosts': ['www.readersnews.com'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '공식 RSS 제목·링크 이용 범위 · 본문 미확보', 'url': 'https://www.readersnews.com/rssIndex.html'}},
    {'id': 'seoul-environment', 'publisher': '서울시', 'name': '서울시 환경', 'url': 'https://news.seoul.go.kr/env',
     'feedUrl': 'https://news.seoul.go.kr/env/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/env'}},
    {'id': 'arxiv-cs-cl', 'publisher': 'arXiv', 'name': 'arXiv cs.CL · 영문 사전공개 논문', 'url': 'https://arxiv.org/',
     'feedUrl': 'https://rss.arxiv.org/rss/cs.CL', 'allowedHosts': ['arxiv.org', 'rss.arxiv.org'],
     'language': 'en', 'requestIntervalSeconds': 3, 'rights': {'mode': 'metadata_only',
     'label': '메타데이터 CC0 · 영문 사전공개 논문 · 날짜는 RSS 공지일 · 원문별 권리 유지 · 초록·본문 미제공', 'url': 'https://info.arxiv.org/help/api/tou.html'}},
    {'id': 'mit-linguistics', 'publisher': 'MIT News', 'name': 'MIT News · 언어학 · 영문', 'url': 'https://news.mit.edu/topic/linguistics',
     'feedUrl': 'https://news.mit.edu/topic/mitlinguistics-rss.xml', 'allowedHosts': ['news.mit.edu'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': 'MIT News 공식 RSS · 영문 제목·링크·작성자·분류만 · 본문 미제공', 'url': 'https://news.mit.edu/terms-of-use'},
     'images': {'hosts': ['news.mit.edu'], 'label': 'MIT News 이미지 CC BY-NC-ND · 출처 표시 · MIT 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://news.mit.edu/terms-of-use'}},
    {'id': 'llt-journal', 'publisher': 'Language Learning & Technology', 'name': 'Language Learning & Technology', 'url': 'https://www.lltjournal.org/',
     'feedUrl': 'https://www.lltjournal.org/feedlet/', 'allowedHosts': ['www.lltjournal.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '공식 RSS · 언어교육 동료심사 연구 · 제목·링크만 보관 · 2020년 이후 원문 CC BY-NC-ND 4.0(출처표시·비상업·원형유지)',
     'url': 'https://www.lltjournal.org/about/'}},
    {'id': 'frontiers-psychology', 'publisher': 'Frontiers', 'name': 'Frontiers in Psychology · 영문 심리학 연구',
     'url': 'https://www.frontiersin.org/journals/psychology',
     'feedUrl': 'https://www.frontiersin.org/journals/psychology/rss', 'allowedHosts': ['www.frontiersin.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '공식 RSS · 원문 CC-BY(출처표시·변경명시) · 제목·링크·첫 작성자·발행일만 · 초록·본문·이미지 미제공',
     'url': 'https://www.frontiersin.org/journals/psychology/about#copyright-statement'}},
    # --- Added 2026-11-11 (docs/design-review/discovery-sources.md). Published in `extended`. ---
    {'id': 'yna-news', 'publisher': '연합뉴스', 'name': '연합뉴스', 'url': 'https://www.yna.co.kr/',
     'feedUrl': 'https://www.yna.co.kr/rss/news.xml', 'allowedHosts': ['www.yna.co.kr'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '연합뉴스 RSS · 비상업·개인 용도 허용 범위 · 제목과 링크 정보만 제공', 'url': 'https://www.yna.co.kr/rss/index'},
     'images': {'hosts': ['img.yna.co.kr'], 'label': '연합뉴스 RSS의 대표 이미지 주소 · 연합뉴스 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://www.yna.co.kr/rss/index'}},
    {'id': 'yna-culture', 'publisher': '연합뉴스', 'name': '연합뉴스 문화', 'url': 'https://www.yna.co.kr/culture/all',
     'feedUrl': 'https://www.yna.co.kr/rss/culture.xml', 'allowedHosts': ['www.yna.co.kr'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '연합뉴스 RSS · 비상업·개인 용도 허용 범위 · 제목과 링크 정보만 제공', 'url': 'https://www.yna.co.kr/rss/index'},
     'images': {'hosts': ['img.yna.co.kr'], 'label': '연합뉴스 RSS의 대표 이미지 주소 · 연합뉴스 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://www.yna.co.kr/rss/index'}},
    {'id': 'yna-international', 'publisher': '연합뉴스', 'name': '연합뉴스 세계', 'url': 'https://www.yna.co.kr/international/all',
     'feedUrl': 'https://www.yna.co.kr/rss/international.xml', 'allowedHosts': ['www.yna.co.kr'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '연합뉴스 RSS · 비상업·개인 용도 허용 범위 · 제목과 링크 정보만 제공', 'url': 'https://www.yna.co.kr/rss/index'},
     'images': {'hosts': ['img.yna.co.kr'], 'label': '연합뉴스 RSS의 대표 이미지 주소 · 연합뉴스 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://www.yna.co.kr/rss/index'}},
    {'id': 'sbs-news', 'publisher': 'SBS', 'name': 'SBS 뉴스', 'url': 'https://news.sbs.co.kr/',
     'feedUrl': 'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER', 'allowedHosts': ['news.sbs.co.kr'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': 'SBS 뉴스 RSS · 개인 이용자의 비상업적 사용 허가 범위 · 제목과 링크 정보만 제공', 'url': 'https://news.sbs.co.kr/news/rss.do'},
     'images': {'hosts': ['img.sbs.co.kr'], 'label': 'SBS 뉴스 RSS의 대표 이미지 주소 · SBS 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://news.sbs.co.kr/news/rss.do'}},
    {'id': 'sbs-culture', 'publisher': 'SBS', 'name': 'SBS 뉴스 생활·문화', 'url': 'https://news.sbs.co.kr/news/newsSection.do?sectionType=07',
     'feedUrl': 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=07&plink=RSSREADER', 'allowedHosts': ['news.sbs.co.kr'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': 'SBS 뉴스 RSS · 개인 이용자의 비상업적 사용 허가 범위 · 제목과 링크 정보만 제공', 'url': 'https://news.sbs.co.kr/news/rss.do'},
     'images': {'hosts': ['img.sbs.co.kr'], 'label': 'SBS 뉴스 RSS의 대표 이미지 주소 · SBS 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://news.sbs.co.kr/news/rss.do'}},
    {'id': 'nocut-news', 'publisher': '노컷뉴스', 'name': '노컷뉴스', 'url': 'https://www.nocutnews.co.kr/',
     'feedUrl': 'https://rss.nocutnews.co.kr/nocutnews.xml', 'allowedHosts': ['www.nocutnews.co.kr', 'rss.nocutnews.co.kr'],
     'language': 'ko', 'gmtLabelIsKoreanTime': True, 'rights': {'mode': 'metadata_only',
     'label': '노컷뉴스 RSS · 개인 이용자의 비상업적 사용 허용 범위 · 제목과 링크 정보만 제공', 'url': 'https://www.nocutnews.co.kr/rss/'}},
    {'id': 'seoul-economy', 'publisher': '서울시', 'name': '서울시 경제', 'url': 'https://news.seoul.go.kr/economy',
     'feedUrl': 'https://news.seoul.go.kr/economy/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/economy'}},
    {'id': 'seoul-welfare', 'publisher': '서울시', 'name': '서울시 복지', 'url': 'https://news.seoul.go.kr/welfare',
     'feedUrl': 'https://news.seoul.go.kr/welfare/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/welfare'}},
    {'id': 'seoul-traffic', 'publisher': '서울시', 'name': '서울시 교통', 'url': 'https://news.seoul.go.kr/traffic',
     'feedUrl': 'https://news.seoul.go.kr/traffic/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/traffic'}},
    {'id': 'seoul-safe', 'publisher': '서울시', 'name': '서울시 안전', 'url': 'https://news.seoul.go.kr/safe',
     'feedUrl': 'https://news.seoul.go.kr/safe/feed', 'allowedHosts': ['news.seoul.go.kr'],
     'language': 'ko', 'timezone': '+09:00', 'rights': {'mode': 'metadata_only',
     'label': '원문별 이용 조건 확인 · 제목과 링크 정보만 제공', 'url': 'https://news.seoul.go.kr/safe'}},
    {'id': 'kakao-tech', 'publisher': '카카오', 'name': '카카오 기술블로그', 'url': 'https://tech.kakao.com/',
     'feedUrl': 'https://tech.kakao.com/feed/', 'allowedHosts': ['tech.kakao.com'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://tech.kakao.com/'}},
    {'id': 'toss-tech', 'publisher': '토스', 'name': '토스 기술블로그', 'url': 'https://toss.tech/',
     'feedUrl': 'https://toss.tech/rss.xml', 'allowedHosts': ['toss.tech'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://toss.tech/'}},
    {'id': 'line-tech', 'publisher': 'LY Corporation', 'name': 'LY Corporation 기술블로그', 'url': 'https://techblog.lycorp.co.jp/ko',
     'feedUrl': 'https://techblog.lycorp.co.jp/ko/feed/index.xml', 'allowedHosts': ['techblog.lycorp.co.jp'],
     'language': 'ko', 'rights': {'mode': 'metadata_only',
     'label': '원문 권리 유지 · 제목과 링크 정보만 제공', 'url': 'https://techblog.lycorp.co.jp/ko'}},
    {'id': 'conversation-global', 'publisher': 'The Conversation', 'name': 'The Conversation · 영문', 'url': 'https://theconversation.com/global',
     'feedUrl': 'https://theconversation.com/global/articles.atom', 'allowedHosts': ['theconversation.com'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '원문 CC BY-ND · 영문 제목·링크·작성자만 · 본문 미제공', 'url': 'https://theconversation.com/global/republishing-guidelines'}},
    {'id': 'nasa-news', 'publisher': 'NASA', 'name': 'NASA · 영문', 'url': 'https://www.nasa.gov/news/',
     'feedUrl': 'https://www.nasa.gov/feed/', 'allowedHosts': ['www.nasa.gov', 'science.nasa.gov'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': 'NASA 공개 자료(미국 내 저작권 대상 아님, 표장 제외) · 영문 제목·링크만 · 본문 미제공',
     'url': 'https://www.nasa.gov/nasa-brand-center/images-and-media/'}},
    {'id': 'mit-news', 'publisher': 'MIT News', 'name': 'MIT News · 영문', 'url': 'https://news.mit.edu/',
     'feedUrl': 'https://news.mit.edu/rss/feed', 'allowedHosts': ['news.mit.edu'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': 'MIT News 공식 RSS · 영문 제목·링크·작성자·분류만 · 본문 미제공', 'url': 'https://news.mit.edu/terms-of-use'},
     'images': {'hosts': ['news.mit.edu'], 'label': 'MIT News 이미지 CC BY-NC-ND · 출처 표시 · MIT 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://news.mit.edu/terms-of-use'}},
    {'id': 'owid', 'publisher': 'Our World in Data', 'name': 'Our World in Data · 영문', 'url': 'https://ourworldindata.org/',
     'feedUrl': 'https://ourworldindata.org/atom.xml', 'allowedHosts': ['ourworldindata.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '원문 CC BY · 영문 제목·링크·작성자만 · 본문 미제공', 'url': 'https://ourworldindata.org/faqs'}},
    {'id': 'global-voices', 'publisher': 'Global Voices', 'name': 'Global Voices · 영문', 'url': 'https://globalvoices.org/',
     'feedUrl': 'https://globalvoices.org/feed/', 'allowedHosts': ['globalvoices.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '원문 CC BY · 영문 제목·링크·작성자·분류만 · 본문 미제공', 'url': 'https://globalvoices.org/about/global-voices-attribution-policy/'},
     'images': {'hosts': ['globalvoices.org'], 'label': 'Global Voices RSS의 대표 이미지 주소 · 이미지별 권리는 원문 확인 · Global Voices 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://globalvoices.org/about/global-voices-attribution-policy/'}},
    {'id': 'eff-updates', 'publisher': 'EFF', 'name': 'EFF · 영문', 'url': 'https://www.eff.org/updates',
     'feedUrl': 'https://www.eff.org/rss/updates.xml', 'allowedHosts': ['www.eff.org'],
     'language': 'en', 'rights': {'mode': 'metadata_only',
     'label': '원문 CC BY 4.0 · 영문 제목·링크·작성자·분류만 · 본문 미제공', 'url': 'https://www.eff.org/copyright'},
     'images': {'hosts': ['www.eff.org'], 'label': 'EFF RSS의 대표 이미지 주소 · EFF 원작 CC BY 4.0, 그 밖의 이미지는 원문 확인 · EFF 서버에서 직접 표시하며 보관하지 않음',
                'url': 'https://www.eff.org/copyright'}},
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
        if source.get('gmtLabelIsKoreanTime') and value.endswith(' GMT') and date.tzinfo is not None:
            # This feed writes Korean local time under a GMT label (see parse_feed). Only the literal
            # ' GMT' spelling is read as +09:00; an explicit offset such as +0900 or +0000 is read as written.
            date = date.replace(tzinfo=timezone(timedelta(hours=9)))
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

    def __init__(self, hosts):
        super().__init__()
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            approved_url(newurl, self.hosts)
        except FeedError as cause:
            raise FeedError('허용되지 않은 피드 이동 (HTTPS·등록 호스트만 허용)') from cause
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url, source, limit, timeout=20, *, pacer=None):
    url = approved_url(url, source['allowedHosts'])
    pacer = pacer if pacer is not None else source_pacer(source)
    handlers = [RestrictedRedirect(source['allowedHosts'])]
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


def approved_image_url(value, hosts):
    """A publisher image address kept as a link: HTTPS, default port, registered DNS host, no credentials."""
    if not isinstance(value, str) or not value or len(value) > MAX_IMAGE_URL or re.search(r'[^\x21-\x7e]|\\', value):
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme.lower() != 'https' or parsed.username is not None or parsed.password is not None or parsed.port is not None:
            return None
        host = (parsed.hostname or '').lower()
    except ValueError:
        return None
    if not re.fullmatch(r'(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', host) or host not in hosts:
        return None
    return value


def entry_image(entry, source, atom):
    """The representative image the feed itself names for this entry, or None. Never read from the body."""
    config = source.get('images')
    if not config:
        return None
    candidates = []
    for element in entry.iter(f'{{{MRSS}}}content'):
        medium, kind, address = element.get('medium', ''), element.get('type', ''), element.get('url', '')
        if medium == 'image' or kind.startswith('image/') or (not medium and not kind and re.search(r'\.(?:jpe?g|png|webp|gif)(?:\?|$)', address, re.I)):
            candidates.append(address)
    candidates += [element.get('url', '') for element in entry.iter(f'{{{MRSS}}}thumbnail')]
    if atom:
        candidates += [element.get('href', '') for element in entry.findall(f'{{{ATOM}}}link')
                       if element.get('rel') == 'enclosure' and element.get('type', '').startswith('image/')]
    else:
        candidates += [element.get('url', '') for element in entry.findall('enclosure') if element.get('type', '').startswith('image/')]
    for address in candidates:
        approved = approved_image_url(address.strip(), config['hosts'])
        if approved:
            return approved
    return None


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


def parse_feed(body, source, now, limit=20):
    if source['rights']['mode'] != 'metadata_only':
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
    # A feed registered with `gmtLabelIsKoreanTime` (노컷뉴스 only) writes Korean local time and labels it GMT:
    # on 2026-11-11 its newest items read 7 to 9 hours ahead of the clock on two fetches (12:20Z and 15:01Z), the
    # +9 h offset less the age of the newest item. Its ' GMT' times are always read as +09:00 (parse_date). Whether
    # the run happens to hold a future item no longer decides it: a quiet hour or one scheduled item gave the
    # wrong reading either way. An item that is still ahead after the correction is a scheduled item and gets
    # the usual 'future' status, like every source. Other sources' GMT labels are read as written.
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
            image = entry_image(entry, source, atom)
            if image:
                article['imageUrl'] = image
            prior = articles.get(canonical)
            if prior is None or article_date(article) > article_date(prior):
                articles[canonical] = article
        except (FeedError, ValueError, TypeError):
            rejected += 1
    ordered = sorted(articles.values(), key=lambda item: (article_date(item), item['canonicalUrl']), reverse=True)
    if not ordered:
        raise FeedError('허용되는 글 항목이 없는 피드')
    # The same image on several entries of one feed is a logo or placeholder, not that article's image.
    seen = {}
    for item in ordered:
        if 'imageUrl' in item:
            seen[item['imageUrl']] = seen.get(item['imageUrl'], 0) + 1
    for item in ordered:
        if seen.get(item.get('imageUrl'), 0) > 1:
            del item['imageUrl']
    return ordered[:limit], {'feedEntries': len(entries), 'acceptedEntries': len(ordered), 'rejectedEntries': rejected}


def previous_parts(previous):
    """Sources and articles of a prior catalog: the first registry's part and `extended` read as one."""
    extended = previous.get('extended') if isinstance(previous.get('extended'), dict) else {}
    return (list(previous.get('sources', [])) + list(extended.get('sources', []) if isinstance(extended.get('sources'), list) else []),
            list(previous.get('articles', [])) + list(extended.get('articles', []) if isinstance(extended.get('articles'), list) else []))


# The form of a plain() result: words separated by single spaces, no controls or bidi overrides. Its last
# character can be a space when plain() cut the text at its limit right after one (an arXiv author list
# cut at 120 characters on 2026-11-12). plain() is not idempotent on its own output: a second pass trims
# that space and reads `&`/`<` text as markup again, so a failed source's retained text never goes through it twice.
PLAIN_FORM = re.compile(r'[^\s\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+(?: [^\s\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+)* ?')


def retained_text(value, limit):
    """Last-good text kept byte for byte when it already has plain()'s output form; anything else is cleaned."""
    if isinstance(value, str) and len(value) <= limit and PLAIN_FORM.fullmatch(value):
        return value
    return plain(value, limit)


def retained_author(value):
    """Last-good author kept exactly when author_name() could have produced it; anything else is cleaned."""
    if isinstance(value, str) and len(value) <= 120 and '@' not in value and PLAIN_FORM.fullmatch(value):
        return value
    return author_name(value)


def previous_articles(previous, source):
    """Retain only known public metadata from the last catalog, never unknown body fields.

    A failed source's last-good metadata stays exactly as last published (the deployment checks every
    field). Text is cleaned again only when it is not in the form the collector itself writes.
    """
    kept = []
    for item in previous_parts(previous)[1]:
        if not isinstance(item, dict) or item.get('sourceId') != source['id']:
            continue
        try:
            url = approved_url(item['url'], source['allowedHosts'])
            canonical = approved_url(url, source['allowedHosts'], canonical=True)
            title = retained_text(item.get('title'), 400)
            if not title:
                continue
            safe = {key:copy.deepcopy(item[key]) for key in ('publishedAt','dateStatus','updatedAt','updatedDateStatus','dateBasis','author','language','fetchedAt') if key in item}
            safe.update({'id':'article-'+source['id']+'-'+hashlib.sha256(canonical.encode()).hexdigest()[:20],
                         'sourceId':source['id'],'url':url,'canonicalUrl':canonical,'title':title,
                         'tags':list(dict.fromkeys(retained_text(tag,80) for tag in item.get('tags',[]) if isinstance(tag,str)))[:20],
                         'summary':'','coverage':'link_only','rights':copy.deepcopy(source['rights'])})
            safe['author'] = retained_author(safe.get('author'))
            safe['language'] = source['language']
            if source['id'] == 'frontiers-psychology':
                safe['tags'] = []
            image = approved_image_url(item.get('imageUrl'), source['images']['hosts']) if source.get('images') else None
            if image:
                safe['imageUrl'] = image
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
    old = next((item for item in previous_parts(previous)[0] if isinstance(item, dict) and item.get('id') == source['id']), {})
    public = {key:copy.deepcopy(source[key]) for key in ('id','name','url','feedUrl','language','rights')}
    if source.get('images'):
        public['images'] = {'label': source['images']['label'], 'url': source['images']['url']}
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
                       'entryCount':len(articles),'latestArticleAt':max((article_date(a) for a in articles),default=None) or None})
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
    # Feeds on one host are read one after another; different hosts stay parallel.
    groups = {}
    for index, source in enumerate(SOURCES):
        groups.setdefault(urllib.parse.urlsplit(source['feedUrl']).hostname, []).append(index)
    results = [None] * len(SOURCES)

    def run(indexes):
        rows = []
        for position, index in enumerate(indexes):
            if position and fetcher is fetch_public:
                time.sleep(SAME_HOST_INTERVAL_SECONDS)
            rows.append((index, refresh_one(SOURCES[index], previous, now, fetcher)))
        return rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, len(groups))) as executor:
        for future in [executor.submit(run, indexes) for indexes in groups.values()]:
            for index, row in future.result():
                results[index] = row
    legacy = [row for row in results if row[0]['id'] in LEGACY_SOURCE_IDS]
    later = [row for row in results if row[0]['id'] not in LEGACY_SOURCE_IDS]
    catalog = {'schemaVersion':1,'generatedAt':iso(now),'sources':[row[0] for row in legacy],
               'articles':[article for row in legacy for article in row[1]],
               'extended':{'sources':[row[0] for row in later],'articles':[article for row in later for article in row[1]]}}
    total = sum(len(row[1]) for row in results)
    report = {'generatedAt':iso(now),'sourceCount':len(results),'okSources':sum(row[0]['status']=='ok' for row in results),
              'articleCount':total,'coverageCounts':{'link_only':total,'summary':0,'full_text':0},
              'imageCount':sum('imageUrl' in article for row in results for article in row[1]),
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
    try:
        generated = previous.get('generatedAt')
        if not isinstance(generated, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', generated):
            raise ValueError('invalid timestamp')
        datetime.fromisoformat(generated.replace('Z', '+00:00'))
    except ValueError as cause:
        raise FeedError('기존 카탈로그 시각 형식 오류: 파일 보존') from cause
    extended = previous.get('extended')
    if extended is not None and (not isinstance(extended, dict) or not isinstance(extended.get('sources'), list) or not isinstance(extended.get('articles'), list)):
        raise FeedError('기존 카탈로그 형식 오류: 파일 보존')
    source_ids = set()
    for source in previous_parts(previous)[0]:
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
                          'generatedAt':catalog['generatedAt'],'articleCount':report['articleCount'],
                          'sources':[{'id':s['id'],'status':s['status'],'entryCount':s['entryCount'],'stale':s['stale'],'error':s['error']} for s in previous_parts(catalog)[0]]},ensure_ascii=False))
        return 0 if report['okSources']==len(SOURCES) else 2
    except (FeedError, ValueError, OSError, json.JSONDecodeError) as cause:
        print(error_label(cause),file=sys.stderr)
        return 1


if __name__=='__main__':
    raise SystemExit(main())
