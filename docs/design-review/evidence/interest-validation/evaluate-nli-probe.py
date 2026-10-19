#!/usr/bin/env python3
"""Evaluate the frozen 12-pair NLI probe; does not run inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parent
FIXTURE_SHA256='ac01222b172847a154dfa209a5f9aadd9b5cca73e5bd300a459995cf2b8c4863'
PREREGISTRATION_SHA256='72497e3fcab76457a259cbfcc8e69690e53b9112fabed29c835709bd3ba6dc92'
MODEL='onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX'
REVISION='cdc8277b4682665e2f2e87cd83da7da07b153d75'
LABELS={'0':'entailment','1':'neutral','2':'contradiction'}

def sha(data):return hashlib.sha256(data).hexdigest()

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--input',type=Path,default=ROOT/'nli-output.json')
 parser.add_argument('--output',type=Path,default=ROOT/'nli-result.json')
 args=parser.parse_args()
 fb=(ROOT/'private-nli-probe.json').read_bytes()
 assert sha(fb)==FIXTURE_SHA256,'Frozen probe changed'
 assert sha((ROOT/'nli-preregistration.md').read_bytes())==PREREGISTRATION_SHA256,'Preregistration changed'
 fixture=json.loads(fb); output_bytes=args.input.read_bytes();output=json.loads(output_bytes)
 predictions=output.get('predictions',[])
 by_id={}
 problems=[]
 for prediction in predictions:
  if prediction.get('id') in by_id:problems.append('duplicate prediction id: '+str(prediction.get('id')))
  by_id[prediction.get('id')]=prediction
 expected_ids={pair['id'] for pair in fixture['pairs']}
 unknown_ids=set(by_id)-expected_ids
 if unknown_ids:problems.append('unexpected IDs: '+str(sorted(str(i) for i in unknown_ids)))
 rows=[]
 for pair in fixture['pairs']:
  pred=by_id.get(pair['id'])
  logits=pred.get('logits') if isinstance(pred,dict) else None
  valid=isinstance(logits,list) and len(logits)==3 and all(type(v) in [int,float] and math.isfinite(v) for v in logits)
  label=None;tie=False;winner=None
  if valid:
   maximum=max(logits);ties=[i for i,value in enumerate(logits) if value==maximum]
   tie=len(ties)>1;winner=ties[0];label=LABELS[str(winner)]
  else:problems.append('missing or invalid 3-logit output: '+pair['id'])
  rows.append(dict(pair,logits=logits,predictedLabel=label,predictedLabelId=winner,topScoreTie=tie,
                   correct=valid and not tie and label==pair['expectedLabel']))
 correct=sum(row['correct'] for row in rows)
 neg=[row for row in rows if row['category']=='negation']
 quoted=[row for row in rows if row['category']=='quoted_historical_command']
 reported_mapping=output.get('id2label')
 if isinstance(reported_mapping,list):reported_mapping={str(i):value for i,value in enumerate(reported_mapping)}
 elif isinstance(reported_mapping,dict):reported_mapping={str(k):value for k,value in reported_mapping.items()}
 checks={
  'allTwelvePairsHaveThreeFiniteLogits':len(predictions)==12 and not problems,
  'pinnedModel':output.get('modelId',output.get('model'))==MODEL,
  'pinnedRevision':output.get('revision',output.get('modelRevision'))==REVISION,
  'mappingMatchesPinnedConfig':reported_mapping==LABELS,
  'q8':output.get('dtype')=='q8',
  'atLeastTenCorrect':correct>=10,
  'allThreeNegationsCorrect':len(neg)==3 and all(row['correct'] for row in neg),
  'allThreeQuotedHistoricalCommandsCorrect':len(quoted)==3 and all(row['correct'] for row in quoted),
 }
 runtime_success=all(checks[k] for k in ['allTwelvePairsHaveThreeFiniteLogits','pinnedModel','pinnedRevision','mappingMatchesPinnedConfig','q8'])
 passed=all(checks.values())
 decision='limited_followup_feasible' if passed else ('feasibility_not_established_runtime_or_provenance' if not runtime_success else 'probe_quality_gate_failed')
 category_counts={category:{'correct':sum(row['correct'] for row in rows if row['category']==category),'total':sum(row['category']==category for row in rows)} for category in sorted({row['category'] for row in rows})}
 result={'schemaVersion':1,'fixtureSHA256':FIXTURE_SHA256,'preregistrationSHA256':PREREGISTRATION_SHA256,
  'evaluatorSHA256':sha(Path(__file__).read_bytes()),'outputSHA256':sha(output_bytes),
  'correctCount':correct,'totalCount':12,'accuracy':correct/12 if runtime_success else None,
  'modelRuntimeAndProvenanceEstablished':runtime_success,'checks':checks,'decision':decision,
  'scope':'Bounded feasibility probe only; no feature adoption and no revision of failed MODEL-02 held-out decision.',
  'categoryResults':category_counts,'pairs':rows,'problems':problems,
  'runtimeObservation':{k:output.get(k) for k in ['modelId','revision','runtime','device','dtype','prepareMs','inferenceMs','errors']},
  'limits':['Small synthetic pairs do not establish production precision, recall, user belief attribution, long-context support, or deployment performance.',
            'Any modified candidate tested against these exposed pairs requires a fresh independent probe for generalization claims.']}
 args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 text=['# 비공개 NLI 가능성 검사','',f"판정: **{decision}**. 후속 조사 가능성만 평가하며 기능 도입을 뜻하지 않는다.",'',
       f"정답 {correct}/12. 부정 {sum(row['correct'] for row in neg)}/3, 과거 명령 인용 {sum(row['correct'] for row in quoted)}/3.",'',
       '사전 기준은 전체 ≥10/12 및 부정·과거 명령 인용 각각 전부 정답이다. argmax와 정답·threshold는 변경하지 않았다.','',
       '실패·미확립 조건:','']
 text.extend('- '+key for key,value in checks.items() if not value)
 text.extend(['','오답 또는 실행되지 않은 pair:',''])
 text.extend(f"- {row['id']} ({row['category']}): 정답 {row['expectedLabel']}, 예측 {row['predictedLabel']}, logits={row['logits']}" for row in rows if not row['correct'])
 text.extend(['','현재 48문서 후보 도입 기각은 그대로 유지된다. 이 작은 검사는 실제 사용자 자료나 제품 품질의 대표 평가가 아니다.'])
 (ROOT/'nli-report.md').write_text('\n'.join(text)+'\n')
 print(json.dumps({'decision':decision,'correct':correct,'total':12,'checks':checks,'categoryResults':category_counts},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
