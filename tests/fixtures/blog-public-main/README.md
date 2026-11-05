# 공개 투영 main 고정본

`blog.js.gz`는 main `8dd2f6f62a039db3678cd0e4bebf00caaec23f69`의 `assets/life/blog.js` 전체 원본을 수정 없이 압축한 것이다. 압축을 푼 원문은 12,281바이트, SHA-256은 `9f8fcf9baaed07da802ed8c177cab7d8e66e04203ae5c270678b4bf91c862f50`이다. 원본 파일과 같은 라이선스를 따른다.

`tests/blog-public-markdown.test.cjs`는 Git 기록·네트워크 없이 이 원본을 읽고 길이·SHA를 검증한 뒤 실행한다. 실제 v1/v2 문서와 고정 새 사진 ID를 양쪽에 주어 공개 JSON 전체 바이트를 비교한다. 본문/메타데이터 사진 순서가 반대인 경우, 선택 사진 0·1·2장, 줄바꿈 없는 사진 앞 글, 여러 문단·서식·AI 표시를 포함한다. v2에서는 Markdown 모듈을 호출하지 않는 것도 검사한다.

재생성(저장소 루트, Python 3):

```python
import gzip, hashlib, pathlib, subprocess
raw = subprocess.check_output(['git', 'show', '8dd2f6f62a039db3678cd0e4bebf00caaec23f69:assets/life/blog.js'])
assert len(raw) == 12281
assert hashlib.sha256(raw).hexdigest() == '9f8fcf9baaed07da802ed8c177cab7d8e66e04203ae5c270678b4bf91c862f50'
pathlib.Path('tests/fixtures/blog-public-main/blog.js.gz').write_bytes(gzip.compress(raw, mtime=0))
```
