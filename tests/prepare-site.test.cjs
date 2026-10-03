const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function build(target){return spawnSync(process.execPath,['scripts/prepare-site.mjs',target],{cwd:root,encoding:'utf8',env:{...process.env,HAEDO_SUPABASE_URL:'https://life-sync-test.supabase.co',HAEDO_SUPABASE_KEY:'sb_publishable_anonymous_build_test'}});}
test('repeat public build removes stale private canary and old SDK while preserving source config',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haedo-public-build-'));
  const target=path.join(dir,'site'),source=await fs.readFile(path.join(root,'assets/platform-config.js'),'utf8');
  try{
    let result=build(target);assert.equal(result.status,0,result.stderr);
    await fs.writeFile(path.join(target,'old-private-canary.txt'),'anonymous stale private file');
    await fs.writeFile(path.join(target,'vendor/supabase.js'),'old SDK');
    result=build(target);assert.equal(result.status,0,result.stderr);
    await assert.rejects(fs.access(path.join(target,'old-private-canary.txt')));
    await assert.rejects(fs.access(path.join(target,'vendor/supabase.js')));
    await fs.access(path.join(target,'vendor/supabase/supabase.js'));await fs.access(path.join(target,'life.html'));
    assert.equal(await fs.readFile(path.join(root,'assets/platform-config.js'),'utf8'),source);
    assert.match(await fs.readFile(path.join(target,'assets/platform-config.js'),'utf8'),/sb_publishable_anonymous_build_test/);
    await assert.rejects(fs.access(path.join(target,'.git')));await assert.rejects(fs.access(path.join(target,'tests')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unowned nonempty output and source/symlink destinations are rejected without deleting files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haedo-build-guard-'));
  try{
    const target=path.join(dir,'unowned');await fs.mkdir(target);await fs.writeFile(path.join(target,'keep.txt'),'keep');
    assert.notEqual(build(target).status,0);assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'keep');
    assert.notEqual(build(root).status,0);assert.notEqual(build(path.join(root,'assets','generated')).status,0);
    const link=path.join(dir,'linked');await fs.symlink(path.join(root,'assets'),link,'dir');
    assert.notEqual(build(path.join(link,'generated')).status,0);
    await assert.rejects(fs.access(path.join(root,'assets','generated')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
