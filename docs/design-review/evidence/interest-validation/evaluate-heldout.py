#!/usr/bin/env python3
"""Sealed MODEL-02 evidence evaluation. Never imports an implementation or runs inference."""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEALED_FIXTURE_SHA256 = 'c7ac6d3c3978ed97acc0530ca63799cbff7a9af16504c18caa3d4324af360791'
SEALED_PREREGISTRATION_SHA256 = '416da12b15441ef4507396edc66894db95e5bf83ad677c57eca59e5f22d88fc7'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utf16len(text):
    return len(text.encode('utf-16-le')) // 2


def slice16(text, start, end):
    return text.encode('utf-16-le')[start*2:end*2].decode('utf-16-le')


def nonspace(text):
    return len(re.sub(r'\s', '', text))


def overlap_content(text, evidence_start, evidence_end, span):
    start = max(evidence_start, span['start'])
    end = min(evidence_end, span['end'])
    return nonspace(slice16(text, start, end)) if end > start else 0


def extract_analysis(output):
    result = output.get('result', output)
    return result.get('analysis', result)


def source_id_map(output, documents):
    mapping = {}
    for doc_id in documents:
        mapping[doc_id] = doc_id
        mapping['s-' + doc_id] = doc_id
        mapping['v-' + doc_id] = doc_id
    explicit = output.get('sourceMap', {})
    if isinstance(explicit, list):
        for row in explicit:
            for key in ['sourceId', 'sourceVersionId']:
                if row.get('documentId') in documents and row.get(key):
                    mapping[row[key]] = row['documentId']
    elif isinstance(explicit, dict):
        for key, value in explicit.items():
            if isinstance(value, str) and value in documents:
                mapping[key] = value
            elif isinstance(value, dict):
                doc_id = value.get('documentId', key)
                if doc_id in documents:
                    for field in ['sourceId', 'sourceVersionId']:
                        if value.get(field):
                            mapping[value[field]] = doc_id
    return mapping


def explicit_self_attribution(item, evidence_rows):
    nonself = [row['documentId'] for row in evidence_rows if row.get('authorRelation') in ['unknown', 'other']]
    if not nonself:
        return []
    flags = []
    self_values = {'self', 'user', 'current_user', 'current-user', 'owner'}
    author_keys = {'authorrelation', 'beliefowner', 'perspective', 'subjectrelation', 'attributedto', 'authorship', 'subject'}
    source_quotes = {row.get('quote', '') for row in evidence_rows}
    def inspect(node, path='interest'):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ['evidence', 'documents', 'sourceVersions']:
                    continue
                low = key.lower()
                if low in author_keys and isinstance(value, str) and value.lower() in self_values:
                    flags.append({'path': path+'.'+key, 'value': value, 'reason': 'explicit_self_metadata', 'nonselfDocuments': nonself})
                if low == 'originalauthor' and isinstance(value, dict) and value.get('relation') == 'self':
                    flags.append({'path': path+'.'+key, 'value': value, 'reason': 'explicit_self_metadata', 'nonselfDocuments': nonself})
                if isinstance(value, str) and key in ['label','title','summary','description','reason','question','text'] and value not in source_quotes:
                    # Narrow declared user belief/interest assertion patterns, not generic UI ownership wording.
                    if re.search(r'(?:당신|사용자)(?:은|는|이|가).{0,40}(?:믿|좋아|생각|관심|궁금|질문)', value) or re.search(r'(?:나의|내)\s*(?:신념|관심사|반복\s*질문)', value):
                        flags.append({'path':path+'.'+key,'value':value,'reason':'explicit_self_wording','nonselfDocuments':nonself})
                inspect(value, path+'.'+key)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                inspect(value, path+f'[{index}]')
    inspect(item)
    return flags


def evaluate(name, output, fixture, freeze):
    docs = {doc['id']:doc for doc in fixture['documents']}
    doc_hash = fixture['bodySHA256']
    topics = {topic['id'] for topic in fixture['topics']}
    gold_clusters = {row['id']:{doc_hash[doc_id] for doc_id in row['documentIds']} for row in fixture['questionClusters']}
    expected = {topic:{doc_hash[d['id']] for d in docs.values() if topic in d['expectedTopicIds']} for topic in topics}
    mapping = source_id_map(output, docs)
    analysis = extract_analysis(output)
    interests = analysis.get('interests', [])
    if not isinstance(interests, list):
        raise ValueError(name+': interests must be an array')
    evidence_rows=[]
    interest_rows=[]
    errors=[]
    conflations=[]
    support_errors=[]
    duplicate_errors=[]
    retrieved=defaultdict(set)
    recovered_clusters=set()
    impure_questions=[]
    topic_items=0
    question_items=0
    for index, interest in enumerate(interests):
        interest_id=interest.get('id', f'item-{index}')
        kind=interest.get('kind')
        if kind=='topic': topic_items+=1
        elif kind=='question': question_items+=1
        else: errors.append({'interestId':interest_id,'reason':'unknown_interest_kind','kind':kind})
        topic_id=interest_id.removeprefix('topic-') if kind=='topic' else None
        if kind=='topic' and topic_id not in topics:
            errors.append({'interestId':interest_id,'reason':'unknown_topic_id'})
        rows=[]
        for eindex, evidence in enumerate(interest.get('evidence', [])):
            source_doc=mapping.get(evidence.get('sourceId'))
            version_doc=mapping.get(evidence.get('sourceVersionId'))
            doc_id=source_doc if source_doc==version_doc else None
            quote=evidence.get('quote')
            row={'interestId':interest_id,'interestKind':kind,'evidenceIndex':eindex,'topicId':topic_id,
                 'documentId':doc_id,'quote':quote,'sourceId':evidence.get('sourceId'),
                 'sourceVersionId':evidence.get('sourceVersionId'),'sourceReferenceCorrect':doc_id in docs,
                 'hashCorrect':False,'offsetAndQuoteCorrect':False,'forbidden':False,'semanticValid':False,
                 'questionCluster':None,'bodySHA256':None,'authorRelation':None,'allowedSpanFraction':0.0}
            if doc_id in docs:
                doc=docs[doc_id]
                text=doc['text']
                row['bodySHA256']=doc_hash[doc_id]
                row['authorRelation']=doc['originalAuthor']['relation']
                row['expectedTopicIds']=doc['expectedTopicIds']
                row['questionCluster']=doc.get('expectedQuestionCluster')
                row['hashCorrect']=evidence.get('sha256')==doc_hash[doc_id]
                start,end=evidence.get('start'),evidence.get('end')
                valid_range=type(start) is int and type(end) is int and 0<=start<end<=utf16len(text)
                if valid_range:
                    try:
                        original=slice16(text,start,end)
                        row['offsetAndQuoteCorrect']=isinstance(quote,str) and quote==original
                        row['forbidden']=any(overlap_content(text,start,end,span)>0 for span in doc['forbiddenPositiveSpans'])
                        if 'negative' in doc['tags']:row['forbidden']=True
                        denominator=max(1,nonspace(original))
                        fraction=max([overlap_content(text,start,end,span)/denominator for span in doc['allowedTopicSpans'].get(topic_id,[])],default=0)
                        row['allowedSpanFraction']=fraction
                        row['semanticValid']=(kind=='topic' and fraction>=0.5 and not row['forbidden'])
                    except UnicodeDecodeError:
                        row['offsetAndQuoteCorrect']=False
                if doc['originalAuthor']['relation'] in ['unknown','other']:
                    if evidence.get('authorRelation')=='self' or evidence.get('originalAuthor',{}).get('relation')=='self':
                        conflations.append({'interestId':interest_id,'documentId':doc_id,'reason':'evidence_author_relation_rewritten_to_self'})
            row['integrityValid']=all(row[key] for key in ['sourceReferenceCorrect','hashCorrect','offsetAndQuoteCorrect'])
            rows.append(row)
        hashes=[row['bodySHA256'] for row in rows if row['bodySHA256']]
        repeated=[body for body,count in Counter(hashes).items() if count>1]
        if repeated:duplicate_errors.append({'interestId':interest_id,'repeatedBodyHashes':repeated})
        support=interest.get('support')
        if type(support) is not int or support<len(set(hashes)) or support>len(set(doc_hash.values())):
            support_errors.append({'interestId':interest_id,'reportedSupport':support,'visibleDistinctBodyCount':len(set(hashes)),'reason':'support_outside_documented_bounds'})
        conflations.extend(explicit_self_attribution(interest,rows))
        question_gold=None
        question_valid=False
        if kind=='question':
            clusters={row['questionCluster'] for row in rows}
            pure_cluster=next(iter(clusters)) if len(clusters)==1 else None
            if pure_cluster in gold_clusters:
                correct_hashes={row['bodySHA256'] for row in rows if row['integrityValid'] and not row['forbidden']}
                question_valid=len(correct_hashes)>=2 and correct_hashes<=gold_clusters[pure_cluster]
                if question_valid:
                    question_gold=pure_cluster
                    if gold_clusters[pure_cluster]<=correct_hashes:recovered_clusters.add(pure_cluster)
            if not question_valid:
                impure_questions.append({'interestId':interest_id,'observedGoldClusterIds':sorted(str(c) for c in clusters),'documentIds':[row['documentId'] for row in rows]})
            for row in rows:
                row['semanticValid']=question_valid and row['integrityValid'] and not row['forbidden']
        for row in rows:
            # Wrong source/offset cannot supply a scored true positive.
            row['semanticValid']=row['semanticValid'] and row['integrityValid']
            if kind=='topic' and row['semanticValid']:
                retrieved[topic_id].add(row['bodySHA256'])
        interest_rows.append({'id':interest_id,'kind':kind,'label':interest.get('label'),
                              'topicId':topic_id,'reportedSupport':support,'evidenceCount':len(rows),
                              'semanticValidEvidenceCount':sum(row['semanticValid'] for row in rows),
                              'questionGoldCluster':question_gold,'questionClusterValid':question_valid,
                              'visibleDistinctBodyCount':len(set(hashes))})
        evidence_rows.extend(rows)
    precision=sum(row['semanticValid'] for row in evidence_rows)/len(evidence_rows) if evidence_rows else 0.0
    question_evidence=[row for row in evidence_rows if row['interestKind']=='question']
    question_precision=sum(row['semanticValid'] for row in question_evidence)/len(question_evidence) if question_evidence else 0.0
    per_topic={topic:{'expectedDistinctBodyCount':len(expected[topic]),'correctEvidenceDistinctBodyCount':len(retrieved[topic]&expected[topic]),
                      'recall':len(retrieved[topic]&expected[topic])/len(expected[topic])} for topic in sorted(topics)}
    macro_recall=sum(value['recall'] for value in per_topic.values())/len(topics)
    covered=sum(len(retrieved[topic]&expected[topic])>=2 for topic in topics)
    integrity_count=sum(row['integrityValid'] for row in evidence_rows)
    integrity_accuracy=integrity_count/len(evidence_rows) if evidence_rows else 0.0
    forbidden_count=sum(row['forbidden'] for row in evidence_rows)
    question_recall=len(recovered_clusters)/len(gold_clusters)
    middle_id=fixture['gates']['longMiddle']['documentId']
    long_valid=sum(row['documentId']==middle_id and row['interestKind']=='topic' and row['semanticValid'] for row in evidence_rows)
    token_counts=output.get('tokenCounts',output.get('inference',{}).get('tokenCounts',{}))
    if isinstance(token_counts,list) and len(token_counts)==len(docs):token_counts={d['id']:c for d,c in zip(fixture['documents'],token_counts)}
    long_tokens=token_counts.get(middle_id) if isinstance(token_counts,dict) else None
    unchanged=output.get('bundleUnchanged',output.get('originalBundleUnchanged'))
    code_sha=output.get('sourceSHA256')
    sealed=freeze.get(name,{})
    sealed_sha=sealed.get('sha256',sealed.get('sourceSHA256')) if isinstance(sealed,dict) else sealed
    source_frozen=bool(code_sha and sealed_sha and code_sha==sealed_sha)
    freeze_fixture_sha=freeze.get('heldoutSHA256',freeze.get('fixtureSHA256'))
    freeze_fixture_matches=freeze_fixture_sha==SEALED_FIXTURE_SHA256
    checks={
      'semanticEvidencePrecisionAtLeast95':precision>=0.95,
      'noForbiddenPositiveEvidence':forbidden_count==0,
      'atLeastEightTopicsWithTwoValidBodies':covered>=8,
      'macroPerTopicRecallAtLeast50':macro_recall>=0.5,
      'questionClusterRecallAtLeast75':question_recall>=0.75,
      'questionEvidencePrecisionAtLeast95':question_precision>=0.95,
      'noImpureOrSingletonQuestionClusters':not impure_questions,
      'allSourceSHAOffsetsCorrect':integrity_accuracy==1.0,
      'noWithinInterestDuplicateBodies':not duplicate_errors,
      'supportWithinDeclaredBounds':not support_errors,
      'noUnknownOrOtherToSelfConflation':not conflations,
      'inputBundleUnchanged':unchanged is True,
      'longMiddleEvidenceFound':long_valid>=1,
      'untruncatedLongTokenCountOver512':type(long_tokens) is int and long_tokens>512,
      'sourceMatchesPrerunFreezeManifest':source_frozen,
      'fixtureMatchesPrerunFreezeManifest':freeze_fixture_matches,
      'noUnknownOutputKindsOrTopics':not errors,
    }
    return {'name':name,'sourceSHA256':code_sha,'model':output.get('model'),'runtime':output.get('runtime'),'config':output.get('config'),
            'metrics':{'interestCount':len(interests),'topicCount':topic_items,'questionCount':question_items,'evidenceCount':len(evidence_rows),
                       'semanticValidEvidenceCount':sum(row['semanticValid'] for row in evidence_rows),'semanticEvidencePrecision':precision,
                       'forbiddenPositiveEvidenceCount':forbidden_count,'topicLabelsWithTwoValidBodies':covered,
                       'topicLabelCoverage':covered/len(topics),'macroPerTopicEvidenceRecall':macro_recall,
                       'goldQuestionClusterRecall':question_recall,'questionEvidencePrecision':question_precision,
                       'recoveredQuestionClusterIds':sorted(recovered_clusters),'sourceSHAOffsetAccuracy':integrity_accuracy,
                       'longMiddleValidEvidenceCount':long_valid,'longDocumentUntruncatedTokenCount':long_tokens},
            'absoluteGates':checks,'allAbsoluteGatesPassed':all(checks.values()),'perTopic':per_topic,'interests':interest_rows,'evidence':evidence_rows,
            'errors':errors,'conflations':conflations,'duplicateBodyErrors':duplicate_errors,'supportErrors':support_errors,
            'impureOrSingletonQuestionClusters':impure_questions,
            'limitations':['Authorship wording scan checks declared explicit patterns only; absence of flags does not prove all possible language is correctly attributed.',
                          'Reported support is checked against visible evidence/input bounds; unexposed internal support attribution cannot be independently reconstructed.',
                          'Source freeze ordering must also be supported by recorded run/disclosure chronology; matching hashes alone do not prove chronological independence.']}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,default=ROOT/'baseline-output.json')
    parser.add_argument('--candidate',type=Path,default=ROOT/'candidate-output.json')
    parser.add_argument('--freeze',type=Path,default=ROOT/'frozen-sources.json')
    parser.add_argument('--output',type=Path,default=ROOT/'heldout-result.json')
    args=parser.parse_args()
    fixture_bytes=(ROOT/'private-heldout.json').read_bytes()
    if digest(fixture_bytes)!=SEALED_FIXTURE_SHA256:raise ValueError('Sealed held-out fixture changed')
    if digest((ROOT/'preregistration.md').read_bytes())!=SEALED_PREREGISTRATION_SHA256:raise ValueError('Preregistration changed')
    fixture=json.loads(fixture_bytes)
    for doc in fixture['documents']:
        assert digest(doc['text'].encode())==fixture['bodySHA256'][doc['id']]
    freeze=json.loads(args.freeze.read_bytes()) if args.freeze.exists() else {}
    baseline=evaluate('baseline',json.loads(args.baseline.read_bytes()),fixture,freeze)
    candidate=evaluate('candidate',json.loads(args.candidate.read_bytes()),fixture,freeze)
    bm,cm=baseline['metrics'],candidate['metrics']
    names=['semanticEvidencePrecision','macroPerTopicEvidenceRecall','goldQuestionClusterRecall']
    deltas={name:cm[name]-bm[name] for name in names}
    relative={
      'noPrecisionRegression':deltas['semanticEvidencePrecision']>=0,
      'noTopicRecallRegression':deltas['macroPerTopicEvidenceRecall']>=0,
      'noQuestionRecallRegression':deltas['goldQuestionClusterRecall']>=0,
      'atLeastOneStrictImprovement':any(value>0 for value in deltas.values()),
      'sameModel':bool(baseline['model']) and baseline['model']==candidate['model'],
      'sameRuntime':bool(baseline['runtime']) and baseline['runtime']==candidate['runtime'],
    }
    accepted=candidate['allAbsoluteGatesPassed'] and all(relative.values())
    out={'schemaVersion':2,'fixtureSHA256':SEALED_FIXTURE_SHA256,'preregistrationSHA256':SEALED_PREREGISTRATION_SHA256,
         'evaluatorSHA256':digest(Path(__file__).read_bytes()),'baselineOutputSHA256':digest(args.baseline.read_bytes()),
         'candidateOutputSHA256':digest(args.candidate.read_bytes()),'baseline':baseline,'candidate':candidate,
         'relativeGates':relative,'metricDeltas':deltas,'adoptionDecision':'accept_limited_candidate' if accepted else 'reject_or_withhold',
         'scope':'Frozen synthetic held-out evidence evaluation, not a claim of population accuracy or production usefulness.'}
    args.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    report=['# MODEL-02 held-out 비교 결과','',f"판정: **{'제한적 수용' if accepted else '기각 또는 미확립 조건으로 보류'}**. 사전등록 기준과 fixture를 변경하지 않았다.",'',
            '| 지표 | baseline | candidate |','|---|---:|---:|']
    for name in ['semanticEvidencePrecision','macroPerTopicEvidenceRecall','goldQuestionClusterRecall','questionEvidencePrecision','sourceSHAOffsetAccuracy']:
        report.append(f"| {name} | {bm[name]:.4f} | {cm[name]:.4f} |")
    report.extend(['','candidate 실패·미확립 조건:',''])
    report.extend('- '+name for name,passed in candidate['absoluteGates'].items() if not passed)
    report.extend('- relative: '+name for name,passed in relative.items() if not passed)
    report.extend(['','잘못된 candidate 근거:',''])
    for row in candidate['evidence']:
        if not row['semanticValid']:
            report.append(f"- {row['interestId']} / {row['documentId']}: {row['quote']!r}; forbidden={row['forbidden']}, integrity={row['integrityValid']}.")
    report.extend(['','source 동결의 실제 시간 순서, unknown/other 귀속 문구의 광범위한 언어적 정확성, 내부에서만 계산한 support는 기록과 별도 검토가 필요하다. 이 표본은 실제 사용자 자료의 대표성이 없다.'])
    (ROOT/'heldout-report.md').write_text('\n'.join(report)+'\n')
    print(json.dumps({'decision':out['adoptionDecision'],'baseline':bm,'candidate':cm,'relativeGates':relative,'failedCandidateGates':[name for name,passed in candidate['absoluteGates'].items() if not passed]},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
