# 개인 동기화 구현 계약

2026-10-03 · R1 다음 우선 작업. 기존 charts·인증 설정과 독립적으로 새 자료를 Mac·iPad·iPhone에서 이어 본다. 원문·발췌·삭제 표식을 포함한 작업공간 스냅샷을 단위로 한다. 문서별 자동 병합·공동 편집·원문 삭제 UI는 이번 범위가 아니다.

## 책임과 파일

- data: assets/life/storage.js 및 tests/life-storage.test.cjs. 로컬 sync 메타데이터와 원자 경계.
- domains: assets/life/sync.js 및 tests/life-sync.test.cjs. 연결 세대·영속 재시도·두 방향 조정.
- architecture: assets/life/remote.js, tests/life-remote.test.cjs, vendor/supabase/, OSS 비교 문서. 공식 SDK Auth·REST adapter.
- ai: supabase/migrations/20261003085426_life_sync_workspaces.sql, tests/life-sql.cjs, scripts/check-life-cloud.py. 서버 CAS·RLS·영수증·SQL/실서버 검증. AI 모델 호출 없음.
- experience: assets/life/ui.js, ui.css. 연결/로그인·계정/현재 공간·서버 목록·충돌/연결 해제 화면.
- review: tests/life-sync-browser.cjs, 독립 코드 검토. 별도 브라우저 context. 기존 브라우저 회귀의 versionchange 등 변경 필요는 담당과 합의.
- root: life.html, shell.js, sw.js, service-worker 회귀, README·구현 기록·통합 검증. Core 수정은 필요 시 root와 조율.

## 서버

테이블 public.life_workspaces: `(owner_id uuid,id uuid)` PK, `title text,revision bigint,data jsonb,updated_at timestamptz`. data는 Core bundle이며 data.workspaceId=id, schemaVersion=1. 소유자는 auth.uid(). authenticated SELECT만 RLS로 허용하며 직접 INSERT/UPDATE/DELETE 금지. anon은 모두 금지. life_sync_receipts는 일반 역할 접근 금지.
RPC `life_sync_put(p_workspace_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb)` → JSON `{status:'stored',revision}` / `{status:'conflict',revision}` / `{status:'missing'}`. expectedRevision=0일 때만 최초 생성. 서버 시각·정수 revision 사용, 클라이언트 시각 승자 없음.
소유자와 작업공간에 한정한 operationId, 요청 expectedRevision+JSONB payload의 SHA256 지문, 저장 결과를 같은 서버 tx에 보관. 같은 요청 재시도는 기존 결과 반환, 같은 ID·다른 내용은 명시 오류. 동시 최초 생성과 두 쓰기를 직렬화하며 receipt 조회를 적절한 잠금 후 재확인한다. 성공 영수증만 보존.
SECURITY DEFINER가 필요하면 auth.uid() 필수 검사, 고정 search_path, 모든 객체명 한정, PUBLIC/anon EXECUTE 회수, authenticated에게만 명시 grant. 함수 외 직접쓰기 권한으로 CAS 우회 불가. 기존 charts/사용자 데이터/함수 변경 금지. 신규 범위만 재실행 가능 SQL, schema reload notify.
전송 최대 16 MiB JSON 스냅샷(서버에서도 검사), 초과하면 로컬 자료를 보존하고 크기 제한 표시. 다른 소유자의 같은 UUID 존재를 누출하지 않는다. RPC의 새 테이블/권한 설치가 실제 프로젝트에 필요하다.

## Remote

전역 `HaedoLife.Remote`, 기존 chart CLOUD/localStorage를 읽지 않는다. 검토한 공식 supabase-js 안정판 UMD+MIT고지를 고정 동봉. SDK 전체 도입/기존 REST 재사용/직접 Auth 구현 비용을 비교해 결정한다. Secret/service_role 키 거절, HTTPS URL(userinfo/경로/쿼리금지)·publishable/anon 공개 키만.
`Remote.create({url,key})` → adapter. `Remote.loadConfig()` → `{url,key}|null`; `Remote.saveConfig(config|null)`은 새 전용 localStorage키만. SDK session storageKey는 새 자료 전용이며 프로젝트별 분리. 비밀번호 저장/로그 금지, 백업은 연결/세션을 포함하지 않음.
adapter `getAccount()` async → `{userId,email,projectUrl}|null` (서버 확인 가능한 SDK auth.getUser/session 경계); `signIn(email,password)` → account; `signOut()`; `onAuthChange(listener)`→unsubscribe; `dispose()` (구독·자동갱신중지).
`list()` → `[{id,title,revision,updated_at}]`; `read(id)` → `{id,title,revision,data,updated_at}|null`; `write({workspaceId,expectedRevision,operationId,data})` → 위 RPC JSON. raw server errors는 키·본문·email 등 노출 없이 code/message 정제. schema missing은 error.code='schema_missing', auth 필요는 'auth_required'.
read의 data는 Core.validateWorkspace + contentText별 WebCrypto SHA256 검사, id=data.workspaceId 일치. 에러 시 파손 원격 데이터를 로컬에 덮지 않는다. list는 메타데이터만. 쓰기/수신 최대 크기 검증. 테스트를 위해 create 두번째 optional options(clientFactory 등) 허용.

## Storage (기존 DB version1 유지)

새 meta key `sync:<workspaceId>`를 사용한다. 기존 bundle schema/백업은 그대로 유지한다. sync 메타: `{workspaceId,binding:{projectUrl,userId,remoteId},enabled,remoteRevision:0,syncedLocalRevision:-1,outbox:null,conflict:null,status:'pending',error:null}`. 로컬 소유자 binding은 연결을 끊어도 남고 다른 계정 자동 업로드를 막는다. 다른 계정으로 옮길 때는 명시 백업 사본(새 ID)부터.
`commitLocal`은 meta를 같은 tx에 포함하여 연결된 공간의 pending 상태를 남긴다. outbox가 있으면 변경하지 않는다. 후속 로컬편집은 bundle에 저장되고 이전 outbox 성공 뒤 새 작업으로 전송한다.
- `getSyncState(workspaceId)` → metadata|null.
- `bindSync(workspaceId,binding)` → metadata. 처음에는 remoteRevision0/syncedLocalRevision-1. 이전 binding과 다르면 throw account_mismatch. 동일 binding 재개는 outbox/base 보존·enabled=true.
- `pauseSync(workspaceId,binding)` → enabled=false, outbox/base 보존.
- `prepareSyncUpload(workspaceId,binding)` → outbox|null. tx 안에서 현재bundle+sync 읽기, binding/enabled 확인, 기존 outbox면 그대로 반환. localRevision!=syncedLocalRevision일 때 `{operationId,expectedRevision:remoteRevision,localRevision:bundle.revision,data:clone(bundle)}`를 영속 생성. 빈 JSON 우회 금지.
- `ackSync(workspaceId,binding,operationId,remoteRevision)` → metadata. 현재 outbox일치와 binding/enabled검사. remoteRevision 갱신·syncedLocalRevision=outbox.localRevision·outbox=null. 최신bundle이 더변경됐으면 pending, 아니면 synced.
- `applySyncRemote(workspaceId,binding,row)` → `{status:'stored'|'conflict',revision}`. 같은 binding/enabled; outbox없고 현재bundle.revision==syncedLocalRevision인 때만 수신 적용. 원문 버전 같은ID 내용변조 거절. 로컬revision은 현재+1, remoteRevision=row.revision, syncedLocalRevision=새로컬revision 원자 갱신. stage 유지.
- `installSyncRemote(row,binding)` → 새 bundle. local workspaceId 충돌시 덮기금지. bundle+binding(sync기준)+active pointer 원자 설치. remote data의 ID는 여러기기에서 유지(백업사본복원과 구별). 새 로컬revision0, syncedLocalRevision0.
- `setSyncConflict(workspaceId,binding,row|null)` → metadata. outbox 유지, conflict `{missing,row,remoteRevision,localRevision}`에 서버snapshot/revision 또는 missing 표시. 이미 관찰한 것보다 낮은 remoteRevision을 반영하지 않음.
- `setSyncError(workspaceId,binding,{code,message}|null)` → metadata. 로컬/outbox 보존. null은 성공한 확인 뒤 오류를 지우고 현재 자료에 맞는 상태를 복원한다.
- `resolveSync(workspaceId,binding,{choice:'local'|'remote',expectedLocalRevision,remoteRow,copy})` → `{bundle,metadata,copyWorkspaceId}`. copy는 선택하지 않은 쪽을 Core.restoreBackup(makeBackup(...))로 재매핑한 별도 로컬 작업공간. 한 tx에서 기준 로컬rev/binding/conflictremoteRev 확인, copy 신규 설치, recovery기록, resolve 반영. remote선택: 원격data를 현재공간 새localrev로적용하고outbox삭제/synced 기준설정. local선택: 현재bundle유지, remoteRevision=검토한서버rev, outbox삭제/syncedLocalRevision=-1/pending→새CAS전송. 서버가그사이바뀌면또충돌. missing은덮어쓰기재생성하지않고사본이동/연결중단.
모든 stale binding 결과는 거절. 메모리 알림은 권한 검사가 아니며 원자 tx 완료후 changed/sync_changed 이벤트. 실수로 SDK키·session을 이 메타/backup에 넣지 않는다.

## Sync manager

`HaedoLife.Sync.create({storage,core,remoteFactory?})` → manager. remoteFactory 기본 `Remote.create`.
`start()` → 저장한 전용 연결/세션을 재개, 최초 연결없으면 네트워크0. `connect({url,key,email,password})` → 검증계정 연결·전용config저장. `signOut()` → 연결 세대 변경·실행취소·세션/저장된 연결 설정 제거, 로컬자료/outbox는 유지. 만료 세션의 오프라인 로그아웃 실패에도 다음 앱 시작에서 자동 재개하지 않는다. 다음 로그인에는 프로젝트 연결 정보를 다시 입력할 수 있다.
`getAccount()` → 현재계정|null; `getConfig()`→공개URL/key|null; `getState(workspaceId)` async→ `{status,enabled,binding,remoteRevision,syncedLocalRevision,conflict,error,account}` (outbox본문 UI에 노출 불필요).
`subscribe(listener)`→unsubscribe. 이벤트 UI갱신일뿐 입력초안덮기금지.
`enable(workspaceId)`은 현재계정에 명시 연결해 업로드허용. 계정로그인만으로 로컬공간자동업로드X. 최초 remote.read 해당UUID가이미있으면 중복 연결/덮기거절하고서버목록에서열도록안내. 같은이전binding재개허용.
`pause(workspaceId)` → outbox·binding보존중지. `listRemote()`→목록. `download(remoteId)` → 서버원문검증→새로컬공간/동일binding깨끗한공간으로수신,다른계정/dirty ID충돌 덮기X. `syncNow(workspaceId)`는 공간별직렬실행,epoch+project+user동일성검사. 실제현재계정과binding일치때만 처리.
첫binding은durableoutbox CAS 생성. 이미연결된경우 remote.read→서버base와localdirty비교: localdirty+remote변경은충돌, localclean+remote변경은검증후수신, 서버같고localdirty는전송. **기존outbox가있으면먼저 같은요청 재전송/영수증대조**하여 응답유실을 다른변경충돌로오인하지않음. 새로컬편집은첫outbox ack뒤다음작업으로전송.
`resolve(workspaceId,choice,{expectedLocalRevision?,expectedRemoteRevision?})`는 화면에관찰된conflict버전과양쪽내용을기준으로 선택하지않은쪽의새사본준비→Storage.resolveSync→local선택이면CAS sync. 자동선택/무조건업서트없음.
로컬 변경 debounce·online·visible복귀·60초주기에서enabled공간처리, 복구시영속outbox부터. signout/config·account변경시epoch증가하고이전응답무시,절대새계정에oldpayload전송X. 저장 세션으로 오프라인 시작에 실패하면 공개 연결 설정을 보존하고 online/visible/주기에서 단일 재접속한다. 인증 거절은 자동 재로그인하지 않는다. 대체된 로그인 후보·진행 중 로그아웃 adapter도 즉시 폐기해 이전 SDK가 새 세션을 덮거나 지우지 않게 한다. SDK refresh실패와네트워크실패는구분. dispose()는timer·listeners·subscriptions정리.

## UI 연결

shell은 Remote/Sync를 주입하고 `UI.mount(container,{storage,core,legacy,sync})`, 기존 test/로컬UI에서는sync옵션없어도작동. UI mount뒤Sync.start시점은shell과조율,UIdispose시syncdispose.
'기기 간 동기화'화면: 프로젝트URL·공개키·이메일·비밀번호(자동기존chart설정읽기X),로그인/로그아웃, 현재계정/프로젝트·현재공간status. 별도 '이 작업공간 동기화 시작'과'지금 동기화'·'연결 중지'.
서버목록에서선택한공간만내려받기. 내초안 dirty이면보관후전환. 로그인·다운로드로기존로컬자료자동올리기X.
충돌은양쪽원문/발췌수·제목·서버rev·변경범위미리보기(원문참조가능)를보여주고 '서버 변경 받기·내 변경은 사본 보관' / '내 변경 보내기·서버 변경은 사본 보관'. 결과와새사본위치명시. 서버삭제 missing은단순새생성하지않음.
로컬저장/원격동기화상태분리. 오류에서원문과초안유지. schema_missing이면준비한SQL파일/설치안내를연결(사용자에게SQL/키를기본제품흐름으로반복노출하지않고연결설정도움말에만).

## 검증과 실서버 상태

Local이 동일 원본 SQL을 버전 `20261003085426`으로 설치했고 Cloud의 A/B 실제 HTTP 검사 11개를 통과했다. 재설치를 요청하지 않는다. 서버 JSONB 크기 제한과 큰 HTTP 본문의 비정형 401은 구분하며 익명 8행의 정확한 정리 SQL은 Local 관리자에게 인계한다. 상세 결과는 [인계 검증](local-handoff-verification.md)을 따른다.

제품 통합은 Google OAuth·PKCE 공용 SDK/세션을 재사용한다. `remoteFactory: HaedoLife.PlatformRemote.create`와 `sync.start()`를 사용한다. 인계의 매개변수 없는 `sync.connect()`는 현재 Cloud 관리자가 지원하지 않으며 독립 비밀번호 입력을 제품에 추가하는 방식으로 해결하지 않는다. 공용 SDK 폐기를 금지하는 adapter 계약을 모의 HTTP에서 검증했으며 실제 HTML 연결과 계정별 로컬 목록·보호 경로 통합은 미완료다. Cloud 독립 화면의 인증 API는 개발 검증 기준이며 최종 제품 로그인 계약과 구분한다.
