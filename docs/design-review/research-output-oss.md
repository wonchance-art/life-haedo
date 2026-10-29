# 탐구 자료 발견과 후속 제작 자동화의 오픈소스 선택

확인일: **2026-10-29 UTC**. 공식 저장소·배포 기록·문서·공개 보안 자료만 읽었다.
사용자의 최신 결정은 **내가 읽을 탐구 자료를 추천받는 SNS 계정부터 시작**하는 것이다.
현재 결론은 SNS 안의 추천·팔로우·저장 → 직접 고른 링크 → 해도의 기존 검색·규칙 추천 재사용이다.
발행 도구나 추천 서버 설치를 이 시작 단계의 조건으로 만들지 않는다.
이 문서는 선택 조사이며 설치·계정 연결·개인 피드 수집·AI 호출·외부 게시를 실행하지 않았다.

## 1. 지금 풀 문제와 선택 기준

- 목적은 믿을 만한 연구와 설명을 적은 수고로 발견하고 실제로 읽는 것이다.
- SNS 계정은 발견 입구이며, 학술 원문·저자·연구 방법·발행 상태를 대신하지 않는다.
- SNS에서 고른 링크는 원문 확보 여부와 함께 가져온다. 링크만 있으면 본문으로 표시하지 않는다.
- SNS 자체 추천을 사용하는 것과 해도가 개인 피드·열람 이력을 API로 받을 수 있는 것은 별개다.
- 처음에는 플랫폼 내부 조작과 명시 링크 선택을 사용하고, 제공 API·권한이 확인된 수신만 후속으로 붙인다.
- 학습 데이터가 적으므로 사용자 간 협업 필터링보다 관심·언어·출처·자료 유형과 명시 판단을 먼저 활용한다.
- 흥미·좋아요, 나중에 읽으려는 담기, 실독 후 도움, 제작용 채택은 서로 다른 신호다.
- 추천 품질은 원문 관련성·근거의 질·다양성·실독 후 도움으로 판단한다. 클릭 수를 연구 신뢰도로 쓰지 않는다.
- 추후 AI 제작도 출처와 적용한 문구를 추적하며, 추천에 들어온 자료가 자동 게시되는 구조로 만들지 않는다.
- 아래 운영 부담 평가는 구조에 근거한 판단이다. 실제 월 비용·부하·정확도는 측정하지 않았다.

## 2. 후보는 기존 방식 포함 여섯 개로 제한

| 후보 | 맡길 수 있는 일 | 지금 결정 | 새 운영 부담 |
| --- | --- | --- | --- |
| 기존 경량 방식 | SNS에서 선택한 링크, 공개 후보, 규칙 추천·검색 | **기존 구현 재사용** | 공급 관리·품질 비교·오류 복구 |
| Gorse | 여러 후보 생성기와 개인화 랭킹 | **설계 참고·도입 보류** | Go 서비스·학습 작업·데이터/캐시·접근 통제 |
| pgvector | 이미 확보한 자료의 의미 유사 후보 검색 | **조건부 부분 도입 후보** | 임베딩 생성·검색 인덱스·DB 확장 관리 |
| Postiz | 선택한 콘텐츠의 채널별 예약·발행 | **후속 게시 경계 참고·지금 보류** | 앱·Postgres·Redis·Temporal·채널 인증 |
| n8n | 여러 외부 도구를 운영자가 조합 | **후속 운영 연결 참고·지금 보류** | 실행 서비스·자격증명·실행 로그·라이선스 범위 |
| Temporal | 오래 걸리는 작업의 내구 실행·재개 | **재시도 설계 참고·지금 보류** | 서버/Cloud·별도 Worker·실행 이력·버전 관리 |

순수 JavaScript 화면과 현재 계정 저장을 교체하는 후보는 없다.
외부 서비스가 필요해져도 화면·원문·작성·공개 계약은 유지하고 작은 서버 어댑터로 경계를 만든다.

## 3. 공식 버전·유지관리·라이선스 확인

아래 `push`는 GitHub 저장소 메타데이터의 마지막 push 시각이며, 유지보수 품질이나 운영 안정성의 증명은 아니다.
다섯 외부 저장소는 조회 당시 모두 `archived=false`였다. 기존 방식은 별도 외부 패키지 릴리스가 아니다.

| 후보 | 확인한 배포와 날짜 | 유지관리 관찰 | 확인한 라이선스 |
| --- | --- | --- | --- |
| Gorse | [v0.5.11](https://github.com/gorse-io/gorse/releases/tag/v0.5.11), 2026-07-14 | [메타데이터](https://api.github.com/repos/gorse-io/gorse): push 2026-10-28 | [해당 태그 LICENSE](https://github.com/gorse-io/gorse/blob/v0.5.11/LICENSE): Apache-2.0 |
| pgvector | [0.8.7 변경 기록](https://github.com/pgvector/pgvector/blob/v0.8.7/CHANGELOG.md): 2026-10-01; [공식 발표](https://www.postgresql.org/about/news/pgvector-087-released-3392/): 10-05 | [메타데이터](https://api.github.com/repos/pgvector/pgvector): push 2026-10-28 | [해당 태그 LICENSE](https://github.com/pgvector/pgvector/blob/v0.8.7/LICENSE): PostgreSQL License |
| Postiz | [v2.25.3](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3), 2026-10-24 | [메타데이터](https://api.github.com/repos/gitroomhq/postiz-app): push 2026-10-28 | [해당 태그 LICENSE](https://github.com/gitroomhq/postiz-app/blob/v2.25.3/LICENSE): AGPL-3.0 |
| n8n | [n8n@2.45.5](https://github.com/n8n-io/n8n/releases/tag/n8n%402.45.5), 2026-10-28 | [메타데이터](https://api.github.com/repos/n8n-io/n8n): push 2026-10-29 | [해당 태그 LICENSE.md](https://github.com/n8n-io/n8n/blob/n8n%402.45.5/LICENSE.md): Sustainable Use License와 별도 Enterprise 범위 |
| Temporal Server | [v1.32.1](https://github.com/temporalio/temporal/releases/tag/v1.32.1), 2026-10-08 | [메타데이터](https://api.github.com/repos/temporalio/temporal): push 2026-10-29 | [해당 태그 LICENSE](https://github.com/temporalio/temporal/blob/v1.32.1/LICENSE): MIT |

Gorse·Postiz·n8n·Temporal의 버전은 공식 `releases/latest` API의 비사전배포 결과와 릴리스 URL을 대조했다.
pgvector의 해당 API는 404여서 태그·CHANGELOG·PostgreSQL 공식 발표로 확인했다. `0.9.0 unreleased`는 배포 버전으로 세지 않았다.
n8n [3.0 beta 발표](https://blog.n8n.io/introducing-n8n-v3/)는 2026-10-27이며 위 2.45.5 배포와 구분한다.
n8n은 공식적으로 OSI 오픈소스라고 부르지 않는 source-available 제품이다. [공식 라이선스 설명](https://github.com/n8n-io/n8n-docs/blob/main/docs/n8n-community-license/README.md).
개인·내부 운영과 고객에게 연결/자동화 기능을 제공하는 서비스는 허용 범위를 따로 검토해야 한다.
AGPL 서버의 수정·네트워크 제공 의무도 실제 통합 방식에 맞춰 확인한다. 무료 소프트웨어라는 이유로 의무가 없어지는 것은 아니다.

## 4. 현재 재사용할 수 있는 것

[기존 추천](../../assets/life/discovery-recommendations.js)은 제목·공식 태그의 어휘 규칙이며 학습된 모델이나 도움 확률이 아니다.
개인 추천을 켠 경우 명시 좋아요만 신호로 쓰고, 출처·언어·제외 조건을 적용한다.
이 범위를 유지한 채 사용자가 선택한 출처·주제와 후보 노출 이유를 비교하는 것이 첫 기준선이다.
[공개 후보 수집기](../../scripts/update-discovery-feed.py)는 검토한 RSS/Atom의 메타데이터를 가져오며 개인 관심·기사 본문을 받지 않는다.
[배포 workflow](../../.github/workflows/pages.yml)에 일일 예약과 수집 산출물 갱신이 있다. 예약 지연·누락 가능성도 코드에 명시되어 있다.
[통합 검색](../../assets/life/unified-search.js)과 정확 원문/판을 먼저 재사용하고, SNS 후보를 검색 결과의 확보된 원문으로 오인시키지 않는다.
[모델 worker](../../assets/life/interest-model-worker.js)는 명시 준비 뒤 동작하는 브라우저 모듈 worker다.
이 worker를 탭 종료 후에도 보장되는 서버 작업 큐나 SNS 게시 실행기로 부르지 않는다.
기존 수집·계정 보관·영수증 패턴은 참고 가능하지만 AI 제작·SNS 게시용 서버 실행이 이미 있다고 가정하지 않는다.

**결정:** 새 패키지 없이 현재 경량 방식을 재사용한다. SNS에서 잘 고른 링크를 넣는 작은 입력 경로부터 평가한다.
**한계:** 제목 어휘만으로 연구 방법·재현성·주장의 타당성을 판정할 수 없다. 내용 평가에는 확보된 원문과 직접 검토가 필요하다.
**비용:** 출처별 이용 범위·수집 실패·중복·언어 공급 편향을 관리하는 비용은 남는다.

## 5. 추천 엔진 — Gorse

[고정 태그 README](https://github.com/gorse-io/gorse/blob/v0.5.11/README.md)는 master의 학습, worker의 오프라인 추천, server의 REST 역할과 데이터/캐시 계층을 구분한다.
[현재 pipeline 문서](https://gorse.io/docs/concepts/pipeline)는 여러 후보 생성기·랭킹·새 사용자 fallback 구조를 설명한다.
현재 문서의 갱신일은 2026-10-23이므로 모든 설명을 7월의 안정 태그에 그대로 귀속하지 않는다.
새 계정에서 추천기가 부족하면 최신 자료 같은 fallback을 쓸 수 있지만, 이는 개인 연구 유용성이 학습되었다는 뜻이 아니다.

- 직접 도입: 보류. 소수 사용자의 초기 취향을 얻기 위해 학습/추천 서버부터 운영할 이유가 부족하다.
- 재사용 범위: 후보 생성 → 중복·제외 → 정렬 → 탐색 다양성 → 직접 평가의 역할 분리를 설계에 참고한다.
- 운영 비용: 학습·캐시 갱신·서비스 감시·개인 피드백 데이터의 소유 범위·삭제 반영을 추가로 관리한다.
- 현재 적합성: REST 어댑터는 가능하지만 브라우저 스크립트에 끼워 넣는 라이브러리는 아니다.
- 전환 조건: 실제 읽기 판단이 쌓이고, 같은 후보 집합에서 기존 규칙보다 도움/다양성이 좋아지는 비교 근거가 있을 때만 격리 평가한다.

공개 보안 확인: [공식 저장소 issue #1292](https://github.com/gorse-io/gorse/issues/1292)는 비어 있는 관리 키와 유지관리 endpoint 인증 문제를 보고했다.
연결된 [수정 PR #1293](https://github.com/gorse-io/gorse/pull/1293)은 2026-06-15 병합을 확인했다. 선택 바이너리에 포함됐는지는 이번에 검증하지 않았다.
[저장소 advisory API](https://api.github.com/repos/gorse-io/gorse/security-advisories?per_page=5)는 빈 결과였다. 위 공개 이슈가 있으므로 이를 “취약점 없음”으로 해석하지 않는다.

## 6. 검색 — pgvector와 기존 검색

[pgvector 0.8.7 README](https://github.com/pgvector/pgvector/blob/v0.8.7/README.md)는 PostgreSQL 안에서 정확/근사 이웃 검색을 제공한다.
임베딩을 만드는 모델, 원문 확보, 연구의 질 평가, 인용의 정확성은 별도의 책임이다.
언어가 다른 표현의 관련 후보를 찾는 데 유용할 수 있지만 유사도 순서가 근거의 신뢰도 순서는 아니다.

- 직접 도입: 지금 보류. SNS 안에서 추천받기와 소수 선택 링크를 읽는 데 벡터 인덱스가 먼저 필요하지 않다.
- 부분 도입 후보: 현재 DB를 유지한 채 확보된 자료의 정확 판 ID에만 벡터를 연결하는 별도 검색 경로.
- 기존 검색과 비교: 정확 제목·저자·DOI·구절 찾기는 문자 검색을 유지하고 의미 후보를 보조로만 제시한다.
- 운영 비용: 모델·차원·자료 판에 따른 임베딩 갱신, 생성 비용, 벡터 저장량·인덱스 메모리, 삭제와 권한 필터 검증.
- 전환 조건: 실제 다국어 질문에서 반복적인 누락이 관찰되고, 같은 자료/질문의 작은 비교에서 재현 가능한 개선이 있을 때.
- 근사 검색은 필터 뒤 후보가 부족해질 수 있다. 도입 시 계정 필터와 검색 누락을 함께 확인한다. [공식 필터 설명](https://github.com/pgvector/pgvector/blob/v0.8.7/README.md#filtering).

공개 보안 확인: [공식 발표](https://www.postgresql.org/about/news/pgvector-087-released-3392/)는 0.8.7의 IVFFlat 인덱스 생성 buffer overflow 수정과 **CVE-2026-103484**를 알린다.
CHANGELOG의 10월1일과 발표의 10월5일을 구분했다. 실제 DB의 설치 버전·확장 가능 여부·패치 적용 상태는 조회하지 않았다.
[저장소 advisory API](https://api.github.com/repos/pgvector/pgvector/security-advisories?per_page=5)의 빈 결과가 공식 보안 발표를 대체하지 않는다.

## 7. 게시 — Postiz

[공식 API](https://docs.postiz.com/public-api/introduction)는 연결 채널, 게시물, 미디어, 상태 조회 등의 인터페이스를 제공한다.
이것은 내가 읽을 SNS 추천 피드를 구성하는 도구가 아니다. 사용자에게 보낼 초안 제작·선택 게시가 실제 필요해진 뒤의 후보다.
[고정 태그 Compose](https://github.com/gitroomhq/postiz-app/blob/v2.25.3/docker-compose.yaml)에는 Postiz·PostgreSQL·Redis·Temporal 계층이 포함된다.
[설치 문서](https://docs.postiz.com/self-host/installation/docker-compose)의 소형 VM 예시는 운영 용량 보장이나 전체 월 비용 견적이 아니다.

- 직접 도입: 보류. 지금 SNS 계정에서 자료를 추천받는 데 게시 스택은 필요하지 않다.
- 재사용 범위: 후속 게시 어댑터의 채널별 payload·미디어 업로드·상태 확인 설계 참고. 코드 복사나 API 호출은 하지 않았다.
- 운영 비용: 여러 서비스의 패치·백업, 채널 OAuth 갱신, SNS별 API 권한·제한, 미디어 저장/전송, 게시 실패 확인.
- 현재 적합성: 별도 서버/호스팅 API로만 검토한다. 비밀 키와 채널 토큰을 정적 JavaScript에 넣지 않는다.
- 전환 조건: 여러 채널에서 반복 게시 부담이 실제 생기고, 초안 검토·게시 확정·실패 재개·철회 범위를 명확히 정한 뒤.
- AI 기획/제작과 게시 실행은 분리한다. Postiz의 존재가 원문 이용 권리나 채널 API 권한을 대신하지 않는다.

공개 보안 확인: [v2.25.3 릴리스](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3)는 두 보안 수정과 즉시 갱신 권고를 담는다.
공식 릴리스가 연결한 [PSA-2026-E9AHFV](https://gadvisory.org/advisories/PSA-2026-E9AHFV)는 파일 경로 문제, [PSA-2026-YT2HMH](https://gadvisory.org/advisories/PSA-2026-YT2HMH)는 서명 토큰 위조 문제다.
[보안 정책](https://github.com/gitroomhq/postiz-app/security)은 최신 릴리스만 지원한다고 안내한다. 정기 패치 운영을 도입 비용에 포함한다.

## 8. 자동화 — n8n과 Temporal

### n8n

[공식 라이선스 설명](https://github.com/n8n-io/n8n-docs/blob/main/docs/n8n-community-license/README.md)에 따라 개인/내부 운영과 고객 대상 제품 내 제공을 구분한다.
작업이 여러 서비스에 분산되어 비개발자가 연결을 관리해야 할 때 검토할 수 있다.
지금의 제한된 공개 수집은 기존 예약 작업으로 시작할 수 있으므로 시각적 workflow 편집기를 먼저 설치하지 않는다.

- 직접 도입: 보류. 후속 개인 운영 연결의 비교 대상으로만 남긴다.
- 재사용 범위: 단계별 실행 이력·오류 분기·자격증명 분리의 설계 참고.
- 운영 비용: 인스턴스·DB·자격증명·실행 데이터 보존·노드 갱신. 큐 모드로 확장하면 Redis와 Worker도 필요하다. [공식 큐 문서](https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode.md).
- 전환 조건: 여러 외부 연결의 변경·관찰 비용이 작은 코드 작업보다 커지고, 실제 이용 형태가 라이선스 범위에 맞을 때.
- n8n을 도입해도 원문/계정 소유 검증이나 외부 게시 중복 방지가 자동 해결되는 것은 아니다.

공개 보안 확인: 2026-10-28 [GHSA-9p7v-45m2-wxgj](https://github.com/n8n-io/n8n/security/advisories/GHSA-9p7v-45m2-wxgj)는 구형 Function·Function Item·LangChain Code 노드를 통한 주 프로세스 코드 실행을 다룬다.
공식 권고는 패치와 노드 교체를 함께 요구하며, 이미 저장된 해당 노드 workflow는 계속 실행될 수 있다고 명시한다.
같은 날 [GHSA-2x68-96jw-5r6c](https://github.com/n8n-io/n8n/security/advisories/GHSA-2x68-96jw-5r6c)는 OracleDB Vector Store의 필터 키 SQL injection을 다룬다.
관련 노드 사용 여부와 브랜치별 패치를 확인해야 한다. 전체 npm 의존성 audit는 실행하지 않았다.

### Temporal

[공식 배포 문서](https://docs.temporal.io/production-deployment)는 workflow를 조정하는 서비스와 실제 코드를 실행하는 Worker 배포를 별개로 둔다.
브라우저 worker·일일 RSS 작업을 장기 내구 workflow 엔진으로 교체할 필요는 현재 확인되지 않았다.

- 직접 도입: 보류. 수일간의 검토 대기·여러 외부 작업·부분 실패 복구가 실제 제품 요구가 될 때 다시 비교한다.
- 재사용 범위: 재시도 가능한 단계, 작업 ID, 결과 영수증, 중복에 안전한 외부 실행을 먼저 작은 코드로 설계한다.
- 운영 비용: Service/Cloud 요금, 계속 실행하는 Worker, 실행 이력 보존, 배포 버전 호환, 관찰과 장애 대응.
- 현재 적합성: 기존 JavaScript 화면을 유지할 수 있으나 별도 서버 실행 환경이 필요하다. 개발용 서버를 운영 구성으로 취급하지 않는다.
- 전환 조건: 작은 작업 기록과 재시도만으로 복구 경계를 설명하기 어려워지고, 내구 실행의 운영 비용을 감당할 근거가 있을 때.

공개 보안 확인: [저장소 advisory API](https://api.github.com/repos/temporalio/temporal/security-advisories?per_page=5)는 조회 당시 빈 결과였다.
[공식 보안 안내](https://temporal.io/security)는 자체 호스팅의 패치·업그레이드·인증 책임을 운영자에게 둔다. Server/SDK/컨테이너 전체의 안전성은 이번에 검증하지 않았다.

## 9. 도입 순서와 검수 완료 기준

1. **지금:** SNS에서 자료를 추천받고 직접 고른 링크를 읽는다. 원문 출처와 개인적으로 도움 된 이유를 확인한다.
2. **해도 연결이 필요할 때:** 선택 링크·확보 범위·언어를 기존 자료/추천/검색 흐름에 연결한다. 새 추천 서버는 추가하지 않는다.
3. **검색 누락이 반복될 때:** 현재 검색과 작은 의미 검색 후보를 같은 질문·자료로 비교한다. 개선이 없으면 기존 방식으로 남긴다.
4. **개인화 평가 근거가 쌓일 때:** Gorse 등 별도 랭킹을 격리 비교한다. 자료 수보다 실제 유용성·추가 운영 부담을 판단한다.
5. **실제 제작·발행 부담이 생길 때:** 선택 원문 → 검토 가능한 초안 → 선택 게시를 먼저 완주하고 Postiz/n8n/Temporal의 필요를 각각 판단한다.

비교 시 동일 후보·동일 질문·동일 원문 확보 범위를 사용하고, 추천 이유와 빠진 자료를 직접 확인한다.
SNS 팔로우/저장만으로 유용한 읽기가 이어지면 그 상태가 완료이며, 자동화 프레임워크를 추가할 이유가 없다.
보안 확인은 공개 자료의 조회 결과다. 설치·실행·침투 시험·전체 전이 의존성 감사·실제 계정 권한 검수는 수행하지 않았다.
이번 변경은 이 조사 문서 한 개이며 런타임·의존성·운영 설정·기존 저장 계약은 바꾸지 않았다.
