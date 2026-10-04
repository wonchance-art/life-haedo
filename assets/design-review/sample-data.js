/* Anonymous proposal content. No production records, persistence, or network access. */
(function () {
  'use strict';

  const sources = [
    {
      id: 'source-01',
      title: '다시 읽고 싶은 문장을 모으는 방법',
      origin: 'apple-notes',
      originLabel: 'Apple 메모',
      importedLabel: '10월 2일 가져옴',
      dateLabel: '2026년 9월 28일 작성',
      version: 'v2 · 최근 가져온 버전',
      coverage: 'full',
      topic: '읽기와 기록',
      summary: '문장을 저장하는 순간부터 다시 찾고 내 생각으로 연결하기까지, 읽기 기록을 정리하는 작은 기준.',
      paragraphs: [
        '책을 읽다가 좋은 문장을 만나면 일단 사진을 찍거나 메모에 옮겨 두었다. 그때는 분명 다시 읽을 것 같았는데, 며칠만 지나도 어느 책에서 본 말인지 기억나지 않았다. 검색창에 떠오르는 단어를 넣어 보아도 사진 속 문장과 짧은 메모, 블로그에 남긴 감상이 따로 나타났다. 이번에는 더 많이 모으기보다 이미 모아 둔 문장을 다시 읽을 수 있는 상태로 만들고 싶다.',
        '기록을 남기는 것보다 다시 만날 수 있게 만드는 일이 더 중요했다. 문장만 떼어 두면 처음에 왜 마음이 움직였는지 알기 어렵다. 같은 문장이라도 앞뒤 문단을 함께 읽으면 전혀 다른 뜻으로 다가온다. 마음에 드는 부분은 짧게 발췌하되, 언제든 원문의 그 자리로 돌아갈 수 있으면 좋겠다. 출처를 채우는 일은 정리의 마지막 단계가 아니라 읽기의 일부에 가깝다.',
        '지난주에는 걷기에 관한 글 세 편을 나란히 읽었다. 한 글은 이동 속도를 늦추는 이야기였고, 다른 글은 동네에서 계절을 알아차리는 이야기였다. 마지막 글에서는 매일 같은 길을 지나도 눈에 들어오는 것이 달라진다고 했다. 처음에는 모두 산책이라는 이름으로 묶었지만, 다시 읽으니 내가 관심을 둔 것은 걷는 거리보다 주의를 기울이는 방식이었다. 같은 주제에 넣었다는 이유만으로 서로 같은 생각이라고 단정하지 않아야겠다.',
        '다시 찾을 때 필요한 단서\n제목, 출처, 내 짧은 메모를 먼저 보이게 해 보자. 작성일을 모르는 자료는 가져온 날짜로 바꾸지 않고 그대로 모른다고 남긴다. 글의 일부만 가져왔다면 어디까지 있는지도 표시한다. 숫자와 상태 표시를 모두 첫 줄에 놓으면 정작 읽고 싶은 제목을 찾기 어렵다. 자주 쓰는 단서를 앞에 두고, 버전과 수집 경로 같은 자세한 정보는 필요할 때 열어 볼 수 있으면 충분하다.',
        '발췌를 만드는 날에는 문장 옆에 한 줄만 적어 보기로 했다. “좋았다”에서 끝내지 않고 왜 지금 이 문장을 골랐는지 쓰는 것이다. 오래 붙잡고 있었던 질문과 닮아서인지, 전에 읽은 글과 반대되는 주장이라서인지 구별해 본다. 내 메모가 원문처럼 보이지 않는 것도 중요하다. 작가가 쓴 문장과 내가 덧붙인 해석 사이에는 작지만 분명한 경계가 있어야 한다.',
        '긴 글을 읽는 화면에서는 조작 버튼이 계속 말을 걸지 않았으면 한다. 읽는 줄의 폭이 지나치게 넓지 않고, 문단 사이에서 한 번씩 숨을 고를 수 있으면 좋겠다. 필요한 문장을 선택했을 때 발췌 위치를 확인하고, 짧은 메모를 적은 뒤 읽던 곳으로 돌아온다. 태블릿을 세로로 들었을 때에는 원문과 메모가 위아래로 자연스럽게 이어지고, 넓게 펼쳤을 때에는 둘을 나란히 비교할 수 있으면 편하겠다.',
        '일주일 뒤 같은 자료를 열어 보니, 첫날의 메모에 지금은 동의하지 않는 부분이 있었다. 생각이 달라졌다고 예전 메모를 지울 필요는 없었다. 어떤 문장을 먼저 읽었고 무엇을 새로 연결했는지 남겨 두니 변화 자체가 다음 읽기의 단서가 됐다. 원문이 수정된 경우에도 예전에 발췌한 문장이 어느 버전을 기준으로 했는지 확인할 수 있어야 한다. 최신 글로 바뀌었다는 이유로 내 발췌의 근거까지 조용히 바뀌어서는 안 된다.',
        '이번 주에는 분류를 완성하려 하지 않고 세 가지를 해 보기로 했다. 찾지 못했던 문장 하나에 출처를 붙이고, 긴 글 하나에서 다시 읽을 부분을 골라 두고, 서로 다른 곳에 있던 기록 두 개를 같은 질문 옆에 놓아 본다. 모든 자료를 한 번에 정리하는 일보다 지금 궁금한 것을 더 잘 이해하는 일이 먼저다. 그렇게 남긴 연결이 다음에 이 자료를 열었을 때에도 읽을 만한 길이 되었으면 한다.'
      ],
      url: 'https://example.invalid/notes/reading-collection'
    },
    {
      id: 'source-02',
      title: '흩어진 읽기 기록을 한 주에 한 번 돌아보기',
      origin: 'obsidian',
      originLabel: 'Obsidian',
      importedLabel: '10월 2일 가져옴',
      dateLabel: '2026년 9월 30일 작성',
      version: 'v1',
      coverage: 'full',
      topic: '읽기와 기록',
      summary: '미완성 메모를 정답처럼 다듬기 전에, 이번 주에 되풀이해서 나타난 질문을 찾는다.',
      paragraphs: [
        '금요일 저녁에 이번 주 읽기 기록을 열었다. 새 폴더를 만드는 대신 같은 질문이 두 번 이상 나온 메모를 찾아 표시했다. 제목이 완성되지 않은 메모도 읽어 보니 지난달의 생각과 이어지는 부분이 있었다.',
        '한 문장 요약은 원문을 대신하지 않는다. 연결한 이유를 적고, 원문 위치가 없는 기록은 확인이 필요한 상태로 남겨 둔다. 다음에 할 일은 링크를 더 만드는 것이 아니라 그 연결이 여전히 도움이 되는지 읽어 보는 것이다.'
      ],
      url: 'https://example.invalid/vault/weekly-reading'
    },
    {
      id: 'source-03',
      title: '천천히 걷다가 발견한 동네의 작은 도서관',
      origin: 'naver-blog',
      originLabel: '네이버 블로그',
      importedLabel: '10월 1일 가져옴',
      dateLabel: '2026년 9월 21일 작성',
      version: 'v1',
      coverage: 'partial',
      topic: '걷기와 관찰',
      summary: '산책 중 만난 도서관에 관한 글. 가져온 범위는 첫 두 문단이며 사진과 나머지 본문은 포함하지 않았다.',
      paragraphs: [
        '늘 지나던 골목에서 작은 도서관 안내판을 처음 보았다. 문이 새로 생긴 것도 아닌데 그날은 발걸음이 느려서 눈에 들어온 것 같다. 안쪽 창가에 놓인 책 한 권을 읽다가 산책 기록에 책 제목을 덧붙였다.',
        '집에 돌아와서는 길을 자세히 설명하기보다 내가 어디에서 멈췄는지 적었다. 돌아오는 길에 들리는 소리도 조금 달랐다. 같은 길을 반복해서 걷는 일이 단순한 반복만은 아니라는 생각이 들었다.'
      ],
      url: 'https://example.invalid/blog/neighborhood-library'
    },
    {
      id: 'source-04',
      title: '창가의 책과 짧은 문장 — 사진 설명에서 가져온 기록',
      origin: 'instagram',
      originLabel: '인스타그램',
      importedLabel: '10월 1일 가져옴',
      dateLabel: '작성일 모름',
      version: 'v1',
      coverage: 'partial',
      topic: '읽기와 기록',
      summary: '사진 설명의 텍스트만 보관했다. 이미지와 댓글, 원래 게시일은 이 자료에 포함되어 있지 않다.',
      paragraphs: [
        '오늘 읽은 부분을 다 기억하려고 하지 않기로 했다. 창가에서 오래 머물렀던 문장 하나와 그때의 생각만 기록한다. 다음에 펼쳤을 때의 나는 같은 곳에서 멈출까.'
      ],
      url: 'https://example.invalid/posts/window-reading'
    },
    {
      id: 'source-05',
      title: '좋은 문장을 모으는 일에서 시작해 서로 다른 책과 산책 메모와 오래된 블로그 글 사이의 연결을 발견하고 지금 나에게 필요한 질문으로 돌아오기까지의 읽기 기록 정리 실험',
      origin: 'apple-notes',
      originLabel: 'Apple 메모',
      importedLabel: '9월 30일 가져옴',
      dateLabel: '2026년 9월 25일 작성',
      version: 'v1',
      coverage: 'full',
      topic: '자료 연결',
      summary: '긴 제목을 아직 줄이지 않은 초안. 자료의 분류보다 다시 읽는 목적을 먼저 적어 보는 실험이다.',
      paragraphs: [
        '기록을 깔끔하게 정리하려고 하면 폴더 이름부터 오래 고민하게 된다. 이번에는 찾고 싶은 질문을 먼저 쓰고, 그 질문에 도움이 될 만한 자료를 놓아 보았다. 책 메모와 산책 메모가 예상하지 못한 지점에서 이어졌다.',
        '연결이 생긴 이유를 한 줄로 설명할 수 없다면 잠시 후보로 남긴다. 제목이 길어도 핵심 문장이 잘리지 않게 읽을 수 있어야 비교하기 쉽다. 요약은 줄일 수 있지만 원문은 그대로 보존한다.'
      ],
      url: 'https://example.invalid/notes/connecting-reading'
    },
    {
      id: 'source-06',
      title: '발췌와 내 생각을 구별하는 표기',
      origin: 'obsidian',
      originLabel: 'Obsidian',
      importedLabel: '9월 30일 가져옴',
      dateLabel: '2026년 9월 24일 작성',
      version: 'v3',
      coverage: 'full',
      topic: '원문과 출처',
      summary: '인용한 문장, 출처 위치, 내가 적은 메모를 나누어 읽기 위한 기록 기준.',
      paragraphs: [
        '따옴표를 썼다는 이유만으로 정확한 발췌가 되는 것은 아니다. 원문을 줄이거나 문장 순서를 바꾸었다면 그 사실을 기록해야 한다. 가능한 경우에는 선택한 원문을 그대로 두고 내 요약을 다른 칸에 적는다.',
        '출처를 다시 열었을 때 선택한 문장이 어디에 있었는지 알 수 있어야 한다. 원문 버전이 달라졌다면 바뀐 사실을 보여 주고, 이전 문장을 근거 없이 새 문장에 연결하지 않는다.'
      ],
      url: 'https://example.invalid/vault/quotation-and-note'
    },
    {
      id: 'source-07',
      title: '읽다 만 책을 다시 펼치는 주말',
      origin: 'naver-blog',
      originLabel: '네이버 블로그',
      importedLabel: '9월 29일 가져옴',
      dateLabel: '2026년 9월 20일 작성',
      version: 'v1',
      coverage: 'full',
      topic: '읽기와 기록',
      summary: '완독 여부보다 마지막으로 머물렀던 질문을 단서로 삼아 읽기를 이어 간다.',
      paragraphs: [
        '책갈피가 꽂힌 쪽을 펼쳤지만 어디까지 읽었는지보다 왜 멈췄는지가 궁금했다. 예전에 남긴 기록에는 이해되지 않는 문장 하나와 물음표가 있었다. 처음부터 다시 읽는 대신 그 앞의 두 문단부터 읽었다.',
        '한 번에 끝내지 못한 읽기도 이어질 수 있다. 이전 메모가 지금의 생각과 맞지 않더라도 지우지 않고 옆에 새로 적었다. 기록이 남아 있으니 같은 자리에서 달라진 점을 볼 수 있었다.'
      ],
      url: 'https://example.invalid/blog/returning-to-a-book'
    },
    {
      id: 'source-08',
      title: '다시 읽고 싶은 문장을 모으는 방법',
      origin: 'apple-notes',
      originLabel: 'Apple 메모',
      importedLabel: '9월 27일 가져옴',
      dateLabel: '2026년 9월 26일 작성',
      version: 'v1 · 이전 버전',
      coverage: 'full',
      topic: '읽기와 기록',
      summary: '첫 번째로 가져온 버전. 이후에 고친 원문과 구별해 발췌 당시의 내용을 확인할 수 있도록 남겼다.',
      paragraphs: [
        '좋은 문장을 찾으면 한곳에 모아 두기로 했다. 지금은 책 사진과 짧은 기록이 여러 메모에 흩어져 있어서 다시 읽으려면 찾는 데 시간이 걸린다.',
        '먼저 제목과 출처를 붙이고 비슷한 문장을 옆에 놓아 보자. 정리 방식은 사용하면서 바꿀 수 있으니 원문을 잃지 않는 것이 우선이다.'
      ],
      url: 'https://example.invalid/notes/reading-collection'
    },
    {
      id: 'source-09',
      title: '독서 공간을 천천히 둘러보는 글',
      origin: 'instagram',
      originLabel: '인스타그램',
      importedLabel: '9월 27일 가져옴',
      dateLabel: '작성일 모름',
      version: 'v1',
      coverage: 'link',
      topic: '읽기와 기록',
      summary: '원문 링크와 직접 붙인 제목만 보관했다. 본문·사진·게시일은 가져오지 않아 이 자료에서 발췌할 수 없다.',
      paragraphs: [],
      url: 'https://example.invalid/posts/reading-space'
    },
    {
      id: 'source-10',
      title: '태그가 많아졌을 때 남겨 둘 질문',
      origin: 'obsidian',
      originLabel: 'Obsidian',
      importedLabel: '9월 26일 가져옴',
      dateLabel: '2026년 9월 22일 작성',
      version: 'v2',
      coverage: 'full',
      topic: '자료 연결',
      summary: '분류를 늘리는 대신 실제로 다시 찾을 때 쓰는 말과 연결의 이유를 점검한다.',
      paragraphs: [
        '태그가 많다고 기록을 잘 찾는 것은 아니었다. 비슷한 뜻의 이름이 늘어나면서 어느 것을 눌러야 할지 망설이게 됐다. 최근에 다시 찾은 자료를 살펴보니 제목의 한 단어와 내 메모가 더 좋은 단서였다.',
        '이번에는 태그를 일괄 삭제하지 않고 자주 사용하는 질문을 모아 보기로 했다. 기존 연결은 보존하고, 같은 뜻으로 쓰였는지는 원문을 읽으며 천천히 판단한다.'
      ],
      url: 'https://example.invalid/vault/questions-before-tags'
    },
    {
      id: 'source-11',
      title: '비 오는 날의 산책, 소리로 남긴 짧은 관찰',
      origin: 'naver-blog',
      originLabel: '네이버 블로그',
      importedLabel: '9월 25일 가져옴',
      dateLabel: '2026년 9월 18일 작성',
      version: 'v1',
      coverage: 'partial',
      topic: '걷기와 관찰',
      summary: '산책 글의 마지막 두 문단을 가져왔다. 앞부분과 첨부된 소리는 포함하지 않았다.',
      paragraphs: [
        '우산 가장자리에서 떨어지는 물소리가 걸음의 속도를 바꾸었다. 평소에는 사진으로 남겼을 장면을 오늘은 짧은 문장으로 기록했다. 보이는 것보다 들리는 것을 먼저 적으니 익숙한 길이 다르게 느껴졌다.',
        '돌아와서 지난 산책 메모를 찾아보았다. 같은 장소를 적었지만 그때에는 빛에 관한 말이 많았다. 두 기록을 나란히 두고 어느 쪽도 다른 쪽을 대신하지 않게 남겨 두었다.'
      ],
      url: 'https://example.invalid/blog/rain-and-listening'
    },
    {
      id: 'source-12',
      title: '오늘의 밑줄: 서두르지 않고 읽기',
      origin: 'instagram',
      originLabel: '인스타그램',
      importedLabel: '9월 24일 가져옴',
      dateLabel: '2026년 9월 17일 작성',
      version: 'v1',
      coverage: 'partial',
      topic: '읽기와 기록',
      summary: '사진 설명으로 남긴 짧은 독서 기록. 책 이름과 쪽수는 가져온 텍스트에서 확인되지 않는다.',
      paragraphs: [
        '빨리 읽은 날보다 한 문단을 오래 읽은 날의 기록이 더 오래 남는다. 오늘은 밑줄을 더 긋지 않고, 이미 고른 문장 옆에 지금 떠오르는 질문을 적었다. 책 이름과 쪽수는 다시 확인해서 덧붙일 예정이다.'
      ],
      url: 'https://example.invalid/posts/reading-slowly'
    }
  ];

  for (const source of sources) {
    Object.freeze(source.paragraphs);
    Object.freeze(source);
  }

  globalThis.HaedoDesignData = Object.freeze({
    sources: Object.freeze(sources),
    excerpt: '기록을 남기는 것보다 다시 만날 수 있게 만드는 일이 더 중요했다.',
    topics: Object.freeze(['읽기와 기록', '걷기와 관찰', '자료 연결', '원문과 출처'])
  });
}());
