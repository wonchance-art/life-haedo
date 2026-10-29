# 네이버 수집 운영 준비와 가동 검수

2026-10-29 KST. 기준 main `30e94f0`의 기존 네이버 연결·불변 본문/사진 수집·정확 판 복구를 실제 공개 응답과 예약 실행으로 검증하기 위한 운영 기록이다. 준비 상태 조회, 공개 응답 검사, 서버 가동과 개인 구독 사용은 서로 다른 단계다. 코드·배포·합성 검사 성공만으로 실제 수집 가동을 완료했다고 표시하지 않는다.

## 현재 관측과 미확인 범위

지원된 Cloud Environment·Supabase 연결 도구로 운영 메타데이터만 읽었다. 개인 구독·글·수집 사본·소유자 식별자, Vault 값과 예약 SQL 본문은 조회하지 않았다. 이번 감사에서 DB·Edge·예약·환경 설정을 변경하지 않았다.

| 대상 | 2026-10-29 관측 | 의미와 한계 |
| --- | --- | --- |
| 현재 검수 환경 | spec481, 현재 관측 일치, restricted/enforced, Naver/pstatic 허용 호스트 없음 | 이 환경에서 해당 외부 응답을 검사할 수 없다. Supabase Edge의 네트워크 상태를 대신 증명하지 않는다. |
| 수집 DB | runtime 행 존재, `ready=false`; 수집 사본 테이블 존재 | 스키마는 있지만 공통 가동 관문은 꺼져 있다. |
| 예약 기반 | `pg_cron`·`pg_net` 미설치, `cron.job` 테이블 없음 | 두 네이버 예약 작업도 존재할 수 없다. 작업 SQL 본문을 조회해 얻은 결론이 아니다. |
| Vault 메타데이터 | 저장소는 존재하나 필요한 이름 두 개 없음 | 값의 내용·유효성·같은 프로젝트 자격인지는 조회하지 않았다. |
| 배포 함수 | `haedo-naver-blog` ACTIVE v2, 마지막 갱신 2026-10-21 20:59 KST | 배포 상태이며 실행·수집 성공의 증거가 아니다. |
| 함수 인증 설정 | 배포 메타데이터의 `verify_jwt=false` | 로컬 handler는 별도 Auth 사용자 검증과 서버 전용 키 검증을 수행한다. 메타데이터만으로 배포본의 코드 일치나 인증 성공을 확정하지 않는다. |
| 함수 수집 환경변수 | 실제 `HAEDO_NAVER_INGESTION_ENABLED` 값 미확인 | 과거 문서의 기본 꺼짐 기록을 현재 배포값 관측으로 바꾸지 않는다. |
| 실제 네이버 응답·CDN | 미검증 | robots·RSS·목록·본문·사진 응답과 신규 글 발견·예약 성공을 확인하지 않았다. |

환경 접근 허용, 응답 검수, 비공개 서버 설정, 예약 활성화가 필요한 상태다. 현재 공개 robots 응답이나 실제 블로그의 확보 범위에 대한 성공 기록은 없다.

## 외부 검수에 필요한 정확한 호스트

현재 [collector](../../supabase/functions/haedo-naver-blog/collector.mjs), [본문/목록 worker](../../supabase/functions/haedo-naver-blog/harvest-worker.mjs), [네트워크 경계](../../supabase/functions/haedo-naver-blog/harvest-network.mjs), [이미지 URL 검사](../../supabase/functions/haedo-naver-blog/extractor.mjs)의 경계를 따른다. `*.naver.com`·`*.pstatic.net` 같은 포괄 허용이나 대체 프록시를 요구하지 않는다.

| 정확 호스트 | 용도 |
| --- | --- |
| `rss.blog.naver.com` | 해당 origin의 robots와 공개 RSS |
| `blog.naver.com` | robots, `PostTitleListAsync.naver`, `PostView.naver`, 필요한 경우 `SummaryContentFetch.naver` |
| `m.blog.naver.com` | 현재 모델의 모바일 주소/robots 지원 범위. 기본 worker의 목록·본문 요청은 PC 호스트를 사용하며, 모바일 접근 성공을 별도로 추정하지 않는다. |
| `blogfiles.pstatic.net` | 실제 글에서 확인한 사진 후보와 해당 origin의 robots |
| `postfiles.pstatic.net` | 같은 조건의 사진 후보·robots |
| `mblogthumb-phinf.pstatic.net` | 같은 조건의 사진 후보·robots |
| `blogthumb.pstatic.net` | 같은 조건의 사진 후보·robots |
| `post-phinf.pstatic.net` | 같은 조건의 사진 후보·robots |

배포와 비공개 사본 저장에는 같은 프로젝트의 Supabase origin이 필요하다. 다른 origin으로의 리다이렉트, 로그인 쿠키·개인 브라우저 세션, 비공개 API나 인증 우회는 수집 경로가 아니다. 사진 후보가 실제로 없는 CDN까지 접속 성공했다고 기록하지 않는다.

현재 환경 설정 변경에는 지원된 설정 절차와 사용자 검토가 필요하다. 적용한 [Cloud Environment Runtime 스킬](skill://plugin_connector_1p_c5b7d5df5d7081918f2c4be5a633ed5d/cloud-environment-runtime/SKILL.md)의 정확한 요구는 다음과 같다.

> Configuration changes require the environment configuration workflow and its user review.

현재 제공된 읽기 전용 환경 도구로 허용 목록을 직접 바꾸지 않는다. 지원된 설정 화면에서 정확한 호스트를 검토한 뒤 새 현재 관측의 `observations_current=true`와 네트워크 `state=enforced`를 확인한다. 정책 파일 편집·proxy 우회·다른 네트워크 경로로 접근을 대신하지 않는다.

## 공개 응답 검사와 가동 판단

공개 검사는 별도 준비 도구 [check-naver-live-readiness.mjs](../../scripts/check-naver-live-readiness.mjs)를 사용한다. 기본 `node scripts/check-naver-live-readiness.mjs` 실행은 호스트 진단만 하며 외부 요청을 하지 않는다. 명시적인 probe 입력과 현재 정책 증거가 갖춰진 경우에만 공개 요청을 수행한다.

| 옵션 | 계약 |
| --- | --- |
| `--blog` | 사용자가 검수 대상으로 정한 공개 블로그 ID. 보고서에는 그 ID를 기록하지 않는다. |
| `--probe` | 외부 응답 검사를 명시한다. 옵션이 없으면 fetch0이다. |
| `--policy-status` | 지원된 환경 도구의 현재 네트워크 메타데이터와 관측 시각을 비공개 로컬 파일로 전달한다. 5분 이내 관측·enforced·현재/관측 spec 일치와 정책 snapshot 양쪽의 허용을 요구한다. 파일은 접근 허용 자체가 아니며 실제 proxy 정책이 최종적으로 강제한다. |
| `--post` | 대표 글 번호를 직접 지정한다. 생략 시 첫 목록 항목 하나를 검사하고 선택 방식을 보고한다. 전체 목록을 순회하지 않는다. |
| `--photos 1` | 기본0인 사진 바이트 검사를 최대1개로 명시한다. 허용된 첫 사진 후보와 CDN robots를 확인하며, 전체 디코딩/최초 원본 검증은 하지 않는다. |

관측 파일은 지원된 도구 결과를 기준으로 준비하며, 차단된 현재 환경에서 성공 상태·허용 호스트·외부 검수 attestation을 손으로 만들어 실행하지 않는다. 읽기 전용 도구의 `checked` 결과도 외부 표본 검사 결과이며 서버 예약·개인 계정 수집·전체 목록 이전 성공이 아니다. 실제 확인 범위와 최종 검수 근거는 연결 PR을 따른다.

기본 진단은 패키지 설치 없이 동작한다. 프록시가 설정된 관리 환경에서 실제 probe는 지원되는 `node --use-env-proxy scripts/check-naver-live-readiness.mjs ...` 또는 `NODE_USE_ENV_PROXY=1`로 기존 프록시·CA를 유지한다. 지원 flag가 없거나 프록시 사용 설정이 없으면 요청0으로 차단하며 proxy를 해제하거나 TLS 검증을 끄지 않는다.

명시 probe에는 기존 `tests/fixtures/naver-extractor`의 고정 `cheerio@1.2.0`을 재사용하며, 필요한 경우 해당 경로에서만 `npm ci --prefix tests/fixtures/naver-extractor --ignore-scripts`로 검수 의존성을 준비한다. 앱 런타임 의존성이나 새 추출 엔진을 추가하지 않는다. 도구는 파일에 직접 쓰지 않고 stdout으로 제한된 메타데이터를 반환하므로 필요한 증거만 gitignored `.local/`에 보관한다. 사진 CDN이 허용되지 않았으면 그 CDN의 robots도 요청하지 않으며, 앞서 허용된 core 호스트 요청의 성공과 최종 사진 검사 차단을 구분한다.

검수 순서는 robots → RSS → 목록 첫 페이지 → 명시한 대표 글 → 선택한 사진이다. 현재 worker와 같은 수집기 User-Agent와 제한된 파서를 사용하고, origin별 robots와 실제 요청 경로를 함께 대조한다. robots HTTP200 자체가 해당 경로 허용을 의미하지 않는다. 리다이렉트·거절·누락·파싱 오류를 성공이나 본문 없음으로 바꾸지 않는다.

공개 검사 결과에는 응답 코드·개수·바이트 수·해시·확보 범위·고정 오류 코드만 남긴다. 원문 제목·본문·사진 바이트·대상 URL·블로그/글 식별자나 자격값은 추적 보고서에 넣지 않는다. 사진 검사는 기본 꺼짐이며, 명시 선택 시 확인된 후보의 허용 CDN과 그 origin의 robots를 검증한 뒤 제한된 수만 확인한다. 파일 헤더 치수·SHA 확인은 전체 이미지 디코딩이나 최초 업로드 원본과의 동일성 판정이 아니다.

다음 사실을 구분해 기록한다.

- RSS 성공은 공개 전체 과거 글 목록 확보가 아니다. RSS 범위와 목록 기준선을 따로 확인한다.
- 첫 목록 페이지 성공은 모든 페이지·안정된 총개수·전체 이관 성공이 아니다. 목록의 부분 실패·재개·기준선 확정을 별도 확인한다.
- 본문은 현재 worker의 `partial` 또는 `link_only` 범위로 표시한다. 자료 모델이 `full_text`를 지원한다는 이유로 승격하지 않는다.
- URL에 고해상도 파라미터가 있거나 치수가 크다고 최초 업로드 원본으로 판정하지 않는다. 보관 사진은 `originalStatus=unverified`를 유지한다.
- 새 글이 실제로 관측되지 않았다면 신규 게시 탐지는 미검증으로 남긴다. 기존 글의 수동 수집이나 합성 신규 글로 실제 신규 게시 성공을 대신하지 않는다.

## 서버 자격의 비공개 준비

Supabase의 같은 프로젝트 관리 화면에서 운영자가 다음을 준비한다. 실제 값은 채팅·명령 예시·저장소·CI 로그·스크린샷·프런트 설정에 쓰지 않는다.

| 위치 | 필요한 설정 | 확인 기준 |
| --- | --- | --- |
| Vault | `haedo_naver_project_url` | 이 프로젝트의 HTTPS 루트 URL을 이름 하나로 등록한다. |
| Vault | `haedo_naver_service_role_key` | 같은 프로젝트의 서버 전용 키를 이름 하나로 등록한다. publishable/anon 키나 다른 프로젝트의 키로 대신하지 않는다. |
| Edge Functions 환경변수/Secrets | 기존 플랫폼 자격과 `HAEDO_NAVER_INGESTION_ENABLED` | 실제 배포 worker의 프로젝트 URL·서버 키·사용자 검증용 공개 키와 가동값을 비공개 관리 화면에서 확인한다. |

Vault의 이름 존재 여부는 값 검증이 아니다. 기존 활성화 SQL의 guard는 URL 형식·키 길이/형식과 정확한 이름 개수만 검사하며, 두 값이 현재 프로젝트와 일치한다는 사실을 증명하지 않는다. 운영자가 같은 프로젝트에서 취득·설정했음을 확인하고, 배포 worker의 인증과 비공개 저장 권한을 별도 검수해야 한다. 자격값을 채팅으로 전달해 달라고 요청하지 않는다.

배포 함수의 ACTIVE 표시와 환경변수 설정 완료도 실제 외부 수집 성공과 구분한다. 기존 [Edge handler](../../supabase/functions/haedo-naver-blog/handler.mjs)의 기능 관문과 DB `ready` 관문이 모두 충족돼야 수집을 수행한다. 현재 관측에서 어느 관문도 임의로 켜지 않았다.

공식 운영 참고는 Supabase의 [Schedule Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Vault](https://supabase.com/docs/guides/database/vault), [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control)다. 실제 사용 설정·배포본과 문서를 대조하며 기존 SDK·비공개 버킷을 재사용한다.

## 활성화와 일정의 경계

기존 [naver-collection-activation.sql](../../supabase/operations/naver-collection-activation.sql)을 재사용한다. 기본 호출의 action은 `inspect`이며 DB 관문·확장·예약·구독을 변경하지 않고 반환한다. 실제 외부 검수와 배포 환경 확인이 끝나기 전에 operator attestation을 성공값으로 채워 실행하지 않는다. attestation 문자열은 증거가 아니며, 현재 이 문서가 그 검수를 완료한 것으로 해석되지 않는다.

가동이 가능한 상태가 되면 같은 트랜잭션 안에서 명시한 활성화 action과 두 검수 확인을 전달한다. 스크립트는 모든 관문과 Vault 확인 뒤에만 `pg_cron`·`pg_net`, 지정된 두 작업과 `ready=true`를 준비한다. 중간 실패는 트랜잭션으로 롤백한다. 이 작업은 개인 구독을 자동으로 켜거나 전체 과거 글을 자동 수집하지 않는다. 과거 글은 사용자가 고른 범위로, 새 글은 목록 기준선 뒤 발견 범위로 다룬다.

| 일정/조작 | 실제 의미 |
| --- | --- |
| `haedo-naver-blog-poll` | `*/15 * * * *` 대상의 RSS 발견 작업 |
| `haedo-naver-capture-poll` | 같은 주기의 제한된 목록/본문/사진 작업 재개 |
| 수집기·DB 임대 | handler 작업 기한은 약 80초, DB 임대와 pg_net 요청 제한은 120초. 플랫폼·네트워크·백로그 때문에 한 번에 완료되지 않을 수 있다. |
| 뉴스 화면 자동 갱신 | 화면이 보이고 온라인일 때 공개 목록을 다시 읽는 기능이다. 서버 네이버 수집이나 앱 종료 중 예약과 다르다. |
| GitHub 공개 뉴스 공급 갱신 | 기존 매일 UTC06:15, KST15:15 일정이며 네이버 비공개 수집 두 작업과 독립적이다. |

15분은 예약 목표 주기이며 정확한 실행·완료 시각 보장이 아니다. DB의 실제 cron 시간대·일정·활성 여부를 확인하고, 예약 명령 본문을 출력하지 않은 채 지정 작업 이름·시간표·active 메타데이터만 기록한다. 두 작업이 존재하는 것만으로 호출 인증·실행·수집 커밋 성공을 판정하지 않는다. 사진은 한 실행에서 제한된 수만 처리하므로 checkpoint/재개와 부분 누락을 유지한다.

## 가동 후 완주 검수와 중지

실제 운영 성공은 다음 흐름의 근거로 확정한다. 개인 자료 사용·저장은 그때 허용한 사용자 범위에서 수행하고, 공개 보고서에는 내용·식별자 대신 결과만 남긴다.

1. 대표 공개 목록·본문·사진 검수의 실제 허용 범위와 실패를 기록한다. 계정에서 선택한 연결과 가져온/미수집 상태가 일치하는지 확인한다.
2. 선택한 과거 글의 불변 본문·사진을 한 번 보관하고 반복 조작·응답 유실·재시도에도 중복이나 다른 사진 판 연결이 생기지 않는지 확인한다.
3. 앱을 닫은 동안 실제 예약 호출·인증·작업 완료를 확인하고, 재접속 후 한 번 반영되는지 확인한다. 최초 기준선·새로운 발견·기존 글 재확인을 구분한다.
4. 같은 계정의 다른 기기에서 정확 원문 판과 사진을 받아 기존 인용·원본 바이트·픽셀을 검증한다. 실제 기기·직접 로그인 관측을 합성 SDK/IDB 검사와 구분한다.
5. 선택 사진으로 비공개 글을 저장·재열기하고 전용 파일을 복원한다. 수집만으로 내 글·초안·공개본을 자동 생성하지 않는다.
6. 중지 뒤 새 예약·늦은 완료가 반영되지 않으며 기존 본문·사진·영수증·인용은 유지되는지 확인한다. 부분 실패·오프라인·계정 전환·재개에서 정확한 기존 사본을 보존한다.

중지는 같은 activation SQL의 명시적 `pause` action으로 수행한다. 공통 `ready=false`와 지정된 두 예약의 해제만 적용하며 다른 예약·구독·이전 자료를 삭제하지 않는다. 이미 시작된 요청이 외부 바이트를 받았을 수 있으므로 즉시 네트워크가 전혀 발생하지 않았다고 주장하지 않는다. 늦은 finish 커밋은 DB 관문으로 차단한다. 중지 중 들어온 사본·사진을 지우거나 다른 판으로 대체하지 않는다.

다시 가동할 때는 pause 전 attestation을 무조건 재사용하지 않고 실제 접근 조건·배포 환경·자격·일정을 다시 확인한다. 잘못된 설정은 원본을 유지한 채 해당 설정만 교정하고, 같은 작업의 재개/중복 방지 경로를 사용한다. 무차별 전체 재수집이나 서비스 키 노출로 복구하지 않는다.

## 이번 단계의 완료 판단

현재 안전하게 끝낼 수 있는 범위는 준비 상태의 정확한 표시, 기본 inspect의 무변경 검증, 명시 probe의 차단/허용·부분 실패·재개 검수, 운영 절차와 기존 수집/보존 회귀다. 실제 외부 접근·Vault·배포 환경·예약 증거가 없는 현재 상태는 수집 운영 완료가 아니다. 결과·출시 커밋과 미확인 조건은 연결 PR 및 최신 로드맵에 확정한다.


## 이번 운영 안정화 결과

첫 관측 이후 worker v3를 배포했다. 배포 소스8개를 저장소의 검수한 소스와 대조했고 익명 호출401거절을 확인했다. `run`은 due 목록1페이지를 먼저 처리하고, 공유80초 기한 중45초 넘게 남을 때만 사진 작업1개를 처리한다. 명시 목록/사진 요청·사진2개체크포인트·lease·유실ACK 보호는 유지한다. 두 작업이 매번 끝나거나 일정 시간 안에 수집이 완료된다고 약속하지 않는다. 기존 환경 gate 값은 변경하지 않았으며 DB ready=false·예약 없음은 유지한다.

목록 개수 변경/끝페이지 미완료로 재시작이 막히는 원형 문제를 실제 PostgreSQL에서 재현한 뒤 새scan/page1로 복구하도록 수정했다. migration SHA `186b8f4d06b5641859f419f864f640cff35b5b39adb524122d1047eb183d2cf4`를 운영에 설치했고 기존 inventory_claim body SHA `6e8def3fc70a1c103ea7570978c2400067915efb200dac32f722b6b60f9b87cd`에서 `a606c3837efe0f7ea805baabeb14292c5c7efe9e2b6fabf0e3de603f346bc5f8`의 검토한 조건문만 바뀌었다. 다른105함수·권한 fingerprint `9659c5af9a5133a6f71ec5bd6378528b`와 비활성 상태는 동일하다. 개인 자료는 조회/변경하지 않았고 기존 보안 advisor WARN의 종류/개수도 동일하다.

서버 준비가 꺼진 동안에도 기존 연결을 중지할 수 있게 하고, RSS와 계정 연결의 중지 결과·초점·실패 입력을 보존했다. 단위1592개·중지UI 집중7개/실브라우저5개·worker/RSS29개·격리PG rescan13개와 전체설치11개를 통과했다. 공식spec481/current/enforced 관측을 사용한 실제 probe는 required_host_not_allowed/requests0으로 차단됐으며 실제 네이버 검증을 수행한 것으로 표시하지 않는다. 최종 PWA/CI·공개 반영은 연결 PR에서 확정한다.
