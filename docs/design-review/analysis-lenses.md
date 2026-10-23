# 돌아보기 시제품 검토·Local 인계

2026-10-10. 기준 main `29a325b`(Local #62 반영), 독립 브랜치 `codex/analysis-lenses-prototype`. 디자인·화면 통합 책임자는 Codex 한 명이다. 실제 앱 파일·SQL·서비스워커·공개 산출물 허용 목록은 수정하지 않았다. Local의 진행 중인 앱 작업과 함께 적용할 필수 선행 PR은 없다.

## 체험

저장소 루트에서 `python3 scripts/dev-server.py --port 4188`을 실행한 뒤 같은 서버의 `/docs/prototypes/analysis-lenses/`를 연다. HTML 파일을 직접 여는 방식 대신 서버를 사용한다.

1. 관심·질문·변화에서 같은 글들의 다른 해석을 읽는다.
2. 날짜·제목이 붙은 인용을 눌러 정확한 원문과 강조 구절을 확인한다. Escape로 닫으면 호출 버튼으로 돌아온다.
3. ‘내 해석 쓰기’에서 자신의 설명을 적고 ‘장 후보 담기’를 누른다. 빈 입력은 담지 않는다.
4. 다른 관점에 갔다가 돌아와 입력이 유지되는지 확인한다. ‘보류’하면 후보에서도 빠지며 입력은 보존된다.
5. 상단 장 후보에서 JSON·Markdown을 받는다. 실제 책 파일이나 백업은 아니다. 새로고침 전에 파일로 받는다.
6. 기간을 2018–2021로 좁혀 근거 부족을 확인한다. `?case=error`는 인용 오류·복구, `?case=loading`은 자료 여는 상태를 검토하는 주소 옵션이다.

## 화면 방향과 증거

본문 한 열, 얕은 보라색 선택 상태, 기존 A 인용 아이콘을 유지했다. 상시 분석 수치·성격 유형·보조 패널은 넣지 않았다. 원문·예시 제안·사용자 입력·다른 설명을 텍스트 계층으로 구별한다. 모바일 긴 제목은 자연스럽게 줄바꿈하고 단어가 넘치면 안전하게 꺾는다.

- [관심 1440px](evidence/analysis-lenses/interests-1440.png)
- [질문 820px](evidence/analysis-lenses/questions-820.png)
- [변화 390px](evidence/analysis-lenses/changes-390.png)
- [원문 확인](evidence/analysis-lenses/source-820.png) · [후보 확인](evidence/analysis-lenses/candidates-820.png)
- [빈 상태](evidence/analysis-lenses/empty-390.png) · [오류 상태](evidence/analysis-lenses/error-390.png) · [로딩](evidence/analysis-lenses/loading-390.png)
- [브라우저 수치·검사 기록](evidence/analysis-lenses/report.json)
- [받은 JSON](evidence/analysis-lenses/candidate.json) · [받은 Markdown](evidence/analysis-lenses/candidate.md) — 익명 테스트 문자열 포함

실제 스크린샷을 검토해 제목 위 장식 문구와 중복 소개 문장을 줄였다. 의미 검토에서는 두 글만으로 관심의 전환 시점을 단정하던 문장을 두 표현을 함께 읽는 제안으로 고쳤다. 보류 후 다시 열 때 입력란으로 키보드 초점이 돌아오도록 보완했다. 1440·820·390px에서 관점 3개, 총 9개 본문 상태를 확인했다. 기본 본문 폭은 700px이고 작은 화면은 좌우 20px이다. 한글 글꼴은 기존 스택을 사용한다. 화면의 근거는 짧은 익명 문장이므로 실제 수백 건 분석 화면의 밀도나 장문 성능을 입증한 것은 아니다.

## 검증 결과

- `npm run check`: HTML 18 / JavaScript 59 / 로컬 참조 271 / PWA 통과. 이 검사는 루트 HTML 중심이므로 시제품 HTML의 리소스와 동작은 아래 별도 브라우저 검사로 확인했다.
- `npm test`: 405/405, 신규 근거·후보 계약 7개 포함.
- `tests/analysis-lenses-browser.cjs`: 10개 흐름, 관점×폭 9개. Chromium 151에서 콘솔·페이지 오류 0, 외부 요청 0. 텍스트 대비 최저 6.05:1, 검사한 이름 있는 조작 대상 최소 44px, 가로 넘침 없음.
- 키보드 탭 ArrowRight/End, 원문 Escape 초점 복귀, 터치 모사 탭 조작, 한글·이모지 입력 보존, 안전한 평문 렌더링, 후보 JSON/Markdown 내용, 보류·복귀, 오류 거절·재시도 확인.
- 격리 컨텍스트의 기존 localStorage 표식 불변, 새 IndexedDB 0, 서비스워커 등록 0. 실제 개인 저장소는 열지 않았다.
- `scripts/prepare-site.mjs`를 명시적 가짜 공개 설정으로 실행하고 산출물에 시제품 경로가 없는 것을 확인했다. 실제 서비스 연결 검사가 아니다.
- 기존 로그인·원문·저장·동기화·백업·공개 코드는 변경하지 않았다. Node 회귀 통과와 별개로 이 작업에서 실계정·운영 HTTP 동기화를 반복하지 않았다.

자동 시각 수치와 사람의 내용·배치 검토는 별개다. **실제 Apple 기기·한글 IME 조합·Files 저장·개인 자료·모델의 의미 정확도는 미검증**이다. 터치와 화면 크기 모사를 실제 iPad/iPhone 검증으로 표현하지 않는다.

## 재현과 Local 처리

```sh
npm run check
npm test
# 이미 설치된 Playwright를 사용하거나 저장소의 고정된 테스트 도구 설치
npm ci --prefix tests/browser-ci --ignore-scripts
# 앞서 시작한 4188 서버에서 실행. Chromium 경로는 로컬 설치에 맞게 지정
CHROMIUM_PATH=/usr/bin/chromium node tests/analysis-lenses-browser.cjs
```

별도 설치 경로를 쓰면 `PLAYWRIGHT_MODULE=/절대/경로/playwright`를 지정한다. `BASE_URL`과 `EVIDENCE_DIR`도 변경 가능하다. 전용 `analysis-lenses.yml`은 기존 고정 버전 Playwright로 동일 검사를 수행하고 익명 결과를 artifact로 보관한다. 기존 배포 workflow는 변경하지 않았다.

Local은 독립 초안 PR의 새 파일만 검토할 수 있다. 이 작업은 운영 SQL·환경 키·계정 설정을 요구하지 않는다. 병합·배포는 Local 담당이며 시제품은 병합해도 공개 산출물에 들어가지 않는다. 실제 화면 적용은 후속 별도 변경이다. 후보 JSON은 프로덕션 백업 가져오기에 넣지 않는다.

[관점·근거 계약·공식 참고·다음 우선순위](../life-tools-design/analysis-lenses.md)
