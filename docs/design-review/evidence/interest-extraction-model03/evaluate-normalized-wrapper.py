#!/usr/bin/env python3
"""Lossless one-container schema normalization; rerun identical frozen scorer in an isolated report directory."""
import copy,hashlib,json,shutil,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parent
H=lambda b:hashlib.sha256(b).hexdigest()
protected=['heldout-runtime.json','heldout-result.json','heldout-report.md','private-heldout.json','preregistration.md','evaluate-heldout.py','candidate.mjs','run-experiment.cjs','heldout-output.json','heldout-coverage.json']
before={name:H((R/name).read_bytes()) for name in protected}
original=json.loads((R/'heldout-runtime.json').read_bytes());normal=copy.deepcopy(original)
old=original['wholeDocumentTokenCounts']['embedding']
assert isinstance(old,dict) and isinstance(old['rows'],list)
rows=old['rows'];assert len({row['id'] for row in rows})==len(rows)
new={key:copy.deepcopy(value) for key,value in old.items() if key!='rows'}
for row in rows:
 assert row['id'] not in new
 new[row['id']]=copy.deepcopy(row)
normal['wholeDocumentTokenCounts']['embedding']=new
# Prove every row and scalar metadata value is unchanged and no other field moved.
assert all(normal['wholeDocumentTokenCounts']['embedding'][row['id']]==row for row in rows)
assert {key:value for key,value in new.items() if key not in {row['id'] for row in rows}}=={key:value for key,value in old.items() if key!='rows'}
left=copy.deepcopy(original);right=copy.deepcopy(normal)
left['wholeDocumentTokenCounts']['embedding']=None;right['wholeDocumentTokenCounts']['embedding']=None
assert left==right
normal_path=R/'heldout-runtime.normalized.json';normal_path.write_text(json.dumps(normal,ensure_ascii=False,indent=2)+'\n')
audit={'schemaVersion':1,'reason':'Frozen scorer accepted direct list or per-document map; runner stored {rows:[...],elapsedMs}. The row wrapper is a representation difference, not a score change.',
 'allowedChangedContainer':'wholeDocumentTokenCounts.embedding','transform':'Move rows[] to embedding[documentId] objects; preserve every row verbatim and preserve elapsedMs/any other wrapper metadata in place.',
 'originalRuntimeSHA256':before['heldout-runtime.json'],'normalizedRuntimeSHA256':H(normal_path.read_bytes()),
 'rowsPreservedExactly':len(rows),'nonRowMetadataPreservedExactly':True,'allOtherRuntimeFieldsDeepEqual':True,
 'scoreThresholdLabelsOrSourceChanged':False}
work=R/'normalized-evaluation';work.mkdir(exist_ok=True)
for name in ['private-heldout.json','preregistration.md']:
 target=work/name
 if not target.exists():target.symlink_to(R/name)
 else:assert target.resolve()==(R/name).resolve()
scorer=work/'evaluate-heldout.py';scorer.write_bytes((R/'evaluate-heldout.py').read_bytes());assert H(scorer.read_bytes())==before['evaluate-heldout.py']
command=[sys.executable,str(scorer),'--candidate-output',str(R/'heldout-output.json'),'--runtime',str(normal_path),'--coverage',str(R/'heldout-coverage.json'),'--seal',str(R/'seal.json'),'--output',str(R/'heldout-result.normalized.json')]
completed=subprocess.run(command,capture_output=True,text=True,check=True)
shutil.copyfile(work/'heldout-report.md',R/'heldout-report.normalized.md')
for name,expected in before.items():assert H((R/name).read_bytes())==expected,name+' changed'
raw=json.loads((R/'heldout-result.json').read_bytes());normalized=json.loads((R/'heldout-result.normalized.json').read_bytes())
assert raw['metrics']==normalized['metrics']
assert raw['decision']==normalized['decision']
audit['originalProtectedFilesUnchanged']=before
audit['metricObjectsIdentical']=True;audit['decisionUnchanged']=True
audit['gateDifferences']={key:{'original':raw['gates'][key],'normalized':value} for key,value in normalized['gates'].items() if raw['gates'][key]!=value}
audit['command']=command
(R/'runtime-normalization-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
print(completed.stdout)
print(json.dumps({'normalizationAudit':str(R/'runtime-normalization-audit.json'),'onlyGateDifference':audit['gateDifferences'],'originalFilesUnchanged':True},ensure_ascii=False,indent=2))
