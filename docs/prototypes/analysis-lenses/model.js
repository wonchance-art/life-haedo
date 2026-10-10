/* Pure proposal contract for the isolated prototype; not the production book schema. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.LensModel=value;})(globalThis,()=>{
  function validateFinding(finding,sources,selectedIds){
    const issues=[];const selected=selectedIds?new Set(selectedIds):null;
    if(finding.origin!=='authored_example')issues.push('unrecognized_origin');
    if(!finding.refs?.length)issues.push('missing_evidence');
    for(const ref of finding.refs||[]){
      const source=sources.find(s=>s.id===ref.versionId);
      if(!source){issues.push('missing_version');continue;}
      if(selected&&!selected.has(source.id))issues.push('outside_scope');
      if(source.relation!=='self')issues.push('other_author');
      if(source.coverage==='link_only'||typeof source.text!=='string'){issues.push('missing_body');continue;}
      if(!Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>source.text.length||source.text.slice(ref.start,ref.end)!==ref.text)issues.push('quote_mismatch');
      if(!['support','counter'].includes(ref.role))issues.push('invalid_role');
    }
    if(finding.lens==='changes'&&(finding.refs||[]).some(ref=>!sources.find(s=>s.id===ref.versionId)?.date))issues.push('unknown_date_for_change');
    return {valid:issues.length===0,issues:[...new Set(issues)]};
  }
  function selectScope(sources,period='all'){
    const current=sources.filter(s=>s.current&&s.relation==='self'&&typeof s.text==='string');
    const selected=current.filter(s=>period==='all'||s.date&&Number(s.date.slice(0,4))>=(period==='recent'?2022:2018)&&Number(s.date.slice(0,4))<=(period==='recent'?2026:2021));
    return {period,versionIds:selected.map(s=>s.id),count:selected.length,unknownDates:selected.filter(s=>!s.date).length,
      omitted:{olderVersions:sources.filter(s=>!s.current).length,otherAuthors:sources.filter(s=>s.current&&s.relation==='other').length,missingBody:sources.filter(s=>s.current&&s.relation==='self'&&typeof s.text!=='string').length}};
  }
  function createCandidate(finding,sources,scope,userText){
    const validation=validateFinding(finding,sources,scope.versionIds);
    if(!validation.valid)throw new Error('근거를 확인할 수 없어 담지 않았습니다.');
    if(typeof userText!=='string'||!userText.trim())throw new Error('장에 남길 내 해석을 먼저 적어 주세요.');
    if(userText.length>20000)throw new Error('내 해석은 20,000자까지 담을 수 있습니다. 입력은 유지됩니다.');
    return {id:finding.id,lens:finding.lens,title:finding.title,proposal:{origin:finding.origin,templateVersion:finding.templateVersion,text:finding.summary,alternative:finding.alternative},
      userInterpretation:userText,scope:structuredClone(scope),evidence:finding.refs.map(ref=>{const s=sources.find(s=>s.id===ref.versionId);return {...ref,sourceId:s.sourceId,title:s.title,date:s.date,relation:s.relation,coverage:s.coverage};})};
  }
  function exportCandidates(candidates){
    if(!candidates.length)throw new Error('담은 장 후보가 없습니다.');
    return {format:'haedo-analysis-candidates-prototype-v1',synthetic:true,fixtureVersion:'haedo-lens-fixtures-v1',modelUsed:null,createdAt:new Date().toISOString(),notice:'익명 시제품의 장 후보입니다. 실제 책·백업 형식이 아닙니다.',candidates:structuredClone(candidates)};
  }
  function markdown(candidates){const data=exportCandidates(candidates);return '# 분석에서 고른 장 후보\n\n'+data.notice+'\n\n'+data.candidates.map(c=>'## '+c.title+'\n\n내 해석\n\n'+c.userInterpretation+'\n\n예시 제안 — 실제 AI 분석 아님\n\n'+c.proposal.text+'\n\n다른 설명: '+c.proposal.alternative+'\n\n근거\n\n'+c.evidence.map(e=>'> '+e.text.replace(/\n/g,'\n> ')+'\n\n'+e.title+' · '+(e.date||'날짜 미확인')+' · '+e.versionId+' ['+e.start+','+e.end+') · '+(e.role==='counter'?'다른 방향의 근거':'근거')).join('\n\n')).join('\n\n');}
  return {validateFinding,selectScope,createCandidate,exportCandidates,markdown};
});
