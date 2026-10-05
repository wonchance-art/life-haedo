/* Anonymous, memory-only design demonstration. No Auth, persistence, fetch or SNS writes. */
(function () {
  'use strict';
  const icon = name => window.HaedoLife.Icons.create(name).outerHTML;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const originals = [
    { id:'exhibition', title:'전시를 보고 나서, 공간에 오래 머무르게 하는 장면들', date:'10월 4일', selected:true, pinned:true,
      summary:'사진에 남긴 빛, 블로그에 쓴 감상, 혼자 적어 둔 질문. 같은 날의 기록을 한 활동으로 묶었습니다.',
      parts:[{label:'네이버 블로그', selected:true, text:'작품보다 작품 사이의 빈자리를 오래 바라봤다. 빛이 들어오는 방향에 따라 같은 벽이 다른 표정을 가졌다. 공간을 기억하게 하는 건 무엇을 채웠는지보다 어디서 잠시 멈췄는지일지도 모른다.'},
        {label:'Instagram', selected:true, text:'오후 네 시의 빛. 오늘의 전시에서 가장 오래 머문 자리.'},
        {label:'개인 메모', selected:false, text:'혼자 남긴 질문: 내가 오래 머무는 장소들의 공통점은 무엇일까?'}],
      note:'전시와 산책의 기록을 같이 읽으니, 내가 자주 멈추는 장면이 보이기 시작했다.', showNote:true },
    { id:'walk', title:'돌아오는 길을 조금 길게 잡았다', date:'10월 3일', selected:true, pinned:false,
      summary:'해야 할 일을 마친 뒤, 목적지 없이 걸은 한 시간의 기록.',
      parts:[{label:'내 글', selected:true, text:'늘 지나치던 골목에서 작은 책방을 발견했다. 오늘은 무엇을 더 해내기보다, 눈에 들어오는 것을 천천히 보려고 했다. 돌아오는 길이 조금 길어져도 괜찮았다.'}],
      note:'', showNote:false },
    { id:'reading', title:'다시 읽고 싶은 문장과 아직 답하지 못한 질문', date:'10월 2일', selected:false, pinned:false,
      summary:'읽다가 남긴 문장과 다음에 찾아보고 싶은 주제를 함께 보관했습니다.',
      parts:[{label:'Obsidian · 내 메모', selected:true, text:'기록을 다시 읽는 일은 과거를 복사하는 일일까, 지금의 눈으로 새롭게 해석하는 일일까. 산책과 공간에 관한 글을 함께 읽어 보기로 했다.'}],
      note:'', showNote:false },
    { id:'reflection', title:'이번 주에 다시 만난 관심: 공간과 산책', date:'10월 5일', selected:false, pinned:false,
      summary:'선택한 기록을 돌아본 회고 예시. 공유할 때는 원하는 문장만 골라 담습니다.',
      parts:[{label:'회고 · 예시', selected:true, text:'이 예시 묶음에서는 전시와 산책에 관한 글이 이어진다. 두 기록 모두 잠시 멈춰 주변을 바라본 경험을 담고 있다. 다음에는 자주 머무는 장소를 함께 살펴보고 싶다.'}],
      note:'', showNote:false }
  ];
  let activities;
  const byId = id => document.getElementById(id);
  const announce = text => { byId('announcement').textContent=text; };
  function switchField(id,label,checked,attrs='') { return `<div class="setting-row"><label for="${id}">${escape(label)}</label><input id="${id}" class="switch" type="checkbox" ${checked?'checked':''} ${attrs}></div>`; }
  function renderEditor() {
    byId('activities').innerHTML=activities.map(a=>`<article class="activity ${a.selected?'':'is-excluded'}" data-activity="${a.id}">
      <div class="activity-top"><h4 id="title-${a.id}">${escape(a.title)}</h4><input class="switch" type="checkbox" data-select="${a.id}" aria-label="${escape(a.title)} 공개 초안에 포함" ${a.selected?'checked':''}></div>
      <div class="source-names">${icon(a.parts.length>1?'link':'book')}<span>${a.parts.map(p=>escape(p.label)).join(' · ')}</span></div>
      <p class="excerpt">${escape(a.summary)}</p>
      <details><summary>${icon('chevron')}공개할 부분 편집</summary>
      ${switchField(`pin-${a.id}`,'대표 글로 배치',a.pinned,`data-pin="${a.id}"`)}
      ${a.parts.map((p,i)=>switchField(`part-${a.id}-${i}`,p.label,p.selected,`data-part="${a.id}" data-index="${i}"`)).join('')}
      ${switchField(`note-${a.id}`,'내 코멘트 포함',a.showNote,`data-note="${a.id}"`)}
      <label class="life-field"><span>공유용 코멘트</span><textarea data-text="${a.id}" maxlength="600">${escape(a.note)}</textarea></label>
      <p class="meta">해도에 보여줄 사본만 편집합니다. 출처는 포함한 글과 함께 표시됩니다.</p></details>
    </article>`).join('');
  }
  function entry(a) {
    const parts=a.parts.filter(p=>p.selected);
    const note=a.showNote&&a.note.trim();
    return `<article class="public-entry" data-public="${a.id}"><div class="entry-meta">${escape(a.date)} · ${a.parts.length>1?'연결한 활동':'기록'}</div><h4>${escape(a.title)}</h4>
      ${parts.map(p=>`<div class="source-piece"><p class="source-label">${escape(p.label)}</p><p>${escape(p.text)}</p></div>`).join('')}
      ${note?`<div class="public-note">${icon('quote')}<p>${escape(a.note)}</p></div>`:''}
      ${!parts.length&&!note?'<p class="meta">제목만 포함한 글입니다.</p>':''}</article>`;
  }
  function renderPublic() {
    const selected=activities.filter(a=>a.selected);
    const isEmpty=byId('scenario').value==='empty';
    byId('selectionCount').textContent=`${isEmpty?0:selected.length}개 선택`;
    const pinned=selected.filter(a=>a.pinned);
    const recent=selected.filter(a=>!a.pinned);
    const intro=byId('showIntro').checked?`<p class="profile-description">${escape(byId('intro').value)}</p>`:'';
    byId('introField').hidden=!byId('showIntro').checked;
    let body=`<div class="public-profile"><h3 class="profile-name">서윤의 기록</h3>${intro}</div>`;
    if(isEmpty||!selected.length) body+='<div class="empty"><h3>아직 고른 기록이 없어요.</h3><p>보여주고 싶은 활동부터 하나씩 담아 보세요.</p></div>';
    else {
      if(pinned.length) body+=`<h3 class="public-section-title">${icon('bookmark')}고정한 기록</h3>`+pinned.map(entry).join('');
      if(recent.length&&byId('showRecent').checked) body+='<h3 class="public-section-title">최근 활동</h3>'+recent.map(entry).join('');
      if(!pinned.length&&!byId('showRecent').checked) body+='<div class="empty"><h3>첫 화면에 배치한 기록이 없어요.</h3><p>선택한 글은 유지됩니다. 최근 활동 영역을 켜거나 대표 글을 골라 주세요.</p></div>';
    }
    byId('publicPage').innerHTML=body;
  }
  function scenario() {
    const value=byId('scenario').value;
    byId('activities').hidden=value==='empty';
    byId('sourceNotice').innerHTML=value==='error'?'<div class="state error">새 자료를 확인하지 못했어요. 보관한 기록은 계속 사용할 수 있어요.<button class="text-button" id="retry">예시 연결 복구</button></div>':value==='loading'?'<div class="state" aria-busy="true">새 자료를 확인하는 중이에요. 보관한 기록부터 편집할 수 있어요.</div>':value==='empty'?'<div class="state">아직 가져온 기록이 없어요. 링크·본문·파일로 시작할 수 있어요.</div>':'';
    byId('retry')?.addEventListener('click',()=>{byId('scenario').value='ready';scenario();announce('연결 복구 예시로 전환했습니다.');});
    renderPublic();
  }
  function reset() {
    activities=structuredClone(originals);
    byId('showIntro').checked=true; byId('showRecent').checked=true;
    byId('intro').value='보고, 걷고, 오래 생각한 것들.'; byId('scenario').value='ready';
    renderEditor(); scenario();
  }
  document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
  byId('activities').addEventListener('change',event=>{
    const el=event.target, key=el.dataset.select||el.dataset.pin||el.dataset.part||el.dataset.note;
    const a=activities.find(a=>a.id===key); if(!a) return;
    if(el.dataset.select) { a.selected=el.checked; el.closest('.activity').classList.toggle('is-excluded',!el.checked); }
    if(el.dataset.pin) a.pinned=el.checked;
    if(el.dataset.part) a.parts[Number(el.dataset.index)].selected=el.checked;
    if(el.dataset.note) a.showNote=el.checked;
    renderPublic(); announce('선택한 부분만 미리보기에 반영했습니다.');
  });
  byId('activities').addEventListener('input',event=>{
    const a=activities.find(a=>a.id===event.target.dataset.text);if(!a)return;
    a.note=event.target.value;renderPublic();
  });
  ['showIntro','showRecent'].forEach(id=>byId(id).addEventListener('change',()=>{renderPublic();announce('페이지 구성을 미리보기에 반영했습니다.');}));
  byId('intro').addEventListener('input',renderPublic);
  byId('scenario').addEventListener('change',scenario);
  byId('clearSelection').addEventListener('click',()=>{activities.forEach(a=>{a.selected=false;});renderEditor();renderPublic();announce('공개 초안에서 모두 제외했습니다. 원본은 유지됩니다.');});
  byId('reset').addEventListener('click',()=>{reset();announce('예시 선택을 초기화했습니다.');});
  byId('previewOnly').addEventListener('click',()=>{
    const on=document.body.classList.toggle('preview-only');
    byId('previewOnly').innerHTML=icon(on?'back':'user')+`<span>${on?'구성으로':'미리보기'}</span>`;
    (on?byId('visitor'):byId('editor')).focus();
  });
  reset();
})();
