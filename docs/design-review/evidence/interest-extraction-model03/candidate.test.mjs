import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCandidate,extractDocuments,TAXONOMY,CONFIG} from './candidate.mjs';
const hash=async text=>createHash('sha256').update(text).digest('hex');
const docs=texts=>({documents:texts.map((text,index)=>({id:`d${index}`,text,originalAuthor:{relation:index?'other':'self'}}))});
function embed(texts){return texts.map(text=>{const vector=Array(11).fill(0);const i=TAXONOMY.findIndex(topic=>topic.text===text||topic.terms.join(' ')===text);vector[i>=0?i:/실험|관측|연구/.test(text)?1:10]=1;return vector;});}
function scorePairs(pairs){return pairs.map(pair=>pair.stage==='control'?0.02:pair.stage==='questionhood'?0.95:pair.stage==='question'?0.95:pair.id.endsWith('technology-science')?0.95:0.02);}
function checkReferences(result,input){for(const item of result.analysis.interests)for(const ref of item.evidence){const document=input.documents.find(row=>`v-${row.id}`===ref.sourceVersionId);assert.equal(document.text.slice(ref.start,ref.end),ref.quote);assert.equal(createHash('sha256').update(document.text).digest('hex'),ref.sha256);assert.equal(document.originalAuthor.relation,ref.authorRelation);}}
test('model phases are separated; full scan and exact author/span provenance are inspectable',async()=>{
 const input=docs(['\uFEFF😀 실험 관측을 어떻게 비교해야 할까?\r\n추가 연구 결과를 기록했다.','실험 관측을 어떤 기준으로 비교해야 할까?']);const before=structuredClone(input);let phase='embedding';
 const candidate=createCandidate({hash,embed:values=>{assert.equal(phase,'embedding');return embed(values);},scorePairs:values=>{phase='nli';return scorePairs(values);}});
 const result=await candidate.analyze(input);assert.deepEqual(input,before);assert(!result.incomplete);assert(result.analysis.interests.some(row=>row.kind==='topic'));assert(result.analysis.interests.some(row=>row.kind==='question'));checkReferences(result,input);
 for(const row of result.diagnostics.perDocument){assert.equal(row.stages.scan[0].start,0);assert.equal(row.stages.scan[0].end,row.totalUTF16Characters);assert(row.stages.topicShortlist.length);assert(row.stages.topicNli.every(value=>value.topicId));}
 assert.equal(result.diagnostics.questionCandidates.length,2);
});
test('cross-line negation stays inside its whole original semantic sentence',async()=>{
 const input=docs(['책과 글쓰기를 좋아하고 독서 모임을 찾는다는\n주장은 사실이 아니며 문법 표현만 검토했다.']);
 const extracted=await extractDocuments(input,{hash});assert.equal(extracted.passages.length,1);assert(extracted.passages[0].quote.includes('\n주장은 사실이 아니'));
 const seen=[];const candidate=createCandidate({hash,embed,scorePairs:pairs=>{seen.push(...pairs);return pairs.map(()=>0.01);}});await candidate.analyze(input);assert(seen.some(pair=>pair.premise.includes('\n주장은 사실이 아니')));
});
test('long sentence fragments retain whole-original quote provenance and abstain on lost sentence scope',async()=>{
 const text='"'+('실험 관측 기록을 정리하는 문장 '.repeat(40))+'\n이것은 인용된 과거 문장이다."';
 const extracted=await extractDocuments(docs([text]),{hash});assert(extracted.passages.length>2);assert(extracted.passages.every(row=>row.quoteProvenance.quoted));assert(extracted.passages.every(row=>row.scopeLimited));
 const result=await createCandidate({hash,embed,scorePairs}).analyze(docs([text,text+' 다른 기록']));assert(!result.analysis.interests.length);assert(result.limitations.includes('fragmented_sentence_scope_abstention'));assert(result.diagnostics.perDocument[0].omissions.some(row=>row.reason==='full_sentence_scope_unavailable'));
});
test('distinct source/body supports are required and pair output never proves logical equivalence',async()=>{
 const input=docs(['실험 오차를 어떻게 줄일까?','실험 오차를 어떻게 줄일까?']);
 const duplicate=await createCandidate({hash,embed,scorePairs}).analyze(input);assert(!duplicate.analysis.interests.length);assert.equal(duplicate.diagnostics.possibleQuestionPairs,0);
 const distinct=await createCandidate({hash,embed,scorePairs}).analyze(docs(['실험 오차를 어떻게 줄일까?','관측 오차를 어떻게 줄여야 할까?']));
 const question=distinct.analysis.interests.find(row=>row.kind==='question');assert(question);assert.equal(question.logicalEquivalenceProven,false);assert.equal(question.evidenceScope,'saved_material');
});
test('question syntax includes indirect questions and model verification remains separate',async()=>{
 const input=docs(['밤에 잠을 설친 원인이 저녁 식사와 관련되는지 궁금하다.','관측 오차가 기온에 따라 달라지는지 알고 싶다.']);
 const result=await createCandidate({hash,embed,scorePairs:pairs=>pairs.map(()=>0.01)}).analyze(input);
 assert.equal(result.diagnostics.questionCandidates.length,2);assert.equal(result.diagnostics.questionhoodAccepted,0);assert.equal(result.analysis.interests.length,0);
});
test('no 50-document legacy cap or 8-output combined cap is retained',async()=>{
 const input=docs(Array.from({length:60},(_,i)=>`실험 관측의 ${i}번째 연구 결과를 기록했다.`));
 const result=await createCandidate({hash,embed,scorePairs}).analyze(input);assert.equal(result.analysis.documents.length,60);assert(result.analysis.interests.some(row=>row.support===60));assert(CONFIG.maxTopicOutputs+CONFIG.maxQuestionPairOutputs>8);
});
test('in-flight text mutation, duplicate IDs and ambiguous UTF8 inputs fail closed',async()=>{
 const input=docs(['실험 연구를 기록했다.']);
 const candidate=createCandidate({hash,embed:values=>{input.documents[0].text+=' 바뀐 문장';return embed(values);},scorePairs});await assert.rejects(candidate.analyze(input),{code:'INPUT_STALE'});
 for(const texts of [['\ud800'],['\udc00'],['문장\u0000본문']])await assert.rejects(extractDocuments(docs(texts),{hash}),{code:'CANDIDATE_INPUT_INVALID'});
 const duplicate=docs(['첫 문장','둘째 문장']);duplicate.documents[1].id=duplicate.documents[0].id;await assert.rejects(extractDocuments(duplicate,{hash}),{code:'CANDIDATE_INPUT_INVALID'});
});
test('abort and whole-pipeline between-call deadline refuse late or over-budget outcomes',async()=>{
 const input=docs(['실험 관측 결과를 기록했다.','관측 실험 자료를 분석했다.']);const controller=new AbortController();
 const cancelled=createCandidate({hash,embed,scorePairs:pairs=>{controller.abort();return scorePairs(pairs);}});await assert.rejects(cancelled.analyze(input,{signal:controller.signal}),{name:'AbortError'});
 let calls=0;const timed=createCandidate({hash,embed,scorePairs,clock:()=>calls++?CONFIG.maxWallMilliseconds+1:0});await assert.rejects(timed.analyze(input),{code:'WALL_CLOCK_BUDGET_EXCEEDED'});
});
test('NLI token overflow is visible and safe peers are retried without silent truncation',async()=>{
 let first=true;const candidate=createCandidate({hash,embed,scorePairs:pairs=>{if(first){first=false;throw Object.assign(new Error('too long'),{code:'INPUT_TOO_LONG',pairIds:[pairs[0].id]});}return scorePairs(pairs);}});
 const result=await candidate.analyze(docs(['실험 연구를 기록했다.','관측 실험 결과를 분석했다.']));assert(result.incomplete);assert(result.limitations.includes('nli_token_overflow'));assert.equal(result.diagnostics.nli.overflow.length,1);assert(result.diagnostics.nli.processed>0);
});

test('source versions and identical copies use maximum independent source/body support',async()=>{
 const input={documents:[
  {id:'a',sourceId:'same-source',text:'실험 관측 결과 A를 기록했다.',originalAuthor:{relation:'self'}},
  {id:'b',sourceId:'same-source',text:'실험 관측 결과 B를 기록했다.',originalAuthor:{relation:'self'}},
  {id:'c',sourceId:'other-source',text:'실험 관측 결과 A를 기록했다.',originalAuthor:{relation:'other'}}
 ]};
 const result=await createCandidate({hash,embed,scorePairs}).analyze(input);
 const topic=result.analysis.interests.find(row=>row.kind==='topic');assert(topic);assert.equal(topic.support,2);
 assert.equal(new Set(topic.evidence.map(row=>row.sourceId)).size,2);assert.equal(new Set(topic.evidence.map(row=>row.sha256)).size,2);
});
