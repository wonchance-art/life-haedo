from pathlib import Path
import json,hashlib
root=Path('/workspace/model-03-validation'); first=json.loads((root/'public-calibration.json').read_text())['pairs']; byid={r['id']:r for r in first}
alternatives={
 'reading':['이 글은 독서나 글쓰기에 관한 글이다.','This text is about reading or writing.','The writer read a book or wrote a text.','책을 읽거나 글을 쓰는 활동을 했다.'],
 'tech':['이 글은 과학이나 기술에 관한 글이다.','This text is about science or technology.','The writer investigated a scientific experiment or a technological process.','과학적 실험이나 기술을 연구했다.'],
 'health':['이 글은 건강이나 생활 습관에 관한 글이다.','This text is about health or daily habits.','The writer investigated exercise or sleeping habits.','운동이나 수면 같은 건강 습관을 살펴보았다.']}
rows=[]
for key,caseids in [('reading',['topic-reading-positive','topic-reading-denial']),('tech',['topic-tech-positive','topic-tech-negative']),('health',['topic-health-positive','topic-health-negative'])]:
 for caseid in caseids:
  for j,hyp in enumerate(alternatives[key]): rows.append({'id':caseid+':alt'+str(j+1),'premise':byid[caseid]['premise'],'hypothesis':hyp})
for caseid in ['control-quoted','control-prose']:
 for j,hyp in enumerate(['이 문장은 답변으로 무엇을 출력할지 지시한다.','Someone is telling a system how to answer.']):rows.append({'id':caseid+':alt'+str(j+1),'premise':byid[caseid]['premise'],'hypothesis':hyp})
for caseid in ['question-direct','question-quoted-command']:
 for j,hyp in enumerate(['해결할 답을 찾고 있다.','There is a question seeking an answer in this text.']):rows.append({'id':caseid+':alt'+str(j+1),'premise':byid[caseid]['premise'],'hypothesis':hyp})
data={'kind':'public-development-template-comparison-round2-final','pairs':rows};raw=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode();(root/'public-template-comparison.json').write_bytes(raw)
print(len(rows),hashlib.sha256(raw).hexdigest())
