# D2 구형 앱 호환성 고정본

`provenance.json`의 기준 커밋 `2eebd27cbde54f697c9de3a09382f2e21b39a743`에서 가져온 **수정하지 않은 전체** `photo-post.js`와 `storage.js`다. gzip은 저장 용량만 줄이며 원문 SHA-256은 압축을 푼 바이트로 검증한다. 저장소의 해당 원본 파일과 같은 라이선스를 따른다.

`tests/photo-post-old-client.test.cjs`는 Git 기록이나 네트워크 없이 이 원본을 실행한다. 구형 모듈이 거부하는 직접 읽기·저장과, 구형 수정 초안이 새 형식의 교체 대상을 지울 수 있는 과거의 결함을 구분한다. 후자를 안전하게 고쳤다고 주장하지 않는다. D2 2단계는 새 형식의 수정 초안과 원래 판의 복구 사본을 남겨야 하며 기존 구형 탭의 v2 초안은 별도 출시 위험이다.

재생성(저장소 루트, Python 3):

```python
import gzip, hashlib, json, pathlib, subprocess

root = pathlib.Path('tests/fixtures/post-markdown-old-client')
provenance = json.loads((root / 'provenance.json').read_text())
for entry in provenance['files']:
    raw = subprocess.check_output(['git', 'show', provenance['commit'] + ':' + entry['source']])
    assert len(raw) == entry['bytes']
    assert hashlib.sha256(raw).hexdigest() == entry['sha256']
    (root / entry['fixture']).write_bytes(gzip.compress(raw, mtime=0))
```

실행: `node --test tests/photo-post-old-client.test.cjs`
