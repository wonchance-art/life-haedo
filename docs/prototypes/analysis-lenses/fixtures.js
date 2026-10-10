/* Authored synthetic Korean corpus. No personal records or model output. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.LensFixtures=value;})(globalThis,()=>{
  const sources=[
    ['s01','v01','첫 출근을 앞두고','2018-02-12','apple_notes','self','full_text','처음에는 이름을 들으면 누구나 아는 회사에서 일하고 싶었다.\n인정받는 일을 하고 싶다. 그래야 내가 잘 살고 있다는 느낌이 들 것 같다.'],
    ['s02','v02','퇴근길의 질문','2019-06-23','obsidian','self','full_text','퇴근길에 한 정거장 먼저 내려 걸었다.\n잘하는 일을 골라야 할까, 오래 궁금한 일을 골라야 할까?\n오늘은 답을 찾지 못했다.'],
    ['s03','v03','다시 읽고 싶은 오후','2020-09-19','naver_blog','self','full_text','동네의 작은 책방에서 두 시간을 보냈다.\n누군가에게 설명할 수 없어도 오래 들여다보고 싶은 것이 있다.\n그것을 좋아한다고 말해도 될까?'],
    ['s04','v04','일을 고르는 기준','2021-04-10','obsidian','self','full_text','책임 있는 역할을 맡고 싶다는 마음은 여전하다.\n다만 오래 궁금해할 수 있는 일을 하고 싶다.\n평가를 잘 받는 것과 내 질문을 잃지 않는 일은 함께 갈 수 있을까?'],
    ['s05','v05','쉬는 연습','2022-08-07','instagram','self','partial','🌱 이번 주말에는 아무 계획 없이 걸었다.\n쉬는 시간까지 성과로 설명하고 싶지는 않다.\n사진에는 강변의 오후가 있었지만 여기에는 글만 옮겼다.'],
    ['s06','v06','다시 남겨 둔 질문','2023-03-02','apple_notes','self','full_text','일을 바꾸면 마음도 달라질 거라 생각했다.\n나는 잘하는 것과 오래 좋아하는 것 중 무엇을 택하고 싶은가?\n둘 중 하나만 골라야 한다는 질문부터 다시 생각하고 있다.'],
    ['s07','v07','달리는 이유','2024-05-14','naver_blog','self','full_text','친구와 아침마다 달리기로 했다.\n기록을 줄이는 것보다 다음 주에도 함께 나갈 수 있는 리듬이 좋다.\n오래 한다는 말에는 혼자 버틴다는 뜻만 있는 것은 아니었다.'],
    ['s08','v08-old','평가를 앞둔 메모','2025-01-11','obsidian','self','full_text','올해는 다른 사람의 평가를 전혀 신경 쓰지 않기로 했다.'],
    ['s08','v08','평가를 앞둔 메모','2025-01-11','obsidian','self','full_text','지난 문장을 너무 크게 써 놓았다.\n여전히 좋은 평가를 받고 싶다. 다만 그것이 내 선택의 유일한 기준은 아니었으면 한다.\n내가 중요하게 여기는 질문도 평가와 함께 이야기하고 싶다.'],
    ['s09','v09','책방에서 떠올린 일','2025-11-16','apple_notes','self','full_text','다시 작은 책방에 갔다. 새 책을 많이 사지는 않았다.\n좋아하는 것을 더 많이 모으기보다 다시 펼칠 시간을 남겨 두고 싶다.'],
    ['s10','v10','천천히 계속하는 일','2026-06-08','instagram','self','full_text','일요일에는 짧게 달리고 오래 읽었다.\n잘 해내는 하루보다 다음에도 하고 싶은 하루를 만들고 싶다.\n아직 모든 날이 그렇지는 않다.'],
    ['s11','v11','저장한 작가의 문장','2020-03-17','obsidian','other','full_text','익명 예시 작가의 문장: 세상의 모든 기대에서 벗어나야만 자유로워진다.\n이 문장은 저장한 타인의 글이며 작성자의 경험이 아니다.'],
    ['s12','v12','언젠가 적은 메모',null,'apple_notes','self','full_text','인정받지 못해도 계속할 수 있을까? 날짜를 적어 두지 않았다.'],
    ['s13','v13','다음에 읽을 인터뷰','2023-07-04','naver_blog','other','link_only',null],
    ['s14','v14','주말 계획','2022-08-06','apple_notes','self','full_text','내일은 일찍 일어나 달려 볼까 한다. 이 글만으로 실제로 뛰었다고 말할 수는 없다.'],
    ['s15','v15','정답이 하나라는 생각','2026-09-15','obsidian','self','full_text','잘하는 일과 좋아하는 일이 꼭 다른 것은 아닐지도 모른다.\n처음부터 정답을 찾기보다 해 보면서 고르는 편이 내게 맞을 수도 있다.']
  ].map(([sourceId,id,title,date,origin,relation,coverage,text])=>({sourceId,id,title,date,origin,relation,coverage,text,current:id!=='v08-old'}));
  const quote=(versionId,text,role='support')=>{const source=sources.find(s=>s.id===versionId),start=source.text.indexOf(text);if(start<0)throw Error('Fixture quote missing');return {versionId,start,end:start+text.length,text,role};};
  const lenses=[
    {id:'interests',label:'관심',title:'관심의 궤적',question:'무엇을 오래 좋아하게 됐을까?',description:'관심의 빈도와 관심을 표현한 이유를 나누어 읽습니다.'},
    {id:'questions',label:'질문',title:'계속 돌아온 질문',question:'나는 어떤 질문으로 돌아왔을까?',description:'비슷한 고민을 한데 놓되, 같다는 판단은 열어 둡니다.'},
    {id:'changes',label:'변화',title:'생각이 달라진 지점',question:'같은 일, 달라진 기준이 있을까?',description:'이전과 이후의 표현을 비교하고 반대 근거도 함께 읽습니다.'}
  ];
  const findings=[
    {id:'interest-return',lens:'interests',title:'더 모으기보다, 다시 펼칠 시간을',summary:'책을 좋아하는 마음은 이어지지만, 대상의 수보다 다시 만나는 시간을 말하기 시작합니다.',alternative:'두 책방 경험만으로 취향 전체가 바뀌었다고 말할 수는 없습니다.',question:'좋아하는 것과 다시 만날 시간을 어떻게 남기고 싶나요?',refs:[quote('v03','누군가에게 설명할 수 없어도 오래 들여다보고 싶은 것이 있다.'),quote('v09','좋아하는 것을 더 많이 모으기보다 다시 펼칠 시간을 남겨 두고 싶다.')]},
    {id:'interest-rhythm',lens:'interests',title:'읽기와 달리기에 겹치는, 계속하고 싶은 마음',summary:'서로 다른 활동에서 성과보다 이어 갈 수 있는 리듬을 언급합니다.',alternative:'이 글은 선택한 날의 표현입니다. 실제 생활 전체가 지속 가능한지는 알 수 없습니다.',question:'오래 하고 싶게 만드는 조건은 무엇인가요?',refs:[quote('v07','기록을 줄이는 것보다 다음 주에도 함께 나갈 수 있는 리듬이 좋다.'),quote('v10','잘 해내는 하루보다 다음에도 하고 싶은 하루를 만들고 싶다.')]},
    {id:'question-choice',lens:'questions',title:'잘하는 일과 좋아하는 일, 꼭 골라야 할까',summary:'반복해서 등장한 선택의 질문이, 둘 중 하나만 골라야 하는지 묻는 질문으로 이어집니다.',alternative:'표현이 닮았어도 당시의 직장과 상황은 다를 수 있습니다. 같은 고민이라는 연결은 제안입니다.',question:'지금은 두 가지를 어떻게 함께 가져가고 싶나요?',refs:[quote('v02','잘하는 일을 골라야 할까, 오래 궁금한 일을 골라야 할까?'),quote('v06','나는 잘하는 것과 오래 좋아하는 것 중 무엇을 택하고 싶은가?'),quote('v15','잘하는 일과 좋아하는 일이 꼭 다른 것은 아닐지도 모른다.')]},
    {id:'question-proof',lens:'questions',title:'좋아함에도 설명이 필요할까',summary:'좋아하는 일과 쉬는 시간을 다른 사람에게 설명해야 하는지 묻는 장면을 나란히 읽을 수 있습니다.',alternative:'책 취향과 휴식은 다른 주제입니다. 공통 질문으로 묶지 않는 편이 더 정확할 수도 있습니다.',question:'설명하지 않아도 남겨 두고 싶은 것은 무엇인가요?',refs:[quote('v03','그것을 좋아한다고 말해도 될까?'),quote('v05','쉬는 시간까지 성과로 설명하고 싶지는 않다.')]},
    {id:'change-standard',lens:'changes',title:'인정받고 싶다는 마음에, 내 기준을 더하다',summary:'인정을 원하는 마음이 사라졌다기보다, 내 질문도 선택의 기준에 놓으려는 변화로 읽힙니다.',alternative:'회사의 평가를 앞두고 쓴 글과 입사 전 글의 상황 차이일 수도 있습니다. 이것을 성장의 우열로 평가하지 않습니다.',question:'지금 내 선택에 함께 놓고 싶은 기준은 무엇인가요?',refs:[quote('v01','인정받는 일을 하고 싶다. 그래야 내가 잘 살고 있다는 느낌이 들 것 같다.'),quote('v04','다만 오래 궁금해할 수 있는 일을 하고 싶다.'),quote('v08','여전히 좋은 평가를 받고 싶다. 다만 그것이 내 선택의 유일한 기준은 아니었으면 한다.','counter')]},
    {id:'change-method',lens:'changes',title:'정답을 고르기에서, 해 보며 고르기로',summary:'확실한 선택을 먼저 해야 한다는 질문에서, 경험하며 결정할 수도 있다는 표현으로 이어집니다.',alternative:'마지막 글도 “맞을 수도 있다”는 가정입니다. 행동이 바뀌었다는 증거는 아닙니다.',question:'작게 해 보고 판단할 수 있는 다음 시도는 무엇인가요?',refs:[quote('v02','잘하는 일을 골라야 할까, 오래 궁금한 일을 골라야 할까?'),quote('v15','처음부터 정답을 찾기보다 해 보면서 고르는 편이 내게 맞을 수도 있다.')]} 
  ].map(f=>({...f,origin:'authored_example',templateVersion:1,limitation:'익명 예시 글에 맞춰 작성한 해석입니다. 실제 AI 분석 결과가 아닙니다.'}));
  return {version:'haedo-lens-fixtures-v1',sources,lenses,findings};
});
