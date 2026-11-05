# B1 Markdown 설치 전 확인

작업자는 운영에서 실행하지 않는다. 총괄이 검수한 `20261105051632_life_post_markdown.sql`을 적용하기 전에 아래 읽기 전용 쿼리로 행 수와 JSON 크기를 확인한다. 결과에는 글 본문·사진·계정 식별자가 없고 합계만 나온다.

```sql
select 'posts' as relation, count(*) as rows,
       coalesce(sum(octet_length(to_jsonb(t)::text)), 0) as json_bytes
from haedo_blog_private.posts t
union all
select 'assets', count(*), coalesce(sum(octet_length(to_jsonb(t)::text)), 0)
from haedo_blog_private.assets t
union all
select 'receipts', count(*), coalesce(sum(octet_length(to_jsonb(t)::text)), 0)
from haedo_blog_private.receipts t
union all
select 'publications', count(*), coalesce(sum(octet_length(to_jsonb(t)::text)), 0)
from haedo_blog_private.publications t
union all
select 'profiles', count(*), coalesce(sum(octet_length(to_jsonb(t)::text)), 0)
from haedo_blog_private.profiles t;
```

마이그레이션의 행 보존 해시는 테이블별 JSON을 정렬해 `string_agg`로 합친다. 따라서 가장 큰 테이블의 `json_bytes`는 필요한 문자열 메모리의 하한이며 정렬과 중간 값의 여유가 더 필요하다. 운영 메모리 예산 안에서 실행 가능한지 확인하고, 감당하기 어려우면 적용을 멈추고 스트리밍 보존 검증 방식으로 별도 검수한다. 크기 쿼리도 전체 테이블을 읽으므로 총괄이 운영 부하를 고려해 실행한다.

기존 계정 동기화·AI 표시 설치 묶음은 생성기로 관리한다. 최신 생성 결과는 D2 전에는 알려진 원래 정의만 설치하고, D2 뒤에는 검토된 새 정의를 보존한다. 알 수 없는 함수 본문이나 일부만 남은 D2 설치는 변경 전에 거부한다. 수동으로 과거 함수 정의를 다시 붙여 넣지 않는다.

B1은 Markdown 공개를 거부한다. B3의 동일 codec Edge 투영을 검증·운영 반영한 뒤에만 B2 작성기를 병합한다. B1만으로 운영 Markdown 글을 생성하거나 기존 글을 변환하지 않는다.
