# SQL 최종 정의 위치

<!-- 생성: node scripts/sql-final-definitions.mjs — 직접 고치지 않는다. 마이그레이션을 바꾼 뒤 다시 생성한다. -->

`supabase/migrations/`의 모든 파일을 파일 이름 순서로 읽어, 뒤 마이그레이션이 다시 정의하는 함수·테이블을 모았다.
**최종** 열의 파일이 현재 정의를 담는다. 새 변경은 그 파일의 정의에서 출발한다. 이 문서는 목록만 보여 주며 마이그레이션을 고치지 않는다.

- 함수: `create [or replace] function`이 둘 이상의 파일에 있는 경우. 같은 파일 안의 반복은 한 번으로 센다.
- 테이블: 만든 파일보다 뒤 파일의 `alter table`이 열·제약을 바꾸는 경우. RLS 켜기·소유자 변경은 제외한다.
- 인자 목록이 바뀌어 오버로드가 남는지는 `npm run test:sql-replay`가 재생한 DB 카탈로그와 대조한다.

## 함수 (20개 재정의)

| 함수 | 정의한 파일 수 | 최종 | 이전 정의 |
| --- | ---: | --- | --- |
| `public.life_composition_valid(jsonb)` | 6 | `20261101140000_life_sync_edit_times`<br>이전 본문은 `public.life_composition_valid_content`로 이름을 바꿔 유지 | `20261006010000_life_compositions`, `20261008010000_life_composition_books`, `20261008020000_life_composition_insights`, `20261008030000_life_composition_editions`, `20261012010000_life_page_posts` |
| `haedo_blog_private.publish(uuid, bigint, uuid, text[], jsonb, bigint)` | 3 | `20261102110000_life_blog_ai_authorship` | `20261017144744_life_blog_originals`, `20261101091500_life_blog_account_sync` |
| `haedo_blog_private.valid_document(jsonb, uuid)` | 3 | `20261102110000_life_blog_ai_authorship` | `20261017144744_life_blog_originals`, `20261101091500_life_blog_account_sync` |
| `haedo_naver_private.inventory_claim(integer, uuid, uuid)` | 3 | `20261029112456_naver_observed_inventory_baseline` | `20261021113658_life_naver_captures`, `20261029040646_naver_inventory_automatic_rescan` |
| `haedo_naver_private.save(uuid, text, bigint, boolean)` | 3 | `20261102100000_naver_enable_schedules_first_inventory` | `20261021093111_life_naver_subscriptions`, `20261021094614_naver_conflict_http409` |
| `haedo_blog_private.delete_post(uuid, bigint)` | 2 | `20261101160000_life_blog_delete_guard` | `20261101091500_life_blog_account_sync` |
| `haedo_blog_private.list(uuid)` | 2 | `20261101091500_life_blog_account_sync` | `20261017144744_life_blog_originals` |
| `haedo_blog_private.prepare_asset(uuid, text, text, bigint, text, integer, integer)` | 2 | `20261101091500_life_blog_account_sync` | `20261017144744_life_blog_originals` |
| `haedo_blog_private.read(uuid)` | 2 | `20261101091500_life_blog_account_sync` | `20261017144744_life_blog_originals` |
| `haedo_blog_private.ready(uuid, uuid, jsonb)` | 2 | `20261101091500_life_blog_account_sync` | `20261017144744_life_blog_originals` |
| `haedo_blog_private.save(uuid, uuid, bigint, uuid, jsonb)` | 2 | `20261101091500_life_blog_account_sync` | `20261017144744_life_blog_originals` |
| `haedo_material_private.get(uuid)` | 2 | `20261101130000_life_material_tombstones` | `20261019005829_life_material_continuity` |
| `haedo_material_private.list(timestamp with time zone, uuid)` | 2 | `20261101130000_life_material_tombstones` | `20261019005829_life_material_continuity` |
| `haedo_material_private.put(uuid, uuid, bigint, jsonb)` | 2 | `20261022031304_life_material_edited_copy_markers` | `20261019005829_life_material_continuity` |
| `haedo_material_private.valid(jsonb)` | 2 | `20261022031304_life_material_edited_copy_markers` | `20261019005829_life_material_continuity` |
| `haedo_naver_private.inventory_finish(uuid, uuid, bigint, integer, jsonb, integer, integer, text)` | 2 | `20261029112456_naver_observed_inventory_baseline` | `20261021113658_life_naver_captures` |
| `public.life_account_document_put(text, bigint, uuid, jsonb, boolean, timestamp with time zone)` | 2 | `20261101150000_life_account_documents_owner_lock` | `20261101090000_life_account_documents` |
| `public.life_library_meta_valid(jsonb, uuid, jsonb)` | 2 | `20261101140000_life_sync_edit_times` | `20261023160149_account_library_default_and_metadata` |
| `public.life_library_original_put(uuid, uuid, jsonb)` | 2 | `20261023163156_account_library_original_owner_variable` | `20261023160149_account_library_default_and_metadata` |
| `public.life_public_page_valid(jsonb)` | 2 | `20261012010000_life_page_posts` | `20261005120000_life_public_pages` |

### 이름을 바꿔 남긴 함수

본문은 이름을 바꾸기 전 마지막 `create`에 있다.

| 함수 | 이전 이름 | 이름 바꾼 파일 | 본문 정의 |
| --- | --- | --- | --- |
| `public.life_composition_valid_content(jsonb)` | `public.life_composition_valid` | `20261101140000_life_sync_edit_times` | `20261012010000_life_page_posts` |

## 테이블 (5개 변경)

| 테이블 | 만든 파일 | 뒤 변경 (파일: 종류) |
| --- | --- | --- |
| `haedo_blog_private.assets` | `20261017144744_life_blog_originals` | `20261101091500_life_blog_account_sync`: drop constraint, add constraint, add column |
| `haedo_material_private.heads` | `20261019005829_life_material_continuity` | `20261101130000_life_material_tombstones`: add column |
| `haedo_naver_private.inventory` | `20261021113658_life_naver_captures` | `20261029112456_naver_observed_inventory_baseline`: add column |
| `haedo_naver_private.inventory_entries` | `20261021113658_life_naver_captures` | `20261029112456_naver_observed_inventory_baseline`: add column |
| `public.life_compositions` | `20261006010000_life_compositions` | `20261101140000_life_sync_edit_times`: drop constraint, add constraint |
