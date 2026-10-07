(function (root) {
  'use strict';

  // Fictional, anonymous texts written for the standalone A/B comparison.
  // These are not imported records, a public copy, or quotations from real books.
  const paragraphs = values => values.join('\r\n\r\n');
  const gardenOld = [
    '전시실을 나왔을 때는 작품의 제목보다 오래 서 있던 자리부터 떠올랐다. 큰 그림 앞에서는 뒤로 물러났고, 작은 드로잉 앞에서는 한 걸음 다가갔다. 무엇을 보았는지 적기 전에 내가 어떻게 움직였는지부터 기록해 보기로 했다.',
    '첫 방에는 나무의 그림자가 여러 방향으로 겹쳐 있었다. 설명을 읽고 다시 보니 처음에는 빈 공간처럼 느껴졌던 부분이 가지 사이의 틈이었다. 작품을 이해했다기보다 두 번째로 보는 속도가 조금 느려졌다고 적는 편이 정확하겠다.',
    '다음 방의 작은 종이 작업에는 지운 흔적이 남아 있었다. 완성된 선만 찾다가 연한 자국을 놓쳤다는 사실이 마음에 걸렸다. 작업 과정이 보이는 곳에서는 정답을 찾는 대신 이전 선택이 어떻게 남아 있는지 살펴보게 된다.',
    '전시장 한쪽의 의자에 앉아 메모를 다시 읽었다. 좋았다는 말이 세 번이나 나왔지만 각각 무엇이 좋았는지는 없었다. 하나는 종이의 질감으로, 하나는 눈을 쉬게 하는 간격으로, 나머지는 아직 설명하지 못하는 느낌으로 바꾸었다.',
    '밖으로 나와 건물 뒤의 정원으로 걸었다. 🌱 낮은 화단의 새잎에는 먼지가 조금 묻어 있었고, 그 옆의 오래된 잎은 빛을 더 매끄럽게 반사했다. 전시실에서 보던 겹친 그림자가 실제 잎 사이에서도 보였지만 두 장면을 같은 의미라고 묶지는 않았다.',
    '정원 길은 예상보다 짧았다. 빠르게 한 바퀴 돌면 다시 입구에 닿겠지만, 길 가장자리의 돌을 따라 걸으니 방향을 바꾸는 지점이 여럿 보였다. 멀리 가는 일보다 같은 장소를 다르게 보는 일이 오늘의 산책에 가까웠다.',
    '벤치 근처에는 물이 고인 작은 홈이 있었다. 비가 온 시간을 알 수 없어 그것을 방금 내린 비의 흔적이라고 쓰지 않았다. 보이는 것은 얕은 물과 그 위에 비친 잎뿐이라는 식으로 관찰과 추측을 따로 적었다.',
    '사진을 찍기 전에 어떤 장면을 남기고 싶은지 잠깐 생각했다. 화단 전체를 찍으면 위치는 알 수 있지만 잎의 차이는 잘 보이지 않았다. 가까이 찍으면 질감은 남지만 길을 걸어온 순서는 빠진다. 한 장이 산책 전체를 대신할 수는 없었다.',
    '다시 전시 메모를 펼쳐 보니 작품 설명과 내 생각이 한 문장에 섞인 곳이 있었다. 안내문에서 확인한 말에는 출처를 붙이고, 내가 떠올린 질문은 다음 줄로 옮겼다. 읽은 것을 남기는 일과 내 해석을 남기는 일을 구분할 필요가 있었다.',
    '집으로 돌아가는 길에는 오늘 본 것 중 다른 날에도 확인할 수 있는 것을 골랐다. 나무가 계속 같은 자리에 있을 가능성은 높지만, 빛과 잎의 상태는 달라질 것이다. 다음 기록에는 변화한 부분만 쓰기보다 비교할 수 있는 자리를 먼저 남겨 두기로 했다.',
    '메모 끝에 다시 볼 질문을 세 개 적었다. 설명을 먼저 읽었을 때와 나중에 읽었을 때 무엇이 달라지는가. 사진에 없는 길의 움직임은 어떤 문장으로 남길 수 있는가. 좋았다는 말 대신 실제로 멈춘 이유를 설명할 수 있는가.',
    '오늘의 기록을 전시 감상과 산책 후기 중 하나로 정리하지는 않았다. 두 장소를 이어 걸었지만 각각의 출처와 관찰은 따로 남겨 두었다. 나중에 함께 읽을 때는 그 사이를 연결한 내 코멘트가 무엇인지 확인하고 싶다.',
  ];
  const gardenCurrent = gardenOld.map((text, index) => index === 8
    ? '다시 전시 메모를 펼쳐 보니 작품 설명과 내 생각이 한 문장에 섞인 곳이 있었다. 안내문에서 확인한 말에는 출처를 붙이고, 내가 떠올린 질문은 다음 줄로 옮겼다. 보완한 기록에서는 확인하지 못한 작품명도 빼고 관찰한 장면만 남겼다.'
    : text);

  const samples = {
    title: '보고 읽으며 남긴 기록',
    intro: '전시와 산책에서 관찰한 장면, 다시 읽은 책, 작은 작업 뒤의 질문을 골랐다. 원문과 내 코멘트를 함께 읽을 수 있도록 묶었다.',
    sources: [
      {
        id: 'exhibition-garden', title: '전시를 나와 정원에서 정리한 메모', origin: 'apple_notes', relation: 'self', coverage: 'full_text', omissions: [],
        versions: [
          { id: 'garden-old', text: paragraphs(gardenOld), originalCreatedAt: '2026-04-18' },
          { id: 'garden-current', text: paragraphs(gardenCurrent), originalCreatedAt: '2026-04-18' },
        ],
      },
      {
        id: 'garden-caption', title: '다음 날 사진에 붙인 정원 캡션', origin: 'instagram', relation: 'self', coverage: 'partial', omissions: ['사진', '위치 태그'],
        versions: [{ id: 'caption-first', originalCreatedAt: '2026-04-19', text: paragraphs([
          '어제 걸었던 정원에서 새잎과 오래된 잎이 나란히 있던 자리를 남겼다. 사진을 다시 보니 잎의 질감은 보이지만 내가 벤치에서 화단까지 돌아간 길은 보이지 않는다. 이 글에는 사진 대신 그때 붙였던 문장만 보관한다.',
          '전시실에서 오래 바라보았던 그림자를 정원의 잎과 함께 떠올렸다. 두 장면이 같은 뜻이라서가 아니라, 설명을 서둘러 붙이지 않고 다시 보게 했다는 점이 비슷했다. 다음에는 같은 자리에서 빛이 어떻게 달라지는지 확인해 보고 싶다.',
        ]) }],
      },
      {
        id: 'reading-notes', title: '결정을 미룬 장면을 다시 읽은 독서 메모', origin: 'obsidian', relation: 'self', coverage: 'full_text', omissions: [],
        versions: [{ id: 'reading-first', originalCreatedAt: '2026-03-07', text: paragraphs([
          '책을 처음 읽을 때는 인물이 결정을 내리는 장면에 밑줄을 많이 그었다. 다시 읽으니 결정을 미룬 장면에도 이유가 있었다. 바로 답하지 않은 시간을 우유부단함이라는 한 단어로 정리했는지 돌아보게 되었다.',
          '이번 메모에는 책의 문장을 옮겨 적기보다 내가 이해한 장면을 내 말로 적었다. 인물이 무엇을 알고 있었는지와 내가 나중에 알게 된 내용을 구분하려고 했다. 독자는 결말을 아는 상태에서 앞의 선택을 쉽게 평가할 수 있다.',
          '가장 오래 생각한 부분은 주변 사람에게 설명할 수 없는 이유를 어떻게 다룰 것인가였다. 설명이 부족하면 선택이 잘못된 것인지, 아직 말로 만들지 못한 감각이 있는 것인지 구분하기 어려웠다. 이 질문에는 아직 답을 붙이지 않았다.',
          '책 소개에서 강조한 느린 선택이라는 표현은 기억하기 쉬웠지만 모든 장면을 설명하지는 못했다. 어떤 기다림은 상대를 살피는 행동이었고, 다른 기다림은 책임을 피하는 행동처럼 보였다. 같은 표현 아래 두 상황을 놓치지 않으려 한다.',
          '다음에 읽을 때는 인물이 선택한 결과보다 선택 직전에 확인한 정보에 표시를 해 보고 싶다. 내 일에서도 결론만 기록하면 왜 그때 그렇게 판단했는지 사라진다. 읽은 책과 생활의 경험을 같은 사례로 단정하지 않고 질문만 가져오기로 했다.',
        ]) }],
      },
      {
        id: 'book-introduction', title: '느린 선택을 다루는 책 소개', origin: 'naver_blog', relation: 'other', coverage: 'full_text', omissions: [], url: 'https://example.org/fictional-book-introduction',
        versions: [{ id: 'introduction-first', originalCreatedAt: '2026-03-02', text: paragraphs([
          '이 책의 인물들은 중요한 순간마다 잠시 멈춘다. 작가는 그 멈춤을 성공을 위한 요령으로 설명하지 않고, 주변의 말을 듣고 자신의 이유를 다시 확인하는 시간으로 그린다. 빨리 결정하는 사람과 천천히 결정하는 사람을 단순히 나누지 않는 점이 눈에 들어온다.',
          '중반부에는 같은 질문에 서로 다른 답을 내놓는 두 인물이 등장한다. 필요한 정보를 충분히 모았다고 생각하는 사람도 있고, 더 알아본 뒤에 말하겠다는 사람도 있다. 소개하는 입장에서는 어느 쪽이 옳다고 고르기보다 두 판단이 놓인 조건을 함께 읽기를 권한다.',
          '짧은 장면 사이의 빈칸은 독자가 인물의 속도를 따라가게 한다. 사건이 적다는 이유로 내용이 가볍다고 볼 수도 있지만, 한 번 말한 답을 고치는 과정은 작게 다뤄지지 않는다. 읽는 동안 내 결정을 설명했던 방식도 떠올릴 수 있다.',
          '독서 모임에서 이 책을 읽는다면 가장 인상적인 결론보다 그 결론에 이르기 전의 망설임을 먼저 이야기해 볼 만하다. 다만 책의 장면을 실제 관계에 바로 대입할 필요는 없다. 각자의 경험과 소설의 조건이 어떻게 다른지도 함께 남기면 좋겠다.',
        ]) }],
      },
      {
        id: 'work-retrospective', title: '작은 기록 화면을 고치며 버튼 이름과 오류 안내를 다시 살피고, 저장 뒤에도 읽던 문맥을 잃지 않도록 정리한 작업의 결과와 다음에 확인할 질문을 남기는 회고와 남겨 둔 다음 질문들', origin: 'other', relation: 'self', coverage: 'full_text', omissions: [],
        versions: [{ id: 'work-first', originalCreatedAt: '2026-05-06', text: paragraphs([
          '이번 작업은 새로운 화면을 만드는 일보다 이미 있는 조작을 이해하기 쉽게 고치는 데서 시작했다. 가져온 글을 보관한 다음 어디에서 다시 읽어야 하는지 바로 알기 어려웠다. 저장 자체가 성공해도 사용자의 일이 끝난 것은 아니라는 점을 먼저 적었다.',
          '처음에는 성공 메시지를 크게 보여 주면 문제가 해결될 것이라고 생각했다. 하지만 검색 조건 때문에 새 글이 목록에서 보이지 않는 경우가 있었다. 필요한 것은 더 큰 메시지가 아니라 보관한 정확한 글을 여는 작은 조작이었다.',
          '읽기 화면에서는 다른 부분을 고르려다가 선택을 풀었을 때 이전 구절이 남아 있는 상황을 확인했다. 아무것도 고르지 않은 상태와 메모를 쓰기 위해 잠깐 초점을 옮긴 상태를 구분해야 했다. 둘을 같은 방식으로 처리하면 잘못된 구절을 저장하거나 의도한 선택을 잃을 수 있었다.',
          '버튼 이름을 바꾸는 일에도 완료의 뜻을 확인했다. 원문만 보관하는 것과 골라 둔 구절까지 함께 남기는 것은 다르다. 사용자가 어느 범위를 보관했는지 말로 설명할 수 있어야 다음에 읽을 때도 결과를 믿을 수 있다.',
          '오류가 났을 때는 입력이 남아 있는지부터 살폈다. 다시 시도하라는 안내가 있어도 본문과 메모가 사라졌다면 같은 일을 처음부터 반복해야 한다. 실패 뒤의 화면이 처음 화면보다 더 막막해지지 않도록 확인할 항목을 정리했다.',
          '좁은 화면에서는 버튼 사이의 간격보다 문장과 조작의 관계가 먼저 보였다. 설명을 읽은 뒤 어느 버튼을 눌러야 하는지 알 수 없으면 공간을 줄여도 부담은 줄지 않았다. 필요한 말은 가까이 두고, 취소는 완료 조작과 구분되는 위치에 놓았다.',
          '수정 뒤에는 새로 보관한 글을 열었다가 이전 검색 결과로 돌아오는 흐름을 확인했다. 검색어와 출처 조건이 남아 있어야 방금 하던 일을 이어갈 수 있었다. 원문이 여러 버전일 때는 가장 최근 글이 아니라 실제로 고른 버전이 열리는지도 살폈다.',
          '작업을 마친 뒤 남은 질문은 실제 기기에서 선택 손잡이와 한글 입력이 어떻게 느껴지는가였다. 화면 크기를 바꾸어 확인한 결과를 기기 체험과 같은 것으로 쓰지는 않기로 했다. 다음 확인에서는 처음부터 끝까지 한 글을 가져오고 읽는 데 드는 부담을 보려고 한다.',
        ]) }],
      },
      {
        id: 'short-day', title: '퇴근 뒤 창가에 잠깐 앉은 날', origin: 'other', relation: 'self', coverage: 'full_text', omissions: [],
        versions: [{ id: 'day-first', originalCreatedAt: '2026-05-02', text: '집에 돌아와 창가에 앉아 물을 한 잔 마셨다. 해야 할 일을 새로 정하지 않고 오늘 끝낸 일 하나만 적었다.' }],
      },
      {
        id: 'museum-link', title: '주말 관람 전에 확인할 박물관 안내', origin: 'other', relation: 'other', coverage: 'link_only', omissions: [], url: 'https://example.org/museum/visit',
        versions: [{ id: 'museum-link-first', originalCreatedAt: null, text: null }],
      },
      {
        id: 'walk-questions', title: '산책을 마치고 적어 둔 세 가지 질문', origin: 'apple_notes', relation: 'self', coverage: 'full_text', omissions: [],
        versions: [{ id: 'questions-first', originalCreatedAt: null, text: paragraphs([
          '같은 길을 다시 걸으면 지난번에 보았던 것을 먼저 찾게 된다. 그것이 비교를 돕는지, 새로 생긴 장면을 놓치게 하는지 아직 잘 모르겠다. 다음에는 기억한 장면을 적은 종이를 펼치기 전에 한 번 걸어 보고 싶다.',
          '기록을 남기기 위해 멈춘 시간과 그냥 바라보기 위해 멈춘 시간은 어떻게 다를까. 사진이나 메모가 없다고 해서 덜 본 것은 아닐 수 있다. 남은 자료의 양으로 산책의 밀도를 판단하지 않으려 한다.',
          '나중에 읽을 수 있는 기록에는 장소 설명을 얼마나 남겨야 할까. 길 전체를 설명하면 작은 관찰이 묻히고, 한 장면만 쓰면 돌아갈 자리를 찾기 어렵다. 다음 메모에서는 방향을 바꾼 지점 하나와 그때 보았던 것을 함께 적어 보려고 한다.',
        ]) }],
      },
    ],
    entries: [
      { id: 'exhibition-walk', title: '전시에서 산책으로 이어진 관찰', pinned: true, sourceRefs: [{ sourceId: 'exhibition-garden', versionId: 'garden-old' }, { sourceId: 'garden-caption', versionId: 'caption-first' }], note: '전시를 본 날의 메모와 다음 날 붙인 캡션을 함께 읽으면 장면을 남기는 방식이 달라졌음을 알 수 있다. 두 글의 내용을 하나로 합치기보다 서로 빠뜨린 부분을 확인하고 싶다. 이전 메모의 망설임을 남기기 위해 보완한 최신 버전 대신 처음 기록한 버전을 골랐다.' },
      { id: 'book-questions', title: '다시 읽은 책과 남겨 둔 질문', pinned: true, sourceRefs: [{ sourceId: 'reading-notes', versionId: 'reading-first' }, { sourceId: 'book-introduction', versionId: 'introduction-first' }], note: '타인의 소개문은 다시 읽을 질문을 찾는 참고로 보관했으며 그 설명에 모두 동의한다는 뜻은 아니다. 내 독서 메모와 나란히 두고 같은 장면을 다르게 읽은 지점을 확인하려 한다.' },
      { id: 'finished-work', title: '작업을 마치고 남긴 기록', pinned: false, sourceRefs: [{ sourceId: 'work-retrospective', versionId: 'work-first' }], note: '처음 생각한 해결책이 실제 문제와 달랐던 순간을 남겼다. 성공 메시지를 다듬기 전에 다음에 할 일을 확인해야 했다. 선택이 풀린 상태를 정확히 보여 주는 일은 작은 표시 이상의 의미가 있었다. 실패 뒤에도 입력을 이어 쓸 수 있어야 다시 시도할 이유가 생긴다. 이전 검색 조건으로 돌아가는 과정까지 하나의 작업으로 보았다. 확인한 화면과 아직 쓰지 않은 실제 기기를 구분해 기록했다. 다음에는 처음 쓰는 사람이 안내 없이 한 글을 보관하고 다시 읽는 과정을 살펴보고 싶다. 그 결과가 다르면 이번에 정한 버튼 이름과 배치도 다시 바꿀 것이다.' },
      { id: 'brief-day', title: '짧게 남긴 하루', pinned: false, sourceRefs: [{ sourceId: 'short-day', versionId: 'day-first' }], note: '' },
      { id: 'visit-information', title: '주말 관람 전에 확인할 정보', pinned: false, sourceRefs: [{ sourceId: 'museum-link', versionId: 'museum-link-first' }], note: '방문 전에 원문 안내에서 운영 시간과 관람 조건을 직접 확인하려고 링크만 남겼다.' },
      { id: 'after-walk', title: '산책 뒤 적은 질문', pinned: false, sourceRefs: [{ sourceId: 'walk-questions', versionId: 'questions-first' }], note: '작성한 날을 확인할 수 없어 다른 산책 기록의 앞뒤에 놓인 글이라고 설명하지 않는다. 여기서는 기록의 양과 실제로 바라본 시간을 구분한 질문만 이어 읽고 싶다.' },
    ],
  };

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }
  root.HaedoExpressionSamples = deepFreeze(samples);
})(typeof globalThis === 'object' ? globalThis : this);
