"""Bounded, publisher-specific public article extraction; never returns HTML.

Frontiers' official JATS XML supplies article text and per-article permissions.
No arbitrary page scraper or browser-side remote content is involved.
"""
from __future__ import annotations

import re
import base64
import binascii
import urllib.parse
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

XLINK = '{http://www.w3.org/1999/xlink}href'
CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/'
MAX_XML_BYTES = 2 * 1024 * 1024
MAX_BODY_CHARS = 200000
MAX_SUMMARY_CHARS = 50000
MAX_IMAGES = 2
MAX_IMAGE_BYTES = 256 * 1024
MAX_IMAGE_SIDE = 4096
MAX_IMAGE_PIXELS = 16 * 1024 * 1024
FRONTIERS_PATH = re.compile(r'^/journals/psychology/articles/(10\.3389/fpsyg\.\d{4}\.([0-9]+))/(?:full|xml)$')
FRONTIERS_RSS_PATH = re.compile(r'^/articles/(10\.3389/fpsyg\.\d{4}\.([0-9]+))(?:/(?:full|xml))?$')
BLOCKED = {'script', 'style', 'iframe', 'object', 'embed', 'template', 'sub-article', 'response'}


class ArticleContentError(ValueError):
    pass


def clean(value):
    """Keep visible text, without C0/bidi controls or source HTML attributes."""
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]', '', value or '')
    return re.sub(r'\s+', ' ', value).strip()


def tag_name(node):
    return str(node.tag).rsplit('}', 1)[-1]


def text_of(node):
    if node is None or tag_name(node) in BLOCKED:
        return ''
    parts = [node.text or '']
    for child in node:
        if tag_name(child) not in BLOCKED:
            parts.append(text_of(child))
        parts.append(child.tail or '')
    if tag_name(node) in ('ref', 'name', 'string-name', 'person-group', 'element-citation', 'mixed-citation'):
        return ' '.join(clean(part) for part in parts if clean(part))
    return ''.join(parts)


def paragraphs(node):
    """Preserve scholarly paragraph, section, list and table reading order."""
    if node is None or tag_name(node) in BLOCKED:
        return []
    kind = tag_name(node)
    if kind == 'fig':
        # Retain the caption even if the corresponding image cannot be fetched.
        value = clean(text_of(node.find('label')) + ' ' + text_of(node.find('caption')))
        return [value] if value else []
    if kind == 'table':
        return table_rows(node)
    if kind in ('p', 'title', 'label', 'disp-quote', 'list-item', 'ref', 'ack', 'fn'):
        value = clean(text_of(node))
        return [value] if value else []
    if kind == 'tr':
        value = ' | '.join(clean(text_of(cell)) for cell in node if tag_name(cell) in ('th', 'td'))
        return [value] if value.strip(' |') else []
    if kind == 'disp-formula':
        # Prefer the publisher's exact TeX transcription to flattened MathML.
        tex = node.find('.//tex-math')
        value = clean(text_of(tex if tex is not None else node))
        return [value] if value else []
    result = []
    if node.text and node.text.strip():
        result.append(clean(node.text))
    for child in node:
        result.extend(paragraphs(child))
        if child.tail and child.tail.strip():
            result.append(clean(child.tail))
    return result


def table_rows(table):
    """Expand publisher row/column spans into an ordered, delimited text grid."""
    rows = list(table.iter('tr'))
    if len(rows) > 200 or table.find('.//table') is not None:
        raise ArticleContentError('표 구조를 정확히 표시할 수 없음')
    cells = {}
    width = 0
    for row_index, row in enumerate(rows):
        column = 0
        for cell in row:
            if tag_name(cell) not in ('th', 'td'):
                continue
            while (row_index, column) in cells:
                column += 1
            try:
                rowspan, colspan = int(cell.get('rowspan', '1')), int(cell.get('colspan', '1'))
            except ValueError as cause:
                raise ArticleContentError('표 병합 정보 오류') from cause
            if not 1 <= rowspan <= 200 or not 1 <= colspan <= 40 or column + colspan > 40 or row_index + rowspan > len(rows):
                raise ArticleContentError('표 병합 범위 오류')
            for row_offset in range(rowspan):
                for col_offset in range(colspan):
                    address = (row_index + row_offset, column + col_offset)
                    if address in cells:
                        raise ArticleContentError('표 병합 충돌')
                    cells[address] = clean(text_of(cell)) if row_offset == col_offset == 0 else ''
            column += colspan
            width = max(width, column)
    return [' | '.join(cells.get((r, c), '') for c in range(width)) for r in range(len(rows))]


def frontiers_xml_url(url):
    parsed = urllib.parse.urlsplit(url)
    match = FRONTIERS_PATH.fullmatch(parsed.path) or FRONTIERS_RSS_PATH.fullmatch(parsed.path)
    if (parsed.scheme != 'https' or parsed.netloc != 'www.frontiersin.org'
            or parsed.query or parsed.fragment or not match):
        raise ArticleContentError('검토되지 않은 Frontiers 본문 주소')
    return urllib.parse.urlunsplit(('https', parsed.netloc, '/journals/psychology/articles/' + match.group(1) + '/xml', '', ''))


def parse_frontiers_xml(data, url):
    """Read only a matching Frontiers Psychology article with explicit CC BY 4.0.

    Oversized text is not silently truncated into `full_text`. A valid abstract
    can still be returned separately if the complete body exceeds its limit.
    """
    xml_url = frontiers_xml_url(url)
    path_match = FRONTIERS_PATH.fullmatch(urllib.parse.urlsplit(xml_url).path)
    doi, article_number = path_match.group(1), path_match.group(2)
    if len(data) > MAX_XML_BYTES:
        raise ArticleContentError('본문 XML 크기 제한 초과')
    try:
        decoded = data.decode('utf-8-sig')
    except UnicodeDecodeError as cause:
        raise ArticleContentError('지원하지 않는 본문 문자 인코딩') from cause
    if '\x00' in decoded:
        raise ArticleContentError('지원하지 않는 본문 문자 인코딩')
    markup = re.sub(r'<!\[CDATA\[.*?\]\]>|<!--.*?-->', '', decoded, flags=re.S)
    # Frontiers' reviewed XML declares this external JATS DTD. Remove that exact
    # declaration; never fetch a DTD or accept an internal entity/subset.
    reviewed_doctype = '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD v1.3 20210610//EN" "JATS-journalpublishing1-3-mathml3.dtd">'
    markup = markup.replace(reviewed_doctype, '')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', markup, re.I):
        raise ArticleContentError('DTD 또는 entity 선언 본문 거절')
    try:
        root = ET.fromstring(decoded.replace(reviewed_doctype, ''))
    except ET.ParseError as cause:
        raise ArticleContentError('본문 XML을 읽을 수 없음') from cause
    if root.tag != 'article':
        raise ArticleContentError('지원하지 않는 본문 XML 형식')
    meta = root.find('./front/article-meta')
    if meta is None:
        raise ArticleContentError('본문 출처 정보 없음')
    actual_doi = next((clean(text_of(node)) for node in meta.findall('article-id')
                       if node.get('pub-id-type') == 'doi'), '')
    if actual_doi != doi:
        raise ArticleContentError('요청한 글과 본문 DOI가 다름')
    license_node = meta.find('./permissions/license')
    license_urls = []
    if license_node is not None:
        for node in license_node.iter():
            license_urls += [node.get(XLINK, ''), node.get('href', '')]
            if tag_name(node) == 'license_ref':
                license_urls.append(clean(text_of(node)))
    if CC_BY_4 not in license_urls:
        raise ArticleContentError('개별 글의 CC BY 4.0 권한 미확인')
    authors = []
    for group in meta.findall('contrib-group'):
        for contributor in group.findall('contrib'):
            if contributor.get('contrib-type') != 'author':
                continue
            name = contributor.find('name')
            if name is not None:
                author = clean(text_of(name.find('given-names')) + ' ' + text_of(name.find('surname')))
            else:
                author = clean(text_of(contributor.find('collab')))
            if author:
                authors.append(author)
    attribution = ', '.join(dict.fromkeys(authors))
    if not attribution:
        raise ArticleContentError('본문 작성자 표시를 확인할 수 없음')
    if len(attribution) > 300:
        attribution = authors[0][:260] + ' et al.'
    summary = '\n\n'.join(paragraphs(meta.find('abstract')))
    body_node = root.find('body')
    main = paragraphs(body_node)
    # Include publisher-provided references/acknowledgements, while excluding
    # nested peer reviews, responses and other articles from the same XML.
    back = paragraphs(root.find('back'))
    body = '\n\n'.join(([summary] if summary else []) + main + back) if main else ''
    if len(summary) > MAX_SUMMARY_CHARS:
        summary = ''
    # Rendering a mathematical tree or merged table as flattened text can
    # change its meaning. Such articles keep the exact publisher abstract.
    unsupported = any(tag_name(node) in ('math', 'inline-formula', 'disp-formula')
                      for node in body_node.iter()) if body_node is not None else False
    if len(body) > MAX_BODY_CHARS or unsupported:
        body = ''
    if not body and not summary:
        raise ArticleContentError('표시할 수 있는 원문 본문/초록 없음')
    result = {
        'coverage': 'full_text' if body else 'summary', 'summary': summary,
        'rights': {'mode': 'full_text_allowed', 'url': CC_BY_4,
                   'label': 'CC BY 4.0 · ' + attribution + ' · Frontiers · 원문 XML의 본문·초록·참고문헌을 텍스트로 표시(서식 단순화)'},
    }
    if body:
        result['bodyText'] = body
    else:
        return result, []
    # The calling collector verifies and stores the actual image bytes. These
    # candidates are never passed directly to the browser as image sources.
    image_candidates = []
    for figure in body_node.iter('fig') if body_node is not None else []:
        # A separate credit/permission overrides the article's umbrella licence.
        # Unknown third-party exceptions therefore stay as a source link only.
        caption = clean(text_of(figure.find('caption')))
        if (any(tag_name(node) in ('permissions', 'attrib', 'credit', 'copyright-statement', 'copyright-holder', 'copyright-year') for node in figure.iter())
                or re.search(r'copyright|courtesy|reprinted|reproduced|permission|adapted|adaptation|credit|third.party|©', caption, re.I)):
            continue
        graphic = figure.find('graphic')
        filename = graphic.get(XLINK, '') if graphic is not None else ''
        match = re.fullmatch(r'(fpsyg-\d+-' + re.escape(article_number) + r'-g\d+)\.(?:tif|tiff|jpg|png|webp)', filename)
        if not match or not caption:
            continue
        label = clean(text_of(figure.find('label')))
        candidate = {
            'sourceUrl': 'https://www.frontiersin.org/files/Articles/' + article_number + '/xml-images/' + match.group(1) + '.webp',
            'alt': (((label + '. ') if label else '') + caption)[:1000],
            'caption': caption[:2000], 'credit': attribution + ' · Frontiers',
            'license': {'label': 'CC BY 4.0', 'url': CC_BY_4},
        }
        original_caption = clean(text_of(figure.find('label')) + ' ' + text_of(figure.find('caption')))
        body_paragraphs = body.split('\n\n') if body else []
        if original_caption and body_paragraphs.count(original_caption) == 1:
            candidate['afterParagraph'] = body_paragraphs.index(original_caption)
        image_candidates.append(candidate)
        if len(image_candidates) >= MAX_IMAGES:
            break
    return result, image_candidates


class AbstractText(HTMLParser):
    """RSS HTML becomes text only; active/hidden elements contribute nothing."""
    BLOCKED = BLOCKED | {'noscript', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select'}
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if self.stack:
            if tag not in self.VOID:
                self.stack.append(tag)
        elif tag in self.BLOCKED or 'hidden' in dict(attrs):
            if tag not in self.VOID:
                self.stack.append(tag)
        elif tag in ('p', 'div', 'br', 'li', 'h2', 'h3', 'h4', 'blockquote'):
            self.parts.append('\n\n')

    def handle_endtag(self, tag):
        if self.stack:
            if tag in self.stack:
                self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
        elif tag in ('p', 'div', 'li', 'h2', 'h3', 'h4', 'blockquote'):
            self.parts.append('\n\n')

    def handle_data(self, data):
        if not self.stack:
            self.parts.append(data)


def rss_abstract(value):
    if not isinstance(value, str) or len(value) > MAX_SUMMARY_CHARS * 4:
        return ''
    parser = AbstractText()
    parser.feed(value)
    parser.close()
    result = '\n\n'.join(filter(None, (clean(p) for p in ''.join(parser.parts).split('\n\n'))))
    return result if len(result) <= MAX_SUMMARY_CHARS else ''


def image_payload(data, content_type, candidate):
    """Require a bounded raster signature and matching declared MIME type."""
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ArticleContentError('이미지 크기 제한 초과')
    mime = content_type.split(';', 1)[0].strip().lower()
    detected = ('image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
                'image/jpeg' if data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9') else
                'image/webp' if len(data) >= 16 and data[:4] == b'RIFF' and data[8:12] == b'WEBP' else None)
    if detected is None or mime != detected:
        raise ArticleContentError('이미지 형식과 실제 바이트가 다름')
    if detected == 'image/webp' and int.from_bytes(data[4:8], 'little') + 8 != len(data):
        raise ArticleContentError('손상된 WebP 이미지')
    width, height = image_dimensions(data, detected)
    if not 0 < width <= MAX_IMAGE_SIDE or not 0 < height <= MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
        raise ArticleContentError('이미지 해상도 제한 초과')
    return {**candidate, 'mimeType': mime, 'dataBase64': base64.b64encode(data).decode('ascii')}


def image_dimensions(data, mime):
    if mime == 'image/png' and len(data) >= 33 and data[12:16] == b'IHDR':
        return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')
    if mime == 'image/webp':
        if len(data) >= 30 and data[12:16] == b'VP8X':
            return int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
        if len(data) >= 30 and data[12:16] == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a':
            return int.from_bytes(data[26:28], 'little') & 0x3fff, int.from_bytes(data[28:30], 'little') & 0x3fff
        if len(data) >= 25 and data[12:16] == b'VP8L' and data[20] == 0x2f:
            bits = int.from_bytes(data[21:25], 'little')
            return (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
    if mime == 'image/jpeg':
        cursor = 2
        while cursor + 4 <= len(data):
            if data[cursor] != 0xff:
                break
            while cursor < len(data) and data[cursor] == 0xff:
                cursor += 1
            if cursor >= len(data):
                break
            marker = data[cursor]
            cursor += 1
            if marker in (0x01, 0xd8) or 0xd0 <= marker <= 0xd7:
                continue
            if marker in (0xd9, 0xda):
                break
            length = int.from_bytes(data[cursor:cursor + 2], 'big')
            if length < 2 or cursor + length > len(data):
                break
            if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf) and length >= 7:
                return int.from_bytes(data[cursor + 5:cursor + 7], 'big'), int.from_bytes(data[cursor + 3:cursor + 5], 'big')
            cursor += length
    raise ArticleContentError('이미지 해상도를 확인할 수 없음')


def retained_image(image):
    if not isinstance(image, dict):
        raise ArticleContentError('이전 이미지 형식 오류')
    raw = image.get('dataBase64')
    if not isinstance(raw, str) or len(raw) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ArticleContentError('이전 이미지 크기 제한 초과')
    try:
        data = base64.b64decode(raw, validate=True)
    except (ValueError, binascii.Error) as cause:
        raise ArticleContentError('이전 이미지 인코딩 오류') from cause
    fields = {'sourceUrl': image.get('sourceUrl'), 'license': image.get('license')}
    if not isinstance(fields['sourceUrl'], str) or not re.fullmatch(r'https://www\.frontiersin\.org/files/Articles/\d+/xml-images/[a-zA-Z0-9-]+\.(?:png|jpg|webp)', fields['sourceUrl']):
        raise ArticleContentError('이전 이미지 출처 오류')
    if fields['license'] != {'label': 'CC BY 4.0', 'url': CC_BY_4}:
        raise ArticleContentError('이전 이미지 권한 오류')
    for key, limit in (('alt', 1000), ('caption', 2000), ('credit', 500)):
        value = image.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ArticleContentError('이전 이미지 표시 정보 오류')
        fields[key] = value
    position = image.get('afterParagraph')
    if isinstance(position, int) and not isinstance(position, bool) and 0 <= position < 10000:
        fields['afterParagraph'] = position
    return image_payload(data, image.get('mimeType', ''), fields)
