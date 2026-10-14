# 영화·예술 작품·인물 제공자 비교

확인일: 2026-10-14 KST. 이번 작업은 비교·선택 기준 정리이며 새 제공자 연결 완료가 아니다. Open Library 판본과 기존 GitHub 외의 검색 요청은 앱에 추가하지 않았다.

[작품 링크 수동 검토 후속](artwork-reference.md): 출처 형식만 로컬에서 식별해 예술 작품 입력으로 연결했다. API/이미지는 추가하지 않았고 `api.artic.edu`·`www.artic.edu` 환경 설정 초안을 저장했다. 적용과 공식 API/약관 검증은 남아 있다.

## 추천 순서

1. **예술 작품: Art Institute of Chicago를 먼저 작은 실험으로 검증.** 작품 검색과 창작자, 제작 시기, 소장처, 출처 링크를 얻는 흐름이 현재 첨부에 가장 잘 맞는다. 이미지 없는 메타데이터부터 시작하고, 이미지는 작품별 권리 확인 후 별도 요청한다.
2. **인물: Wikidata의 동명이인 구분을 먼저 검증.** 이름만 고르지 않고 설명·직업·관련 작품·원천 링크로 구분해야 한다. 생년/국적 등의 추정을 사용자 소개에 자동 반영하지 않는다. 영화도 제목·연도·감독을 구분하는 후보로 검토할 수 있다.
3. **영화: TMDB의 현재 이용 조건과 키 보관 경로 확인 후 비교.** 포스터/한글 제목/개봉 시기 같은 풍부한 화면 가능성만으로 도입하지 않는다. 정적 앱에 관리자 API 비밀을 넣지 않고, 이용 조건에 맞는 출처 표시와 언어별 품질을 확인해야 한다.

각 제공자는 메타데이터 API, 이미지 권리, 서버 코드 라이선스를 별도로 판단한다. 앱에 첨부했다는 사실은 공개 권리·개인적 동의·감상 완료가 아니다.

## 확인된 근거와 미확인 부분

| 후보 | 이번에 직접 확인한 공식 근거 | 적합성·추가 확인 |
| --- | --- | --- |
| Art Institute of Chicago | [공식 API 문서 원본](https://github.com/art-institute-of-chicago/data-aggregator/blob/780e6c86025d5f80387dac7574d0f056bf26ff1a/docs/.sections/preface.md): `artworks/search?q=…`, `fields`, 명시 pagination, 익명 60회/분, API/이미지 CORS `*`, 작품별 `is_public_domain`. [공식 소스](https://github.com/art-institute-of-chicago/data-aggregator) AGPL-3.0, 미보관, push 2026-10-13 UTC. [최신 GitHub release 1.15](https://github.com/art-institute-of-chicago/data-aggregator/releases/tag/1.15) 2026-08-27. develop과 배포 릴리스는 구분한다. | API 전체를 자체 호스팅할 이유는 없다. 기존 평문 후보·검토·첨부 구조 재사용 후보. 문서는 최종 법적 판단을 Image Licensing/Terms로 넘기며 non-public-domain 이미지도 반환될 수 있다고 경고한다. `is_public_domain`을 모든 이미지의 자유 이용으로 확대하지 않는다. 한국어 검색·실제 HTTP/CORS·현재 이미지 약관 재확인 필요. |
| The Metropolitan Museum of Art | [공식 Open Access README](https://github.com/metmuseum/openaccess/blob/6fa206f0df6cf349d4fe558028d4c08e95f44eb6/README.md), [LICENSE](https://github.com/metmuseum/openaccess/blob/6fa206f0df6cf349d4fe558028d4c08e95f44eb6/LICENSE): 선택 메타데이터 CC0-1.0, 미보관, push 2026-08-16 UTC. **CSV에 이미지가 포함되지 않으며 저작권이 있는 작품의 식별 자료도 포함된다**고 명시. 수정·번역한 자료는 변경 사실을 밝혀야 한다. | 출처/소장처가 분명한 작품 모음에 적합. 전체 CSV를 앱에 복사하는 방식은 이번 정적 앱의 작은 선택기에 과도하다. 현재 API 검색·한국어 품질·이미지 사용 조건은 별도 검증 후 결정. |
| Wikidata / Wikibase | [공식 Wikibase COPYING](https://github.com/wikimedia/mediawiki-extensions-Wikibase/blob/master/COPYING): 기본 GPL v2 및 하위 디렉터리 별도 라이선스 안내. 미보관, push 2026-10-13 UTC. | Wikibase 소프트웨어 라이선스를 Wikidata 데이터/이미지 권리로 해석하지 않는다. 현재 Wikidata 데이터 약관과 한국어 검색/동명이인 선택 실험은 미확인. 서버 도입 없이 공개 entity 후보만 검토하는 설계가 우선. |
| TMDB | [공식 FAQ](https://developer.themoviedb.org/docs/faq)를 검토 대상으로 지정했으나 현재 환경의 CONNECT 403으로 본문을 읽지 못했다. | 현재 키 발급·배포 허용 범위·상업/비상업 조건·출처 표시·이미지 사용을 **확인 완료로 보고하지 않는다**. 이 단계에서 키를 요청하거나 비공식 wrapper를 설치하지 않는다. |

AIC와 Met의 GitHub 공개 보안 권고 목록은 이번 조회에서 각각 0건이었다. 이는 공개 목록 확인일 뿐 운영 서비스·이미지·의존성의 안전성 보증이 아니다. Wikibase의 서버 코드를 도입하지 않으므로 데이터 조회 허용과 서버 보안 검토를 혼동하지 않는다.

`api.artic.edu/docs/`, `metmuseum.github.io/`, `developer.themoviedb.org/docs/faq`, `www.wikidata.org/wiki/Wikidata:Licensing`는 이번 Cloud 환경에서 CONNECT 403이었다. 차단을 우회하거나 동일 요청을 반복하지 않았다. 허용된 GitHub의 공식 저장소에서 확인한 내용만 위 표의 근거로 사용했다. 해당 API 호출·실제 제품 화면을 확인한 것으로 보고하지 않는다.

## 다음 실험의 완료 기준

- 사용자가 누른 검색 한 번 → 후보 6개 이내 → 제목/동명이인/출처 확인 → 수정 → 첨부. 입력 중 외부 요청 없음.
- 동일한 한국어 질문 5개와 원어 이름 5개로 빈 결과·동명이인·다른 작품이 섞이는 비율을 기록. 빈 결과를 임의 번역/이미지로 채우지 않는다.
- API 이용 조건과 자격 증명 배포 범위가 확인된 제공자만 연결한다. 검색어/원문/개인 메모를 외부 AI로 보내지 않는다.
- 한 제공자씩 기존 도메인 어댑터에 연결하고 영화·인물·작품을 하나의 자동 유형 추정으로 합치지 않는다.
- 출처 링크만으로 충분한 경우 수동 입력을 유지한다. 사진·포스터·작품 이미지에는 별도 권리·요청 검토가 필요하다.
