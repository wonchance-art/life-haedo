-- 해도 사진 글 서식 사용 개수 (읽기 전용, 총괄 세션 또는 Supabase SQL Editor에서 실행)
-- 목적: 글 저장 형식을 Markdown으로 바꿀지 정하기 전에, 표준 Markdown이 잃는 서식(밑줄·정렬·빈 문단 등)을
--       실제로 몇 개의 글이 쓰는지 센다. 근거: docs/design-review/write-read-redesign.md 「저장 형식 실험」.
-- 아무것도 바꾸지 않는다(read only 트랜잭션 + rollback). 글 제목·본문·사진 설명·ID는 출력하지 않고 개수만 보여 준다.
-- 2026-11-02 격리 PostgreSQL 16에서 합성 글 29개·공개 사본 3건으로 Node 계산 값과 0건 차이, read only의 DELETE 거부를 확인했다.
begin transaction isolation level repeatable read read only;

with docs as (
  select 'posts' as src, data as d from haedo_blog_private.posts
  union all
  select 'publications_active', snapshot from haedo_blog_private.publications where active
),
numbered as materialized (
  select src, d, row_number() over () as doc from docs
),
ops as (
  select x.src, x.doc, o.v
  from numbered x
  cross join lateral jsonb_array_elements(x.d->'ops') o(v)
),
per_doc as (
  select src, doc,
    bool_or(v->'attributes' ? 'underline')                                                        as underline,
    bool_or(jsonb_typeof(v->'insert') = 'string' and v->'attributes'->>'align' = 'center')        as align_center,
    bool_or(jsonb_typeof(v->'insert') = 'string' and v->'attributes'->>'align' in ('right','justify')) as align_right_justify,
    bool_or(jsonb_typeof(v->'insert') = 'object' and v->'attributes' ? 'align')                   as photo_align,
    bool_or(v->'attributes'->'header' = '1'::jsonb)                                               as header1,
    bool_or(v->'attributes'->'header' = '2'::jsonb)                                               as header2,
    bool_or(v->'attributes' ? 'blockquote' and v->'attributes' ? 'header')                        as header_and_quote,
    bool_or(jsonb_typeof(v->'insert') = 'object' and coalesce(v->'insert'->'photo'->>'alt', '') = '')     as photo_empty_alt,
    bool_or(jsonb_typeof(v->'insert') = 'object' and coalesce(v->'insert'->'photo'->>'caption', '') = '') as photo_empty_caption,
    bool_or(jsonb_typeof(v->'insert') = 'object' and (v->'insert'->'photo'->>'caption') ~ '[\r\n]')       as caption_newline,
    bool_or(jsonb_typeof(v->'insert') = 'string' and (v->>'insert') ~ '\r')                       as text_cr,
    bool_or(jsonb_typeof(v->'insert') = 'string' and v->'attributes' ?| array['bold','italic']
            and (v->>'insert') ~ '(^[[:space:]]|[[:space:]]$)')                                   as emphasis_edge_space,
    bool_or(jsonb_typeof(v->'insert') = 'string' and v->'attributes' ? 'link')                    as has_link
  from ops group by src, doc
),
stream as (
  -- 본문 흐름: 사진은 U+FFFC 한 글자, CRLF/CR은 Quill처럼 LF로 본다. 결과는 아래 정규식 판정에만 쓰고 반환하지 않는다.
  select x.src, x.doc,
    regexp_replace(string_agg(case when jsonb_typeof(o.v->'insert') = 'string' then o.v->>'insert' else chr(65532) end, '' order by o.n),
                   E'\r\n?', E'\n', 'g') as s
  from numbered x
  cross join lateral jsonb_array_elements(x.d->'ops') with ordinality o(v, n)
  group by x.src, x.doc
),
flags as (
  select p.*,
    -- 빈 줄(빈 문단): 줄 시작/사진 뒤의 줄바꿈. 문서 끝 사진 뒤 마지막 줄바꿈(Quill 필수 줄)은 제외.
    (st.s ~ (E'(^|\n|' || chr(65532) || E')\n.') or st.s ~ (E'[^\n' || chr(65532) || E']\n\n$'))     as empty_paragraph,
    (st.s ~ E'(^|\n)([#>+-]|[0-9]{1,9}[.)]|[ \t]|[*_`~|=<\\[])')                                    as md_special_line_start
  from per_doc p join stream st using (src, doc)
)
select src,
  count(*)                                         as docs,
  count(*) filter (where underline)                as underline,
  count(*) filter (where align_center)             as align_center,
  count(*) filter (where align_right_justify)      as align_right_justify,
  count(*) filter (where photo_align)              as photo_align,
  count(*) filter (where header1)                  as header1,
  count(*) filter (where header2)                  as header2,
  count(*) filter (where header_and_quote)         as header_and_quote,
  count(*) filter (where photo_empty_alt)          as photo_empty_alt,
  count(*) filter (where photo_empty_caption)      as photo_empty_caption,
  count(*) filter (where caption_newline)          as caption_newline,
  count(*) filter (where text_cr)                  as text_cr,
  count(*) filter (where emphasis_edge_space)      as emphasis_edge_space,
  count(*) filter (where has_link)                 as has_link,
  count(*) filter (where empty_paragraph)          as empty_paragraph,
  count(*) filter (where md_special_line_start)    as md_special_line_start,
  count(*) filter (where not (coalesce(underline, false) or coalesce(align_center, false) or coalesce(align_right_justify, false)
                              or coalesce(photo_align, false) or empty_paragraph)) as no_underline_align_empty
from flags
group by src
order by src;

rollback;
