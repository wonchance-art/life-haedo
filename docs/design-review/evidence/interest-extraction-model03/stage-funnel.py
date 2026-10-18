#!/usr/bin/env python3
"""Read-only post-run diagnostic join. No inference, score changes, retuning or scorer edits."""
import hashlib,importlib.util,json
from collections import defaultdict
from pathlib import Path
R=Path(__file__).resolve().parent
H=lambda data:hashlib.sha256(data).hexdigest()
fixture=json.loads((R/'private-heldout.json').read_bytes());output=json.loads((R/'heldout-output.json').read_bytes());runtime=json.loads((R/'heldout-runtime.json').read_bytes());scored=json.loads((R/'heldout-result.normalized.json').read_bytes())
assert H((R/'private-heldout.json').read_bytes())==scored['fixtureSHA256']
assert H((R/'evaluate-heldout.py').read_bytes())==scored['evaluatorSHA256']
cache_path=R/('heldout-cache-'+runtime['runFingerprint'][:16]+'.jsonl')
assert H(cache_path.read_bytes())==runtime['cacheSHA256']
cachelines=[json.loads(line) for line in cache_path.read_text().splitlines() if line]
assert cachelines[0]['fingerprint']==runtime['runFingerprint']
records={row['key']:row['record'] for row in cachelines[1:]}
def nli(premise,hypothesis):
 key='nli:'+H(json.dumps([premise,hypothesis],ensure_ascii=False,separators=(',',':')).encode())
 record=records.get(key)
 return None if record is None else {'cacheKey':key,'recordedPairId':record.get('pairId'),'entailment':record.get('entailment'),'logits':record.get('logits'),'probabilities':record.get('probabilities')}
spec=importlib.util.spec_from_file_location('frozen_evaluate',R/'evaluate-heldout.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
docs={d['id']:d for d in fixture['documents']};hashes=fixture['bodySHA256'];diag=output['diagnostics'];config=runtime['candidateConfig'];templates=runtime['templateManifest']
registry={p['id']:p for p in diag['passageRegistry']};decisions={(d['passageId'],d['topicId']):d for d in diag['topicNliDecisions']}
perdoc={d['id']:d for d in diag['perDocument']}
gold=defaultdict(list)
for d in docs.values():
 for t in d['expectedTopicIds']:gold[(hashes[d['id']],t)].append(d['id'])
final={(e['bodySHA256'],e['topicId']) for e in scored['evidence'] if e['interestKind']=='topic' and e['semanticValid']}
topic_rows=[]
for (body,topic),dids in sorted(gold.items(),key=lambda pair:(pair[0][1],pair[1][0])):
 shortlisted=[];measured=[];passed=[]
 for did in dids:
  d=docs[did]
  for s in perdoc[did]['stages']['topicShortlist']:
   if topic not in s.get('topicIds',[]):continue
   p=registry[s['passageId']];checked=m.evidence_check(p,docs,hashes)
   if not checked['integrityValid'] or checked['forbidden']:continue
   fraction=max([m.overlap_nonspace(d['text'],p,span)/max(1,m.ucompactlen(p['quote'])) for span in d['allowedTopicSpans'].get(topic,[])],default=0)
   if fraction<0.5:continue
   shortlisted.append(s['passageId'])
   decision=decisions.get((s['passageId'],topic))
   if decision is not None:
    measured.append(decision)
    if decision['entailment']>=config['topicEntailment'] and decision['control']<config['controlEntailment']:passed.append(decision)
 topic_rows.append({'documentIds':dids,'bodySHA256':body,'topicId':topic,'goldShortlisted':bool(shortlisted),'goldShortlistedPassageIds':shortlisted,
  'goldNliMeasured':bool(measured),'goldNliAccepted':bool(passed),'finalDistinctBodyEvidence':(body,topic) in final,'measuredGoldDecisions':measured})
question_map={q['id']:q for q in diag['questionCandidates']}
qrows=[];qbygold=defaultdict(list)
for qid,q in question_map.items():
 check=m.evidence_check(q,docs,hashes)
 hood=nli(q['quote'],templates['questionhood']);control=nli(q['quote'],templates['control'])
 accepted=hood is not None and control is not None and hood['entailment']>=config['questionhoodEntailment'] and control['entailment']<config['controlEntailment']
 row={'candidateId':qid,'documentId':check['documentId'],'matchedGoldQuestions':check['matchedQuestions'],'sourceCorrect':check['integrityValid'],
  'questionhood':hood,'control':control,'questionhoodAndControlAccepted':accepted}
 qrows.append(row)
 for g in check['matchedQuestions']:qbygold[(g['documentId'],g['questionIndex'])].append(row)
shortlist={frozenset([p['left'],p['right']]):p for p in diag['questionShortlist']}
cluster_rows=[]
for goldcluster in fixture['questionClusters']:
 left_id,right_id=goldcluster['documentIds'];lc=qbygold.get((left_id,0),[]);rc=qbygold.get((right_id,0),[])
 combinations=[]
 for l in lc:
  for rr in rc:
   selected=frozenset([l['candidateId'],rr['candidateId']]) in shortlist
   forward=nli(question_map[l['candidateId']]['quote'],question_map[rr['candidateId']]['quote'])
   backward=nli(question_map[rr['candidateId']]['quote'],question_map[l['candidateId']]['quote'])
   combinations.append({'leftCandidateId':l['candidateId'],'rightCandidateId':rr['candidateId'],'retrievalShortlisted':selected,
    'bothQuestionhoodAccepted':l['questionhoodAndControlAccepted'] and rr['questionhoodAndControlAccepted'],
    'forwardNli':forward,'backwardNli':backward,'bothDirectionsMeasured':forward is not None and backward is not None,
    'bothDirectionsAccepted':forward is not None and backward is not None and forward['entailment']>=config['questionEntailment'] and backward['entailment']>=config['questionEntailment']})
 cluster_rows.append({'goldClusterId':goldcluster['id'],'documentIds':[left_id,right_id],'bothSourceDetected':bool(lc and rc),
  'truePairShortlisted':any(p['retrievalShortlisted'] for p in combinations),
  'bothQuestionhoodAccepted':any(p['bothQuestionhoodAccepted'] for p in combinations),
  'bothDirectionsMeasured':any(p['bothDirectionsMeasured'] for p in combinations),'bothDirectionsAccepted':any(p['bothDirectionsAccepted'] for p in combinations),
  'finalClusterOutput':goldcluster['id'] in scored['metrics']['repeatedQuestions']['recoveredClusterIds'],'candidatePairs':combinations})
goldquestion_rows=[r for r in qrows if r['matchedGoldQuestions']]
all_topic_scores=[d['entailment'] for d in diag['topicNliDecisions']]
gold_topic_scores=[d['entailment'] for r in topic_rows for d in r['measuredGoldDecisions']]
all_hood_scores=[r['questionhood']['entailment'] for r in qrows if r['questionhood'] is not None]
summary={'topic':{'goldDistinctBodyTopicPairs':len(topic_rows),'goldShortlisted':sum(r['goldShortlisted'] for r in topic_rows),
 'goldNliMeasured':sum(r['goldNliMeasured'] for r in topic_rows),'goldNliAccepted':sum(r['goldNliAccepted'] for r in topic_rows),
 'finalDistinctBodyEvidence':sum(r['finalDistinctBodyEvidence'] for r in topic_rows),'maxMeasuredGoldTopicEntailment':max(gold_topic_scores,default=None),
 'maxAnyTopicEntailment':max(all_topic_scores,default=None),'topicEntailmentThreshold':config['topicEntailment']},
 'questions':{'goldSourceCount':18,'goldSourcesDetected':len({g['documentId'] for r in goldquestion_rows for g in r['matchedGoldQuestions']}),
  'goldSourcesQuestionhoodAccepted':sum(r['questionhoodAndControlAccepted'] for r in goldquestion_rows),'rawQuestionCandidates':len(qrows),
  'allRawQuestionhoodAccepted':sum(r['questionhoodAndControlAccepted'] for r in qrows),'goldClusters':6,
  'goldTruePairsShortlisted':sum(r['truePairShortlisted'] for r in cluster_rows),'goldTruePairsBothQuestionhoodAccepted':sum(r['bothQuestionhoodAccepted'] for r in cluster_rows),
  'goldTruePairsBothDirectionsMeasured':sum(r['bothDirectionsMeasured'] for r in cluster_rows),'goldTruePairsBothDirectionsAccepted':sum(r['bothDirectionsAccepted'] for r in cluster_rows),
  'finalGoldClusters':sum(r['finalClusterOutput'] for r in cluster_rows),'maxAnyQuestionhoodEntailment':max(all_hood_scores,default=None),
  'questionhoodThreshold':config['questionhoodEntailment']},
 'zeroOutputInterpretation':{'observedFalsePositiveEvidence':0,'verifiedPositiveOutputEvidence':len(scored['evidence']),
  'precisionConvention':'Each empty output head gets 0 by preregistration because gold positives exist; empirical false-positive rate and source accuracy of nonexistent positive outputs cannot be estimated.',
  'unmeasuredPairStage':'If questionhood excludes all pairs, zero repeated-question recall does not demonstrate that bidirectional NLI scored true pairs incorrectly; that stage never ran.'}}
result={'schemaVersion':1,'summary':summary,'topicGoldFunnel':topic_rows,'questionSourceFunnel':qrows,'questionGoldClusterFunnel':cluster_rows,
 'provenance':{'candidateSHA256':runtime['candidateSHA256'],'runnerSHA256':runtime['runnerSHA256'],'cacheSHA256':runtime['cacheSHA256'],
  'cacheFile':str(cache_path),'cacheFingerprintMatches':True,'frozenEvaluatorSHA256':scored['evaluatorSHA256']},
 'method':'Post-run read-only join of frozen gold, source references, top-three stage records, raw cache logits and frozen thresholds. No model, fixture, evaluator, hypothesis or score change.',
 'scope':'Measured failure location; does not identify whether model weights, hypothesis wording or calibration is the ultimate cause without another independent experiment.'}
(R/'stage-funnel.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
