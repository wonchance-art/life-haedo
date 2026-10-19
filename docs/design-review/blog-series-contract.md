# 모음 모델·저장 계약

2026-10-18. 비공개 모음은 기존 글·묶음·책을 변환하지 않는다. 처음에는 저장한 PhotoPost v1/v2(사진 없는 글 포함)만 선택한다.

- `BlogSeries.empty(workspaceId)` → `{format:'life-blog-series-v1',workspaceId,revision:0,series:[]}`.
- 모음: `{id,title,intro,createdAt,updatedAt,items:[{id,postId,postRevision,title}]}`. 항목 순서가 목차다. 한 공간 20모음, 한 모음 20글. 제목 500자·소개 10,000자.
- `readBlogSeries(ws)` / `saveBlogSeries(ws,input,baseRevision)` → 전체 모음 상태. 저장 성공은 revision을 1 올리며 원본 글을 수정하지 않는다. 항목의 원래 글 ID·revision·제목은 고정한다. 교체는 새 항목으로 명시 선택한다.
- 새 항목은 같은 계정·공간의 현재 저장 글을 같은 트랜잭션에서 검증해 compact 사본으로 캡처한다. 충돌 복구의 새 모음은 이미 보존한 동일 ID·revision·제목의 정확 사본만 재사용할 수 있다. 임의 캡처 입력을 받지 않는다.
- `readBlogSeriesSnapshot(ws,seriesId)` → `{series,posts:[{itemId,doc}]}`. posts 순서는 목차와 같다. 원글 수정·보관·삭제 이후에도 이 고정 본문과 원본 사진으로 읽는다. 누락된 사본을 최신 글로 대체하지 않는다.
- `installBlogSeriesCopy(ws,{series,posts})` → `{seriesId,revision}`. 파일을 검증한 뒤 새 모음/항목/글/사진 ID로 현재 계정의 공간에 원자 설치한다. 모음 전용 사본이며 일반 글 목록에는 추가하지 않는다. 원본·기존 모음·서버/공개 연결은 그대로 둔다.
- 본문에 넣은 인용·출처 문자열은 보존한다. 구조화 인용 sidecar·정확 원문 본문은 이번 모음 파일에서 제외한다. 그 이동에는 기존 근거 전용 ZIP을 사용한다. 파일 내보내기와 공개는 별개다.

메타데이터 키는 기존 `meta` 안의 `blog-series:<ws>`와 `blog-series-post:<ws>:<seriesId>:<itemId>`다. 새 저장소나 DB 버전을 추가하지 않는다. 모델 검증은 `BlogSeries.validate`, `validateSeries`, `validateSnapshot`을 사용한다. 공개 목차는 별도의 기존 ShareRemote 경로를 사용하며 이 비공개 저장 API가 자동 공개하지 않는다.
