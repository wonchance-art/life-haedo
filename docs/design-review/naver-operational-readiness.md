# 네이버 수집 운영 준비와 가동 검수

## 목록 총계 불일치와 반복 관측 기준선 — 2026-10-29 KST

PR146 뒤 최신 main `2f9d933`에서 다시 시작했다. 공식 환경 spec1/current/unrestricted/enforced와 로컬 정책을 확인했다. 기존 56페이지 원응답을 재사용해 고유1,665개·중복0·식별자/날짜 역순 위반0을 대조했다. 새로 요청한 첫/끝 페이지는 표시 총계1,663개·끝15개와 원응답 해시까지 같았다. 대표 PostView의 카테고리/개수 메타도 확인했지만 독립 총계 근거는 없었다. robots가 금지한 PostList는 요청하지 않았고, RSS·다른 계정·다른 공간·전체 본문 수집으로 조사 범위를 넓히지 않았다. 총계 차이의 원인은 미확정이다.

표시 총계를1,665로 고치는 대신 기존 목록과 별도로 **반복 관측한 집합의 기준선**을 둔다. 이것은 모든 공개 글의 완전성이나 실제 새 게시를 증명하지 않는다. 기존 총계 일치 방식과 구분하며 개인 자동 수집은 여전히 별도 선택이다. 예전 글의 공개 전환도 새로 발견한 항목일 수 있어 UI는 '새로 발견한 글'로 안내한다.

- 기존 `inventory_seen`·소유자/CAS/lease·불변 보관본·영수증을 재사용한다. 새로운 범용 크롤러나 파서를 도입하지 않는다.
- 각 scan의 첫 페이지부터 연속 관측, 원래 표시 총계, 누적 행/고유 집합, 첫 페이지 식별자 해시를 별도 비공개 증거로 보관한다. 마지막에는 첫 페이지와 끝 다음 페이지의 clamp 응답을 다시 확인한다. 중복·총계 변경·건너뛴 페이지·누락된 증거는 완료로 승격하지 않는다.
- 서로 겹치지 않는 두 scan의 집합·원래 표시 총계·연결 revision이 같을 때만 `observed_set` 기준선을 만든다. 과거 실패 scan을 새 증거로 소급 승격하지 않는다. 기존 총계 일치 경로는 유지한다.
- 관측 방식에서는 기준선 이후 처음 발견한 항목을 검증된 scan 종료까지 자동 작업으로 넘기지 않는다. 중지/재개 revision이 바뀌면 이전 미완료 발견을 소급 자동 수집하지 않는다. 기존 보관본·이미 큐에 있는 작업·원문 판·인용·사진은 삭제하지 않는다.
- 요청 전체와 probe를 묶은 영수증으로 정확한 재실행과 변조를 구분한다. HTTP는 트랜잭션 밖에서 수행하고 커밋 때 현재 준비·연결 revision·lease를 다시 확인한다. 기존80초 작업 기한·120초 lease를 늘리지 않으며 probe 예산이 부족하면 확인한 항목만 보존한다.

기존 상태 안내는 worker가 `checked`를 반환하면 개수 불일치의 `partial` 상태를 완료 안내로 덮고 있었다. 목록 상태를 그대로 표시하도록 고치고, 확인한 개수와 네이버 표시 개수·관측 기준과 전체 개수 미확정을 함께 안내한다. 기준선 설정이 자동 수집 동의나 본문/사진 확보를 뜻하지 않으며 기존 입력·선택·연결 중지를 유지한다.

운영 보안의 기존 잔여 조건도 유지한다. `pg_net`의 확장 등록 위치는 public이나 실제 객체는 net이며, 익명·인증 Data API의 net 접근은406으로 차단돼 있다. 기본 PUBLIC 권한과 RLS 미적용은 향후 net 노출/SQL 브리지 추가 시 위험하므로 [등록 위치 경고](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)를 해소했다고 표시하지 않는다. 확장 재설치·catalog 수정·기존 권한 확대는 하지 않는다.

### 구현·설치·실제 검수

격리 PostgreSQL17의22조건과 독립 보존 검수를 통과했다. A/B/A 관측은 승격되지 않고 연속 A/A가 필요하며, 구형8인자 RPC로 관측 방식의 완료 검증을 우회할 수 없다. 총계 변경·중복·누락 증거·legacy 영수증 소급·유실 ACK/다른 proof·중지/재개 revision·기한 만료·부분 실패 재개·원자 롤백·기존 불변 자료/권한을 검증했다. 초기 도구의 격리 DB 선택/SQL 별칭 실패와 교정은 별도 보존했다. 새 checkout의 고정 추출 fixture 의존성이 없던 단위2파일의 로딩 실패도 보존했고, `npm ci` 뒤 해당2파일39개를 다시 확인했다. 통과한 나머지1,585개를 수동 반복하지 않았다. 이후 자연 차단 진단의3회귀를 포함한 worker28개도 통과했다. 필수 전체 CI는 연결 PR 기록으로 확정한다.

검수한 SQL SHA256 `a4e8aaf116eb2977cb7452b241acc49259029c90ca016dcfce0a7c69bbca6e08`을 운영 migration `20261029113551`로 설치했다. 기존 관련2함수의 설치 전 본문이 main과 같음을 먼저 확인했고, 무관한106함수/ACL fingerprint `52b8a7c26c2b19fa18cd0416853130c5`와 보관본1개 fingerprint `ce333550e9b0ff8c2473b886664f6c6d`의 전후 일치를 확인했다. 개인 연결은 켜지 않았다. Edgev8 설치 뒤 실제 첫 관측은16페이지/480개를 보존하고17페이지의 `blocked`에서 멈췄다. 기준선 승격·과거 자동 수집은0이다. 원 실패를 남기고 기존15분 재시도 시각을 따른다. v9는 고정 단계/사유/HTTP 상태/제한된 재시도 초만 반환해 robots 정책·HTTP 차단을 구분한다. URL·본문·헤더·키는 진단에 넣지 않으며 HTTP403만으로 원인을 단정하지 않는다. robots/UA/기한/허용 호스트·기존 backoff는 바꾸지 않았다.

v9 배포 반환 소스8개가 검수본과 모두 일치했다(번들 SHA256 `c69f6828c809d9b1298e6d38d90eb64c55d01de5eb4eb4e1cd88407e424a77c8`). 설치 후 기존 WARN4종/개수는 같았고, RLS에 정책이 없다는 INFO는28→30으로 늘었다. 이는 새 비공개2테이블의 RLS 활성화·직접 grant 없음과 일치하며 공개 읽기 정책을 추가하지 않았다.

실 Auth/동봉 SDK와 실제 기능 UI에서 선택 공간의1,665개를 대조했다. 그 공간에 연결된 정확 원문은1개/partial, 나머지1,664개는 그 공간에 없다. 기존 사본1개/사진2개와 원문 reader의 본문 SHA·사진 바이트/픽셀을 확인했고, 사진 응답 중 입력한 미저장 메모와 원문 그래프가 유지됐다. 서버 쓰기·계정/공간 열거·예상 밖 요청·콘솔/페이지 오류는0이다. 정확 공간의 실응답으로 연결 목록을 좁힌 검수 adapter를 썼으며 계정 전체 발견·Shell 최초 부팅·Google 제공자 검수로 확대하지 않는다. 실제 발췌 패널이 접혀 있던 검수 도구의 첫 입력 timeout은 보존하고 정상 버튼을 연 뒤 reader만 이어 검수했다.

정확한 main2f9d933의SW166→현재167은 실제 Chromium/SW/SDK/IDB9흐름을 통과했다. 고정 Git 객체의 이전 해시를 확인했고 부분 설치503 거부/구 controller 유지·미저장 입력 node/value/caret·합성 정확 원문/로컬 사진의 해시/픽셀/오프라인 재열기와 셸192개 설치·선택44개 모듈 해시 일치를 확인했다. 이는 합성 Auth 갱신 검수이며 실제 수집 성공과 다르다. [내용·개인 식별자·자격을 제외한 증거](evidence/naver-observed-baseline/summary.json)에 원 관측과 범위를 남기고, 이후 실관측·최종 배포 상태는 연결 PR 출시 기록으로 확정한다.

첫 [PR147 CI](https://github.com/wonchance-art/life-haedo/actions/runs/40868195230)는 check 작업을 통과했으나 통합 설치의 새 migration 등록 누락과 PWA 현재 버전166 고정에서 막혔다. 검수한22번째 경로/SHA만 정식 추가하고 기존 전체 목록·과거 해시 거절 단언을 유지했다. 새2컬럼의 NULL 키만 검증 뒤 투영해 기존 모든 값을 비교하며, 실패 롤백/원문·사진·권한·함수/실제 영수증을 채운 재설치를 포함한12묶음을1회 통과했다. PWA는 현재 목표만 정확히167로 바꾸고 기존162/163의 원형·SHA·보존 단언·기한을 유지한 두 경로를 각각9개 통과했다. 독립 diff 검수를 거쳤고 제품/SQL/UI/SW/fixture는 이 교정에서 바뀌지 않았다. 원 실패와 교정 근거를 별도 보존한다.

아래는 PR146 당시의 검수 기록이며 기준 main은 `04dfcc1`(PR144)다. 기존 네이버 연결·불변 본문/사진 수집·정확 판 복구를 재사용하며, 준비 상태 조회·공개 응답 검사·서버 가동·개인 구독 사용을 구분한다. 코드·배포·합성 검사 성공만으로 실제 수집 가동을 완료했다고 표시하지 않는다.

## 최신 실제 관측: PC 경로 검수 성공과 PC 전용 예약

RSS 실패를 다른 origin의 수집 불가로 확대했던 이전 판정을 정정한다. 현재 환경은 공식·로컬 모두 unrestricted/enforced이며, 실제 PC `robots.txt`에서 현재 수집기에 적용되는 wildcard 규칙은 `PostTitleListAsync.naver`·`PostView.naver`·`SummaryContentFetch.naver`를 금지하지 않는다. RSS origin의 전면 차단은 유지한다. AI 학습·RAG 금지 주석과 소유 블로그의 비공개 보관·정확 복원 검수를 구분했으며 모델·임베딩 공급이나 새 RAG 경로를 추가하지 않았다. 원문·사진은 프로세스/비공개 보관 경로에서 검증하고 보고서는 개수·해시·상태만 사용한다.

| 실제 검수 | 결과와 한계 |
| --- | --- |
| PC 목록·대표 글 | RSS 요청0으로 목록 첫30개, 대표 본문1,185 UTF-8 bytes·`partial`, 사진 후보2개를 확인했다. 본문 해시 `72818a851ba0d48513eefdebefb9b09cdd19aa2f9a2a12bdfc5fa7e98bfc4e16`. |
| 사진 표본 | JPEG900×1,200·215,380bytes·SHA256 `21e29e3719be7d4d1c37b8d2b2db344df9f8529c093056f2eada5a4da05e74ba`. CDN 자체 robots404 뒤 사진200, 실제 Pillow 디코딩 성공. 최초 업로드 원본 동일성은 미검증이다. |
| 전체 목록 대조 | 56페이지·고유1,665개·중복0, 서버 보고 총계1,663, 마지막 페이지15개(계산상13개). 넘긴57페이지는 같은 끝15개를 반환한다. 첫 페이지·총계 재확인은 동일했다. 공개/비공개·차단 플래그와 검색 제외를 대조했지만 총계 차이의 원인은 확정하지 않았다. |
| 목록 보존 | 검수 계정의 새 격리 공간에1,665개를 실제 저장했다. `partial`, 기준선 미완료를 유지하고 원래 보고 총계를1,665로 고치지 않았다. 원래 계정 자료나 로컬 브라우저 자료의 부재를 뜻하지 않는다. |
| Vault 인증 | 기존 등록값을 다시 만들지 않았다. DB 내부에서만 조합한 기존 키가 서비스 전용 RPC에서 HTTP200을 받았다. 같은 프로젝트·service role·미만료 boolean도 확인했다. 키 값은 조회 결과·명령·로그로 꺼내지 않았다. |
| worker 환경 | 새 read-only `readiness`의 실제 응답은 HTTP200, `ingestionEnabled=true`, 활성화 전 `ready=false`였다. 사용자 안내만으로 true를 간주한 것이 아니다. |
| 예약 활성화 | 기존 SQL의 명시 `public` 모드로 `ready=true`, PC `run` 작업1개·`*/15 * * * *`·GMT를 설치했다. RSS 예약0, 다른 대상의 활성 구독0을 확인했다. 글로벌 작업이므로 검수 대상 외 기존 활성 구독이 없음을 먼저 확인했다. |

전체 목록 식별자 집합 SHA256은 `8c9d41ac7fff6f5a197ea7ac6f05c0fb847217f58168878b9a95188bea5bef1a`다. 개인 제목·본문·사진 바이트·식별자 목록·계정·자격은 저장소 밖의 제한된 검수 파일에만 두며, 토큰과 키는 파일에도 저장하지 않는다. 사용자의 별도 성공 구현 위치는 아직 전달되지 않아 그 코드와의 직접 비교는 미검증이다. 현재 서버 worker의 독립 PC 경로 자체는 실제 응답으로 확인했다.

### 준비·인증·목록 보존 수정

- CLI는 `--source public|rss|all`을 지원한다. `public`은 RSS 요청/정책 요구 없이 기존 PC/사진 경로를, `rss`는 PC/추출기 없이 RSS를 검사한다. 기본 `all`의 기존 즉시 중단 계약은 유지한다. source별 미선택/미검수/성공/차단과 `operationalReadinessVerified=false`를 반환해 PC 표본 성공을 RSS·전체 운영 성공으로 승격하지 않는다.
- 기존 환경 키와 다른 문자열의 유효한 서비스 JWT를 거절하던 문제를 수정했다. 정확 일치 경로는 유지하며 추가 후보는 크기·HS256·service role·현재 프로젝트·유효기간을 제한한다. 이 해독 결과는 인증 근거가 아니다. 후보 자체를 동일 프로젝트의 서비스 전용 RPC에 보내 원격 서명/권한과 HTTP200·정확한 boolean을 확인한 뒤 현재 요청에서만 사용하고 매 요청 다시 확인한다. 일반 사용자는 기존 Auth `getUser`와 owner 제한을 유지한다. 401/403과 429/5xx도 구분한다.
- 마지막 페이지의 정상 항목15개를 개수 불일치만으로 버리지 않도록 명시 보존 모드를 추가했다. strict 기본값·행 형식·중복·상한·중간 페이지·57페이지 clamp 차단은 유지한다. 보존 응답은 원래 총계와 `count_consistent=false`를 유지하고, worker는 실제 항목 전부·신뢰 총계`null`·다음 페이지`null`로 기존 DB 함수를 호출하며 `failed=true`로 알린다. 누적 고유 개수가 우연히 보고 총계와 같아도 기준선을 완료할 수 없다.
- `haedo.naver_mode='public'`은 지정 RSS 예약을 해제하고 PC 예약만 설치한다. 기존 기본 `all`·`pause`·`inspect`·트랜잭션 원자성은 유지한다. 이 모드는 예약의 선택이며 수동 RSS 접근을 전역 비활성화하지 않는다. 수동 RSS도 자체 robots 검사를 통과해야 한다.

인증은 [현재 API 키](https://supabase.com/docs/guides/getting-started/api-keys)·[함수 인증](https://supabase.com/docs/guides/functions/auth)과 대조했다. 새 권장 `@supabase/server`/secret dictionary로의 전체 이전은 사용자 인증·예약 헤더까지 바꾸므로 이번에는 기존 fetch·SDK·서비스 전용 RPC를 재사용했다. 새 패키지·로그인 우회·임의 프록시는 추가하지 않았다.

### 독립 검수와 운영 검수의 범위

CLI·worker·인증·활성화 SQL을 각각 독립 검토했다. 격리 PostgreSQL17에서 활성화 모드·guard·예약 전환·실패 원자 롤백9개를 실행했고, 이는 확장/Cron/Vault shim을 사용한 검수다. 별도 실제 SQL 실험에서는 고유31개=이전 보고31개라도 마지막 신뢰 총계가`null`이면 `partial`·기준선 미완료·자동 작업0임을 확인했다. 정확 영수증 재실행·변조 거절·새 스캔과 이전 관측 보존도 확인했다. 운영 확장 설치·예약·개인 수집 성공은 이 합성/격리 결과와 별도로 위 실제 관측에 기록한다.

Edge v7(번들 SHA256 `1db5135a134309ad15f354d04572431a8b61218987eda61eb5abd607842c8fab`)을 배포하고 플랫폼이 반환한 런타임 소스8개 전부가 검수본과 일치함을 확인했다. 기존 Vault·함수 환경값은 바꾸지 않았고, `pg_net`으로 자격을 비밀 없이 검증한 뒤 선행 관문을 통과한 PC 전용 예약을 설치했다. 실제 새 게시물을 관측하지 않았으므로 신규 게시 탐지는 미검증이다. 전체 목록 기준선도 총계 불일치가 해소되거나 별도 검증 방법이 설계될 때까지 미완료다.

### 실제 예약·보관·독립 브라우저 복원·중지 결과

2026-10-29 18:15 KST의 실제 Cron이 브라우저가 닫힌 동안 발화했다. Cron 성공은 enqueue 근거로만 쓰고, 별도로 pg_net HTTP200/`stage=capture`/`pending=false`, DB 작업`complete`·보관본1개·사진2개·부분 실패0을 확인했다. 사진은900×1,200/215,380bytes와900×600/148,234bytes이며 최초 대표 표본의 본문/첫 사진 해시와도 일치했다. 과거 글1개를 명시 요청한 결과이며 새 게시 탐지 증거는 아니다.

검수 계정의 새 공간만 대상으로 실제 Auth·동봉 SDK·제품의 계정별 IndexedDB/수신/영수증/사진 검증 코드를 실행했다. A가 보관본을 받아 원문 서버 ACK와 불변 사진 영수증1개를 등록했다. 독립 B는 같은 정확 판과 사진을 받아 본문/수집 해시·모든 사진 SHA·해상도·실제 디코딩 픽셀이 같고 원문 그래프가 변하지 않음을 확인했다. 같은 보관본의 반복 수신과 재요청은 새 원문 판·새 보관본을 만들지 않았다. 다른 검수 계정의 동일 보관본 읽기는 정보 없이`null`을 반환했다.

사진을 포함한369,143bytes의 비공개 ZIP을 만들고 읽기→새 공간 사본 복원을 확인했다. 사본은 `localOnly=true`, 서버 영수증0개이며 원문·사진 바이트와 픽셀은 유지됐다. 독립 C의 첫 다운로드에만 합성503을 주입한 검수에서는 불완전 사진이 설치되지 않고 원문 그래프가 보존됐으며, 실제 서버 재시도로 같은 정확 판을 복원했다. 이503은 자연 발생한 네이버 장애로 보고하지 않는다.

검수 도구의 Node UMD 로딩/SDK 다운로드 경로와 JSONB 객체 키 순서 비교 문제는 제품 데이터 초기화 없이 교정했다. 원래 B 비교 실패 보고서는 비공개로 보존했고, 객체 키만 canonical 정렬하며 배열·본문 문자열·공백·CRLF·사진은 바꾸지 않았다. 재검수는 이미 서버 ACK된 정확 판을 그대로 사용하고 서버 원문 쓰기를 차단해 추가 원문 판0을 확인했다. 실제 Google 제공자 로그인·전체 제품 UI·물리적인 두 기기·Mac/iPad/iPhone 검수는 이 모듈 검수로 대체하지 않는다.

연결 중지 뒤 보관본1개·목록1,665개가 유지됐고, 새 서버 `run`은 HTTP200/`busy`였다. 전역 `pause`도 실제 실행해 ready=false·예약0과 보관물을 확인했고, read-only 진단은 flag=true/ready=false, 실행 요청은 `setup_required`를 반환했다. 검수 후 PC 모드만 다시 활성화해 최종 ready=true·PC예약1·RSS예약0으로 두었다. 검수용 연결은 중지되어 활성 개인 구독은0개다. 기존 사용자의 공간을 추정해 연결하거나 개인 연결·기준선 완료를 대신 선언하지 않는다.

[비밀·내용·식별자를 제외한 실제 운영 요약](evidence/naver-public-operation/summary.json)에 관측과 범위를 기록한다. 개인 ZIP·원문/사진·검수 계정 식별자·실패 보고서는 저장소 밖에만 남긴다. 최종 저장소 CI·병합·Pages 결과는 연결 PR 출시 기록에서 확정한다.

첫 [출시 CI](https://github.com/wonchance-art/life-haedo/actions/runs/40851134937)는 단위1,615개·새 활성화SQL9조건과 목적 흐름8개를 통과했지만, 목적 흐름 검수기가 context를 닫는 동안 늦은 `/icon.svg`의 `response.body()`를 읽어 실패했다. 기존 pending 목록의 한 번짜리 스냅샷 대신 정적 요청 시작/종료와 해시 검증을 함께 추적해 둘 다0인 경계에서 관측을 끝낸 뒤 닫도록 교정했다. 해시/오류 단언과 기존 제한시간은 유지한다. 집중 재검수는8흐름·21캡처·정적1,925응답(아이콘57개)을 검증했고 모든 종료 직전 진행 요청/검증0·오류0·제품 소스/fixture/runner 불변을 확인했다. 이는 검수 도구 종료 경합의 수정이며 제품 UI·원문/사진 저장 형식 변경이 아니다.

## 이전 판정: RSS robots 차단에 따른 전체 가동 보류

아래는 PR144 시점의 기록이다. RSS의 실제 차단 관측은 유효하지만 이를 PC 경로까지 확대했던 가동 판단과 현재 설정값은 위 최신 관측으로 대체한다.

새 독립 worktree에서 공식 환경 상태와 로컬 `/etc/codex/network-policy.json`을 대조했다. spec1/observed spec1, `observations_current=true`, `unrestricted/enforced`이고 로컬 HTTP 정책도 unrestricted다. 이전 spec481의 미적용 상태와 다르며, 사용자에게 네트워크 설정이나 이미 등록한 Vault를 다시 요구할 조건이 아니다.

| 대상 | 현재 결과 | 가동 판단 |
| --- | --- | --- |
| RSS robots | [실제 응답](https://rss.blog.naver.com/robots.txt) HTTP200, 515bytes, `User-agent: *` / `Disallow: /` | 수집기에도 전면 금지. readiness probe는 이 요청 1건 뒤 `blocked`로 종료했고 RSS 본문·목록·글·사진 요청은 0건이다. |
| 블로그 robots | [실제 응답](https://blog.naver.com/robots.txt) HTTP200, 1,623bytes | AI training/RAG 목적의 봇 접근 금지 문구가 있다. PC 경로로 RSS 금지를 대신 통과시키지 않는다. |
| 수집 DB | `ready=false`, `pg_cron`·`pg_net` 미설치 | 예약 활성화·확장 설치·구독 생성·개인 자료 쓰기를 하지 않았다. |
| 명시 대상의 서버 상태 | 구독0·RSS 항목0·capture0 | 해당 서버 경로의 집계만 확인했다. 로컬 브라우저·다른 가져오기 경로의 기존 글이 없다는 뜻이 아니다. 전체 공개 목록을 받지 못했으므로 미수집 총수와 기준선은 미확인이다. |
| Vault | 두 이름 각각1개, 프로젝트 URL 일치·서버 키 기본 형식 검사 통과 | 비밀은 SQL 내부 boolean 검사만 했다. 실제 인증 권한 성공은 미검증이며 재등록을 요구하지 않는다. |
| 배포 함수(수정 전) | ACTIVE v4, 기존 해시 `9414e7b59f4aac9d8d14803cd7e1c65ec5aba4cd6b78816c97921e20e8c27a88`; 소스8개가 main과 일치 | 소스 일치와 실제 실행 성공은 다르다. |
| 환경값·서버 키 인증 | 실제 flag true·Vault 키 인증은 미검증 | 현재 연결 도구에는 secret digest 조회가 없다. `ready=false`에서 handler는 flag false와 동일한 `setup_required`를 반환하므로 그 응답만으로 true를 증명할 수 없다. 진단을 위해 ready를 켜거나 자격값을 꺼내지 않았다. |

RSS robots SHA256은 `2dff46c43bf5ed9611b25434c4e2110a574470d722e70dff1e2d99ba4289a2f5`, 블로그 robots SHA256은 `b0a0a5a0aa415af00955e98be932403dc9d99fcb7626b45fcd169b97e1c113b4`다. 원문·제목·사진·소유자 식별자·자격값을 보고서나 저장소에 넣지 않았다. 공개 robots 보충 조회 2건과 probe의 robots 1건을 구분한다. 정책상 차단 뒤 다른 UA·프록시·모바일/목록 경로로 수집을 우회하지 않았다.

현재 [활성화 SQL](../../supabase/operations/naver-collection-activation.sql)의 `external_validation=verified`를 정직하게 충족할 수 없다. 따라서 `ready=false`와 예약 미설치를 유지한다. 네트워크 unrestricted는 사이트 접근 허가를 대신하지 않는다. 전체 목록·기수집 대조, 본문/사진 확보 범위, 앱 종료 중 예약·재접속·정확 복원·중지/부분 실패/재시도/중복 방지의 **실제 운영**은 모두 미검증이다. 합성 회귀 결과로 승격하지 않으며 신규 게시 탐지도 미검증이다.

다음 큰 작업은 **허용된 자료 확보부터 정확 원문·사진 활용까지**다. 자동 수집은 해당 목적·수집기·경로에 대한 허용 근거가 먼저 필요하며, 그때 robots/RSS/목록/대표 응답→비밀 없는 환경·인증 확인→기존 SQL 활성화→실제 예약·복원 검수를 이어간다. 정책이 유지되면 사용자가 직접 제공한 내보내기/본문·사진 파일을 기존 수동 가져오기·불변 판·보관/복원 경로로 처리하는 대안을 설계한다. 이 대안은 예약 수집 성공이 아니며 현재 세션에서 추가 개인 자료를 취득하거나 새로운 전송 경로를 만들지 않았다.

## robots 경로 일치 결함과 회귀 검수

독립 검토에서 `Disallow: /photos/first.png`가 `/photos/%66irst.png` 요청을 막지 못하는 결함을 확인했다. main의 원래 구현은 true(허용), 수정본은 false(차단)로 재현했다. [RFC9309 §2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2)에 따라 기존 비교기에 unreserved ASCII 정규화·percent hex 대소문자 통일·UTF-8 경로 비교를 추가했다. `%2F` 등 예약 문자와 encoded `*`/`$`는 유지하고 잘못된 escape/UTF-8/제어문자는 차단한다. 실제 fetch URL이나 원문은 바꾸지 않는다. 새 라이브러리·수집 경로를 도입하지 않았다.

collector16개와 worker/readiness25개 회귀를 통과했고 정적 검사는 HTML22·JS174·리소스726·PWA 셸을 통과했다. 기존 전체 단위·브라우저·PWA 업데이트 검사를 수동 반복하지 않았다. UI·저장 형식·공개 셸 변경은 없으며 이번 수정으로 실제 RSS 전면 금지가 풀리지 않는다. 독립 검수와 배포 결과는 아래 출시 기록에서 확정한다.

### 방어 수정 출시 기록

별도 검수자가 percent 정규화/UTF-8/예약 문자/wildcard/이중 인코딩10조건과 잘못된 인코딩8조건을 확인했다. CDN 네트워크 경계를 거친 합성 실험에서도 금지된 encoded 사진 경로는 robots1회 뒤 차단되고 사진 요청은0회였다. 운영 SQL·보존 흐름·문서도 독립 검토했다.

2026-10-29 16:57 KST에 Edge v5를 배포했다. 번들 SHA256은 `6c5a2e0bbbba67465eb5b10378fa8e15494a86aa1d244b1d666cf97f5d8744ee`, ACTIVE/`verify_jwt=false`이며 handler의 기존 개별 인증을 유지한다. 배포 입력에는 기존 Deno 설정·lock을 포함했고, 플랫폼이 반환한 런타임 소스8개 모두 검수한 작업공간과 일치한다. 바뀐 런타임 소스는 collector1개다. 실제 익명 cron 요청은 HTTP401/`unauthorized`로 거절됐다. 이는 익명 거절 확인이며 Vault 키의 인증 성공을 뜻하지 않는다.

배포 뒤 DB `ready=false`·확장/예약 미설치·대상 구독/항목/capture0을 재확인했다. 사이트 금지 규칙이 유지되므로 실제 RSS·본문·사진 검사를 반복하지 않았다. 저장소 통합과 필수 CI·Pages 결과는 연결 PR의 최종 기록을 따른다. 이 출시는 robots 준수 방어 수정이며 네이버 실제 자동 수집 가동 완료가 아니다. 기존 보안 advisor의 3종 WARN(익명/인증 사용자 SECURITY DEFINER 노출, 유출 비밀번호 보호 비활성)은 별도 이력이며 이번 변경으로 DB 권한을 수정하지 않았다. [DB 함수 안내](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)·[인증 함수 안내](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)·[비밀번호 보호 안내](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 이전 세션 관측 이력

아래 spec481·Vault 미등록·worker v2/v3 기록은 이전 단계의 관측이다. 최신 상태는 위 표를 따른다.

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
