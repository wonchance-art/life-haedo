#!/usr/bin/env python3
"""Frozen MODEL-03 source/evidence evaluator; never imports candidate or runs models."""
import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parent
FIXTURE_SHA256='b56296da7ac356cbc9918b5b80026536f00ffbca7bf9a1f9d74c73756e9e46cf'
PREREGISTRATION_SHA256='ec8b2640527c5cf995ef691576ea1ac056f192523f2ce67fac01a8d5deb56511'


def sha(data):return hashlib.sha256(data).hexdigest()
def ulen(text):return len(text.encode('utf-16-le'))//2
def uslice(text,start,end):return text.encode('utf-16-le')[start*2:end*2].decode('utf-16-le')
def compact(text):return re.sub(r'[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]','',text)
def ucompactlen(text):return ulen(compact(text))
def getjson(path,default=None):return json.loads(path.read_bytes()) if path.exists() else default

def span_valid(text,row):
 return isinstance(row,dict) and type(row.get('start')) is int and type(row.get('end')) is int and 0<=row['start']<row['end']<=ulen(text)

def overlap_nonspace(text,a,b):
 start=max(a['start'],b['start']);end=min(a['end'],b['end'])
 return ucompactlen(uslice(text,start,end)) if end>start else 0

def merge(rows):
 out=[]
 for row in sorted(rows,key=lambda row:(row['start'],row['end'])):
  if out and row['start']<=out[-1]['end']:out[-1]['end']=max(out[-1]['end'],row['end'])
  else:out.append({'start':row['start'],'end':row['end']})
 return out

def union_length(rows):return sum(row['end']-row['start'] for row in merge(rows))
def uncovered(text,rows):
 total=0;end=0
 for row in merge(rows):total+=ucompactlen(uslice(text,end,row['start']));end=row['end']
 return total+ucompactlen(uslice(text,end,ulen(text)))

def subset_ranges(left,right):
 return all(sum(max(0,min(a['end'],b['end'])-max(a['start'],b['start'])) for b in merge(right))==a['end']-a['start'] for a in merge(left))

def wilson(k,n):
 if not n:return None
 z=1.959963984540054;p=k/n;denom=1+z*z/n
 center=(p+z*z/(2*n))/denom
 width=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom
 return {'lower':max(0,center-width),'upper':min(1,center+width),'method':'Wilson95 descriptive only'}

def infer_doc(evidence,docs):
 sid=evidence.get('sourceId');vid=evidence.get('sourceVersionId')
 sidmap={f's-{did}':did for did in docs};vidmap={f'v-{did}':did for did in docs}
 return sidmap.get(sid) if sidmap.get(sid)==vidmap.get(vid) else None

def question_matches(text,span,q):
 # Preserve every Unicode letter/number in the gold proposition; punctuation-only boundary changes are allowed.
 positions=[];cursor=q['start']
 for char in uslice(text,q['start'],q['end']):
  end=cursor+ulen(char)
  if char.isalnum():positions.append((cursor,end))
  cursor=end
 if not positions or span['start']>positions[0][0] or span['end']<positions[-1][1]:return False
 extra=0
 if span['start']<q['start']:extra+=ucompactlen(uslice(text,span['start'],q['start']))
 if span['end']>q['end']:extra+=ucompactlen(uslice(text,q['end'],span['end']))
 return extra<=ucompactlen(uslice(text,q['start'],q['end']))

def evidence_check(e,docs,hashes):
 did=infer_doc(e,docs)
 row={'documentId':did,'sourceId':e.get('sourceId'),'sourceVersionId':e.get('sourceVersionId'),'start':e.get('start'),'end':e.get('end'),
      'quote':e.get('quote'),'sourceCorrect':did in docs,'shaCorrect':False,'rangeAndQuoteCorrect':False,'authorRelationCorrect':False,
      'forbidden':False,'matchedQuestions':[],'goldBoundaryExact':False,'bodySHA256':None,'authorRelation':e.get('authorRelation')}
 if did not in docs:
  row['integrityValid']=False;return row
 d=docs[did];text=d['text'];row['bodySHA256']=hashes[did];row['expectedTopicIds']=d['expectedTopicIds']
 row['expectedAuthorRelation']=d['originalAuthor']['relation'];row['shaCorrect']=e.get('sha256')==hashes[did]
 row['authorRelationCorrect']=e.get('authorRelation')==d['originalAuthor']['relation']
 if span_valid(text,e):
  try:
   original=uslice(text,e['start'],e['end'])
   row['rangeAndQuoteCorrect']=e.get('quote')==original
   row['forbidden']=any(overlap_nonspace(text,e,s)>0 for s in d['forbiddenPositiveSpans'])
   for qi,q in enumerate(d['questions']):
    if question_matches(text,e,q) and not row['forbidden']:
     row['matchedQuestions'].append({'documentId':did,'questionIndex':qi,'clusterId':q['clusterId'],'form':q['form'],'repeated':q['repeated']})
     row['goldBoundaryExact']=row['goldBoundaryExact'] or (e['start']==q['start'] and e['end']==q['end'])
  except UnicodeDecodeError:pass
 row['integrityValid']=all(row[k] for k in ['sourceCorrect','shaCorrect','rangeAndQuoteCorrect','authorRelationCorrect'])
 return row

def attribution_flags(item,rows):
 flags=[];nonself=[r['documentId'] for r in rows if r.get('expectedAuthorRelation') in ['unknown','other']]
 exactquotes={r.get('quote') for r in rows}
 def scan(node,path='interest'):
  if isinstance(node,dict):
   for k,v in node.items():
    if k in ['evidence','documents']:continue
    if nonself and k.lower() in ['beliefowner','authorship','perspective','attributedto','subjectrelation'] and isinstance(v,str) and v.lower() in ['self','user','current_user','current-user']:
     flags.append({'path':path+'.'+k,'value':v,'reason':'explicit_current_user_attribution','nonselfDocuments':nonself})
    if nonself and k in ['label','title','description','summary','reason','question'] and isinstance(v,str) and v not in exactquotes:
     if re.search(r'(?:당신|사용자)(?:은|는|이|가).{0,40}(?:믿|좋아|생각|관심|궁금|질문)',v) or re.search(r'(?:나의|내)\s*(?:신념|관심사|반복\s*질문)',v):
      flags.append({'path':path+'.'+k,'value':v,'reason':'explicit_current_user_wording','nonselfDocuments':nonself})
    scan(v,path+'.'+k)
  elif isinstance(node,list):
   for i,v in enumerate(node):scan(v,path+f'[{i}]')
 scan(item)
 for row in rows:
  if row.get('expectedAuthorRelation') in ['unknown','other'] and row.get('authorRelation')=='self':flags.append({'documentId':row['documentId'],'reason':'source_author_rewritten_to_self'})
 return flags

def coverage_audit(fixture,output,actual,runtime):
 docs={d['id']:d for d in fixture['documents']};hashes=fixture['bodySHA256'];diag=output.get('diagnostics',{})
 declared={row.get('id'):row for row in diag.get('perDocument',[])}
 observed={row.get('id'):row for row in (actual or {}).get('documents',[])}
 errors=[];perdoc=[]
 if set(declared)!=set(docs):errors.append({'reason':'candidate_document_coverage_set_mismatch'})
 if set(observed)!=set(docs):errors.append({'reason':'callback_document_coverage_set_mismatch'})
 for did,d in docs.items():
  text=d['text'];de=declared.get(did,{});ac=observed.get(did,{})
  de_errors=[];ac_errors=[];stages={};actual_stages={}
  if de.get('sourceId')!='s-'+did or de.get('sourceVersionId')!='v-'+did or de.get('sha256')!=hashes[did] or de.get('totalUTF16Characters')!=ulen(text) or de.get('nonWhitespaceUTF16Characters')!=ucompactlen(text):de_errors.append('candidate_source_hash_or_lengths')
  if ac.get('sourceId')!='s-'+did or ac.get('sourceVersionId')!='v-'+did or ac.get('rawUTF8SHA256')!=hashes[did] or ac.get('rawUTF16Characters')!=ulen(text):ac_errors.append('callback_source_hash_or_lengths')
  for name in ['scan','extraction','embedding','topicShortlist','topicNli','questionNli']:
   rows=de.get('stages',{}).get(name,[])
   good=[row for row in rows if span_valid(text,row)]
   if len(good)!=len(rows):de_errors.append('invalid_ranges:'+name)
   stages[name]={'ranges':merge(good),'coveredUTF16Characters':union_length(good),'uncoveredNonWhitespaceUTF16Characters':uncovered(text,good)}
  for name in ['extracted','embedding','nliPremise','nliAnyInput']:
   details=ac.get(name,{})
   rows=details.get('ranges',[]);good=[row for row in rows if span_valid(text,row)]
   if len(rows)!=len(good):ac_errors.append('invalid_ranges:'+name)
   expected_length=union_length(good);missing=uncovered(text,good)
   if details.get('coveredCharacters')!=expected_length or details.get('uncoveredNonWhitespaceCharacters')!=missing:ac_errors.append('range_union_accounting:'+name)
   actual_stages[name]={'ranges':merge(good),'coveredUTF16Characters':expected_length,'uncoveredNonWhitespaceUTF16Characters':missing}
  if stages['scan']['uncoveredNonWhitespaceUTF16Characters'] or stages['extraction']['uncoveredNonWhitespaceUTF16Characters']:de_errors.append('scan_or_extraction_nonspace_gap')
  # A full experiment must account for and embed all extracted nonspace. Explicit omission still fails adoption, without shrinking gold.
  if actual_stages['embedding']['uncoveredNonWhitespaceUTF16Characters']:ac_errors.append('actual_embedding_nonspace_gap')
  if stages['extraction']['ranges']!=actual_stages['extracted']['ranges']:ac_errors.append('candidate_vs_callback_extraction_mismatch')
  if stages['embedding']['ranges']!=actual_stages['embedding']['ranges']:ac_errors.append('candidate_vs_callback_embedding_mismatch')
  claimed_nli=merge(stages['topicNli']['ranges']+stages['questionNli']['ranges'])
  if not subset_ranges(claimed_nli,actual_stages['nliAnyInput']['ranges']):ac_errors.append('claimed_nli_not_observed')
  if de.get('incomplete'):de_errors.append('candidate_document_incomplete')
  perdoc.append({'documentId':did,'declared':stages,'actualCallback':actual_stages,'omissions':de.get('omissions',[]),'errors':de_errors+ac_errors})
  errors.extend({'documentId':did,'reason':e} for e in de_errors+ac_errors)
 tokens=runtime.get('tokenMeasurements',[])
 token_errors=[]
 for i,t in enumerate(tokens):
  n=t.get('untruncatedTokens');a=t.get('actualInputTokens')
  if type(n) is not int or type(a) is not int or n<=0 or n!=a or t.get('truncated') is not False or n>t.get('tokenLimit',512):token_errors.append({'tokenMeasurementIndex':i,'record':t})
 if not tokens:token_errors.append({'reason':'no_actual_token_measurements'})
 return {'passed':not errors and not token_errors,'documentCoverage':perdoc,'coverageErrors':errors,'tokenErrors':token_errors,
         'modelInputMeasurementCount':len(tokens),'silentOrInvalidTokenMeasurementCount':len(token_errors),
         'interpretation':'Actual source ranges for extraction/embedding/NLI are independent unions; scan coverage is not semantic validation coverage.'}

def evaluate(fixture,output,runtime,actual,seal):
 docs={d['id']:d for d in fixture['documents']};hashes=fixture['bodySHA256'];topics={t['id'] for t in fixture['topics']}
 analysis=output.get('analysis',output.get('result',{}).get('analysis',{}));diag=output.get('diagnostics',{})
 interests=analysis.get('interests',[]);goldq={(d['id'],i):q for d in docs.values() for i,q in enumerate(d['questions'])}
 goldclusters={c['id']:{hashes[did] for did in c['documentIds']} for c in fixture['questionClusters']}
 goldtopics={t:{hashes[d['id']] for d in docs.values() if t in d['expectedTopicIds']} for t in topics}
 detected=set();boundary=set();candidate_rows=[]
 for candidate in diag.get('questionCandidates',[]):
  row=evidence_check(candidate,docs,hashes);candidate_rows.append(row)
  if row['integrityValid']:
   for match in row['matchedQuestions']:
    key=(match['documentId'],match['questionIndex']);detected.add(key)
    if row['goldBoundaryExact']:boundary.add(key)
 retrieved=defaultdict(set);recovered=set();evidence=[];item_rows=[];mixed=[];duplicates=[];support_errors=[];critical=[];kind_errors=[]
 for index,item in enumerate(interests):
  iid=item.get('id',f'item-{index}');kind=item.get('kind');topic=iid.removeprefix('topic-') if kind=='topic' else None
  if kind not in ['topic','question'] or (kind=='topic' and topic not in topics):kind_errors.append({'id':iid,'kind':kind,'topicId':topic})
  rows=[]
  for e in item.get('evidence',[]):
   row=evidence_check(e,docs,hashes);row.update({'interestId':iid,'interestKind':kind,'topicId':topic,'semanticValid':False})
   if kind=='topic' and row['integrityValid'] and not row['forbidden'] and topic in topics:
    d=docs[row['documentId']];den=max(1,ucompactlen(row['quote']))
    fraction=max([overlap_nonspace(d['text'],row,s)/den for s in d['allowedTopicSpans'].get(topic,[])],default=0)
    row['allowedSpanFraction']=fraction;row['semanticValid']=fraction>=0.5
   rows.append(row)
  body_counts=Counter(r['bodySHA256'] for r in rows if r['bodySHA256'])
  repeated=[body for body,count in body_counts.items() if count>1]
  if repeated:duplicates.append({'interestId':iid,'bodyHashes':repeated})
  distinct_sources={r['sourceId'] for r in rows};distinct_bodies=set(body_counts)
  support=item.get('support')
  if type(support) is not int or support!=len(distinct_bodies):support_errors.append({'interestId':iid,'reportedSupport':support,'visibleDistinctBodies':len(distinct_bodies)})
  if item.get('evidenceScope')!='saved_material':critical.append({'interestId':iid,'reason':'missing_saved_material_evidence_scope'})
  critical.extend(attribution_flags(item,rows))
  matched_cluster=None;question_valid=False
  if kind=='question':
   clusterids={m['clusterId'] for r in rows for m in r['matchedQuestions']}
   if len(clusterids)==1:
    possible=next(iter(clusterids))
    question_valid=(possible in goldclusters and len(distinct_sources)>=2 and len(distinct_bodies)>=2 and not repeated and
                    all(r['integrityValid'] and not r['forbidden'] and len(r['matchedQuestions'])==1 and r['matchedQuestions'][0]['clusterId']==possible for r in rows))
    if question_valid:
     matched_cluster=possible
     if goldclusters[possible]<=distinct_bodies:recovered.add(possible)
   if not question_valid:mixed.append({'interestId':iid,'documentIds':[r['documentId'] for r in rows],'matchedGoldClusterIds':sorted(clusterids)})
   for row in rows:row['semanticValid']=question_valid
  for row in rows:
   if kind=='topic' and row['semanticValid']:retrieved[topic].add(row['bodySHA256'])
  item_rows.append({'id':iid,'kind':kind,'label':item.get('label'),'topicId':topic,'support':support,'evidenceCount':len(rows),
                    'semanticValidEvidenceCount':sum(r['semanticValid'] for r in rows),'questionGoldCluster':matched_cluster,'questionValid':question_valid})
  evidence.extend(rows)
 topic_e=[r for r in evidence if r['interestKind']=='topic'];question_e=[r for r in evidence if r['interestKind']=='question']
 def head(rows):
  k=sum(r['semanticValid'] for r in rows);n=len(rows)
  return {'valid':k,'total':n,'precision':k/n if n else 0.0,'Wilson95':wilson(k,n)}
 topic_metric=head(topic_e);question_metric=head(question_e)
 pertopic={t:{'expectedDistinctBodies':len(goldtopics[t]),'correctDistinctBodies':len(retrieved[t]&goldtopics[t]),'recall':len(retrieved[t]&goldtopics[t])/len(goldtopics[t])} for t in sorted(topics)}
 macro=sum(r['recall'] for r in pertopic.values())/len(topics)
 sentence_keys={key for key,q in goldq.items() if q['form']=='sentence'}
 detection=len(detected)/len(goldq);sentence_recall=len(detected&sentence_keys)/len(sentence_keys)
 cluster_recall=len(recovered)/len(goldclusters)
 forbidden=[r for r in evidence if r['forbidden']]
 integrity_correct=sum(r['integrityValid'] for r in evidence);integrity_accuracy=integrity_correct/len(evidence) if evidence else 0.0
 longs=[]
 length_rows=runtime.get('wholeDocumentTokenCounts',{}).get('embedding',[])
 if isinstance(length_rows,dict):lengths=length_rows
 else:lengths={r.get('id'):r.get('untruncatedTokens') for r in length_rows}
 for d in docs.values():
  if d['longPosition']:
   found=[r for r in topic_e if r['documentId']==d['id'] and r['semanticValid']]
   count=lengths.get(d['id']);count=count.get('untruncatedTokens') if isinstance(count,dict) else count
   longs.append({'documentId':d['id'],'position':d['longPosition'],'untruncatedBodyTokens':count,'validEvidenceCount':len(found),'bodyLongConfirmed':type(count) is int and count>512})
 coverage=coverage_audit(fixture,output,actual,runtime)
 provenance={
  'candidateMatchesSeal':bool(seal.get('candidateSHA256')) and runtime.get('candidateSHA256')==seal.get('candidateSHA256'),
  'runnerMatchesSeal':bool(seal.get('runnerSHA256')) and runtime.get('runnerSHA256')==seal.get('runnerSHA256'),
  'inputMatchesSeal':bool(seal.get('inputSHA256')) and runtime.get('inputSHA256')==seal.get('inputSHA256'),
  'runtimePassed':runtime.get('pass') is True,
  'actualModelPhasesPresent':{'embedding','nli'}<={phase.get('kind') for phase in runtime.get('modelPhases',[])},
  'noRuntimeFailure':not runtime.get('failure'),
  'noErrorsOrExternalBodyOrMutableRevision':not runtime.get('errors') and not runtime.get('bodyRequests') and not runtime.get('mutableRevisionRequests') and not runtime.get('networkViolations'),
 }
 checks={
  'topicEvidencePrecisionAtLeast95':topic_metric['precision']>=0.95,
  'questionEvidencePrecisionAtLeast95':question_metric['precision']>=0.95,
  'topicMacroDocumentRecallAtLeast70':macro>=0.70,
  'questionSourceDetectionRecallAtLeast70':detection>=0.70,
  'sentenceQuestionDetectionRecallAtLeast70':sentence_recall>=0.70,
  'repeatedQuestionClusterRecallAtLeast70':cluster_recall>=0.70,
  'noMixedSingletonOrDuplicateQuestionOutputs':not mixed,
  'noForbiddenPositiveEvidence':not forbidden,
  'allSourceSHAOffsetsAndAuthorRelationsCorrect':integrity_accuracy==1.0,
  'noDuplicateBodySupportWithinInterest':not duplicates,
  'displayedSupportMatchesAllVisibleDistinctBodies':not support_errors,
  'noCurrentUserBeliefOrAuthorshipPromotion':not critical and analysis.get('evidenceScope')=='saved_material',
  'allLongBeginningMiddleEndEvidenceFound':len(longs)==3 and all(r['validEvidenceCount']>=1 for r in longs),
  'allThreeWholeBodiesConfirmedOver512Tokens':len(longs)==3 and all(r['bodyLongConfirmed'] for r in longs),
  'coverageAccountingExactAndNoSilentTruncation':coverage['passed'],
  'inputBundleUnchanged':runtime.get('inputBundleUnchanged') is True,
  'notIncomplete':output.get('incomplete') is False and not runtime.get('failure'),
  'frozenProvenanceEstablished':all(provenance.values()),
  'noUnknownKindsOrTopics':not kind_errors,
 }
 return {'metrics':{'topicEvidence':topic_metric,'questionEvidence':question_metric,'topicMacroDocumentRecall':macro,
          'questionSourceDetection':{'matched':len(detected),'gold':len(goldq),'recall':detection,'boundaryExactMatched':len(boundary),'boundaryExactRecall':len(boundary)/len(goldq)},
          'sentenceQuestionSourceDetection':{'matched':len(detected&sentence_keys),'gold':len(sentence_keys),'recall':sentence_recall},
          'repeatedQuestions':{'matchedGoldClusters':len(recovered),'goldClusters':len(goldclusters),'recall':cluster_recall,'recoveredClusterIds':sorted(recovered)},
          'forbiddenPositiveEvidenceCount':len(forbidden),'sourceSHAOffsetAuthorAccuracy':integrity_accuracy,'sourceSHAOffsetAuthorCorrect':integrity_correct,
          'totalOutputEvidenceCount':len(evidence),'outputTopicCount':sum(i['kind']=='topic' for i in item_rows),'outputQuestionCount':sum(i['kind']=='question' for i in item_rows)},
          'gates':checks,'decision':'accept_limited_experiment' if all(checks.values()) else 'reject_or_withhold','perTopic':pertopic,'longDocuments':longs,
          'questionCandidateAudit':candidate_rows,'missedQuestionSources':[{'documentId':key[0],'questionIndex':key[1],**goldq[key]} for key in sorted(set(goldq)-detected)],
          'interests':item_rows,'evidence':evidence,'invalidQuestionOutputs':mixed,'duplicateBodyErrors':duplicates,'supportErrors':support_errors,'criticalAttributionFlags':critical,
          'kindErrors':kind_errors,'coverageAudit':coverage,'provenance':provenance,
          'limits':['All evidence must also be independently reread for semantic claims and invented question conditions; span annotations alone are not a natural-language proof.',
                    'No explicit attribution flag is a limited check on this synthetic output, not a universal authorship/belief guarantee.',
                    'Synthetic 60 documents do not establish real-user utility or population precision/recall; a passing experimental result is not automatic product activation.']}

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--candidate-output',type=Path,default=ROOT/'heldout-output.json')
 p.add_argument('--runtime',type=Path,default=ROOT/'heldout-runtime.json')
 p.add_argument('--coverage',type=Path,default=ROOT/'heldout-coverage.json')
 p.add_argument('--seal',type=Path,default=ROOT/'seal.json')
 p.add_argument('--output',type=Path,default=ROOT/'heldout-result.json')
 args=p.parse_args();fb=(ROOT/'private-heldout.json').read_bytes()
 assert sha(fb)==FIXTURE_SHA256,'Heldout fixture changed'
 assert sha((ROOT/'preregistration.md').read_bytes())==PREREGISTRATION_SHA256,'Preregistration changed'
 fixture=json.loads(fb);output=getjson(args.candidate_output,{}) or {};runtime=getjson(args.runtime,{}) or {};actual=getjson(args.coverage,{}) or {};seal=getjson(args.seal,{}) or {}
 if seal.get('evaluatorSHA256') and seal['evaluatorSHA256']!=sha(Path(__file__).read_bytes()):raise ValueError('Evaluator differs from sealed hash')
 result=evaluate(fixture,output,runtime,actual,seal)
 result.update({'schemaVersion':3,'fixtureSHA256':FIXTURE_SHA256,'preregistrationSHA256':PREREGISTRATION_SHA256,'evaluatorSHA256':sha(Path(__file__).read_bytes()),
                'candidateOutputSHA256':sha(args.candidate_output.read_bytes()) if args.candidate_output.exists() else None,
                'runtimeOutputSHA256':sha(args.runtime.read_bytes()) if args.runtime.exists() else None,
                'coverageOutputSHA256':sha(args.coverage.read_bytes()) if args.coverage.exists() else None})
 args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 m=result['metrics'];lines=['# MODEL-03 独립 held-out 평가','',f"판정: **{result['decision']}**. fixture·정답·사전 기준은 변경하지 않았다.",'',
  f"- topic 근거 {m['topicEvidence']['valid']}/{m['topicEvidence']['total']} ({m['topicEvidence']['precision']:.1%}); question 근거 {m['questionEvidence']['valid']}/{m['questionEvidence']['total']} ({m['questionEvidence']['precision']:.1%}).",
  f"- topic macro document recall {m['topicMacroDocumentRecall']:.1%}; 질문 source 검출 {m['questionSourceDetection']['matched']}/{m['questionSourceDetection']['gold']}; 문장형 {m['sentenceQuestionSourceDetection']['matched']}/{m['sentenceQuestionSourceDetection']['gold']}; 반복 군집 {m['repeatedQuestions']['matchedGoldClusters']}/{m['repeatedQuestions']['goldClusters']}.",
  f"- forbidden 양의 근거 {m['forbiddenPositiveEvidenceCount']}개; source/SHA/offset/author {m['sourceSHAOffsetAuthorCorrect']}/{m['totalOutputEvidenceCount']}.",'','실패·미확립 gate:','']
 lines.extend('- '+key for key,passed in result['gates'].items() if not passed)
 lines.extend(['','잘못된 양의 근거:',''])
 for row in result['evidence']:
  if not row['semanticValid']:lines.append(f"- {row['interestId']} / {row['documentId']}: {row['quote']!r}; forbidden={row['forbidden']}, integrity={row['integrityValid']}.")
 lines.extend(['','원문 scan, embedding, shortlist, 실제 NLI source 범위를 구분했다. 단일 합성 평가를 사용자 유용성이나 Apple 기기 성능으로 일반화하지 않는다. 최종 의미 재독은 별도 기록한다.'])
 (ROOT/'heldout-report.md').write_text('\n'.join(lines).replace('MODEL-03 独립','MODEL-03 독립')+'\n')
 print(json.dumps({'decision':result['decision'],'metrics':m,'failedGates':[key for key,value in result['gates'].items() if not value]},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
