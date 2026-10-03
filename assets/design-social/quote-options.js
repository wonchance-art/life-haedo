/* Three original outline candidates. Neighbor SVGs: Lucide 1.51.0;
   source and ISC/Feather MIT notices: vendor/lucide/. Comparison only. */
(() => {
  'use strict';
  const neighbors = {
  "book": "<path d=\"M12 5v16\" /><path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\" />",
  "search": "<path d=\"m21 21-4.34-4.34\" /><circle cx=\"11\" cy=\"11\" r=\"8\" />",
  "bookmark": "<path d=\"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z\" />",
  "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
  "back": "<path d=\"m12 19-7-7 7-7\" /><path d=\"M19 12H5\" />",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" />"
};
  const options = [
    { id:'a', name:'둥근 따옴표', description:'둥근 사각형과 부드러운 끝선.',
      shape:'<path d="M10 12H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6M21 12h-5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6"/>' },
    { id:'b', name:'짧은 따옴표', description:'같은 둥근 모서리, 짧게 꺾인 끝선.',
      shape:'<path d="M10 13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v10l-3 4M21 13h-5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v10l-3 4"/>' },
    { id:'c', name:'문장 인용', description:'인용선과 글줄로 발췌를 표현.',
      shape:'<path d="M4 4v16M10 6h11M10 12h11M10 18h7"/>' }
  ];
  const svg = (shape,size=20) => `<svg class="s-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape}</svg>`;
  const cell = (name,shape) => `<span class="q-icon-cell ${name==='quote'?'is-quote':''}" data-glyph="${name}">${svg(shape)}</span>`;
  const nav = option => ['book','search','bookmark','quote','plus'].map(name=>cell(name,name==='quote'?option.shape:neighbors[name])).join('');
  const group = document.querySelector('#quoteOptions');
  group.innerHTML=options.map(option=>`<button class="q-option" data-option="${option.id}" aria-label="${option.id.toUpperCase()} ${option.name} 선택" aria-pressed="false"><span class="q-title"><span class="q-letter">${option.id.toUpperCase()}</span>${option.name}</span><span class="q-description">${option.description}</span><span class="q-context" aria-hidden="true">${nav(option)}</span></button>`).join('');
  function choose(id) {
    const option=options.find(item=>item.id===id);
    group.querySelectorAll('[data-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.option===id)));
    document.querySelector('#quoteChoice').textContent=`${id.toUpperCase()} · ${option.name}`;
    document.querySelector('#quoteNav').innerHTML=nav(option);
    document.querySelector('#quoteTools').innerHTML=['back','info','quote','bookmark'].map(name=>cell(name,name==='quote'?option.shape:neighbors[name])).join('');
  }
  group.addEventListener('click',event=>{const button=event.target.closest('[data-option]');if(button)choose(button.dataset.option);});
  choose('a');
})();
