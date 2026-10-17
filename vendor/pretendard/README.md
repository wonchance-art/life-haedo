# Pretendard Variable

- 확인일: 2026-10-17.
- 공식 저장소: https://github.com/orioncactus/pretendard
- 최신 공식 릴리스 확인: v1.3.9, 2023-11-05. https://github.com/orioncactus/pretendard/releases/tag/v1.3.9
- 저장소의 최신 커밋은 확인 시점 2025-06-28. 릴리스 이후 변경을 섞지 않고 공식 태그의 배포 파일을 그대로 보관한다.
- 원본 글꼴: https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2
- 원본 라이선스: https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/LICENSE.txt
- 라이선스: SIL Open Font License 1.1. Copyright (c) 2021, Kil Hyung-jin. Reserved Font Name: Pretendard. 동봉된 `LICENSE.txt` 원문을 유지한다.
- 크기: 2,057,688 bytes.
- SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.

선택 근거: 기존 시스템 글꼴은 추가 다운로드가 없지만 기기별 한글·영문 조합과 굵기가 달라진다. Pretendard는 한글·영문을 함께 쓰는 현대적 읽기 화면에 맞고 가변 글꼴 한 파일로 필요한 굵기를 지원한다. 다른 후보인 SUIT는 공식 최신 v2.0.5(2024-07-24), SIL OFL 1.1로 적합하지만, 이번 화면은 Pretendard의 Inter/본고딕 기반 조합을 재사용한다. 별도 글꼴 제작이나 두 글꼴 동시 도입은 유지·다운로드 비용을 더하므로 하지 않는다. 시스템 글꼴은 로딩 전·실패 시 대체 글꼴로 유지한다.

- SUIT 비교 출처: https://github.com/sun-typeface/SUIT/releases/tag/v2.0.5 , https://raw.githubusercontent.com/sun-typeface/SUIT/v2.0.5/LICENSE
- Pretendard 설명: https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/README.md
- 공개 보안 권고 확인: https://api.github.com/repos/orioncactus/pretendard/security-advisories 에서 확인 시점 공개 권고 0건. 이는 별도 보안 감사를 뜻하지 않는다.

검증: WOFF2 헤더와 파일 길이를 확인했고 FontTools로 디코딩했다. 내부 family는 `Pretendard Variable`, PostScript 이름은 `PretendardVariable-Regular`, `wght` 축은 45–930(기본 400), glyph 14,757개다. 현대 한글 완성형 U+AC00–U+D7A3 전체와 화면의 한글 표본을 포함한다. 공식 배포 CSS의 선언 범위는 45–920이며, 앱에서는 통상적인 100–900 범위로 사용할 수 있다. 원본 수정·서브셋 재생성은 하지 않았다.

로컬 파일만 참조하여 실행 중 외부 글꼴/CDN 요청을 만들지 않는다. `font-display: swap`과 시스템 대체 글꼴을 사용하며, 약 2 MB 파일의 첫 로딩 비용은 남는다. 현재 `haedo-v123` 서비스 워커는 글꼴 선언 CSS와 WOFF2를 앱 셸과 함께 캐시하므로 최초 설치에 해당 다운로드 비용이 포함된다. 캐시 응답의 SHA-256이 배포 파일과 같은지 확인했고, Chromium에서 HTTP 캐시와 네트워크를 끈 상태로 서비스 워커 응답을 받아 새 FontFace의 한글 로딩을 확인했다. 이 확인은 Apple 기기나 실제 배포 검증을 대신하지 않는다.
