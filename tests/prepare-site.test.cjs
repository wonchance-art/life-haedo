const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function build(target){return spawnSync(process.execPath,['scripts/prepare-site.mjs',target],{cwd:root,encoding:'utf8',env:{...process.env,HAEDO_SUPABASE_URL:'https://life-sync-test.supabase.co',HAEDO_SUPABASE_KEY:'sb_publishable_anonymous_build_test'}});}
test('repeat public build removes stale private canary and old SDK while preserving source config',async()=>{
  const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'haedo-public-build-'));
  const target=path.join(dir,'site'),source=await fs.readFile(path.join(root,'assets/platform-config.js'),'utf8');
  try{
    let result=build(target);assert.equal(result.status,0,result.stderr);
    await fs.writeFile(path.join(target,'old-private-canary.txt'),'anonymous stale private file');
    await fs.writeFile(path.join(target,'vendor/supabase.js'),'old SDK');
    result=build(target);assert.equal(result.status,0,result.stderr);
    await assert.rejects(fs.access(path.join(target,'old-private-canary.txt')));
    await assert.rejects(fs.access(path.join(target,'vendor/supabase.js')));
    await fs.access(path.join(target,'vendor/supabase/supabase.js'));await fs.access(path.join(target,'life.html'));
    await fs.access(path.join(target,'assets/life/icons.js'));await fs.access(path.join(target,'vendor/lucide/LICENSE'));
    const shell=(await fs.readFile(path.join(target,'sw.js'),'utf8')).match(/const\s+SHELL\s*=\s*\[([^\]]*)\]/)?.[1];
    assert.ok(shell,'Published worker must declare its complete offline shell.');
    for(const entry of shell.matchAll(/['"]([^'"]+)['"]/g))await fs.access(path.join(target,entry[1]));
    for(const name of (await fs.readdir(target)).filter(name=>name.endsWith('.html'))){
      const html=await fs.readFile(path.join(target,name),'utf8');
      if(name === 'share.html') {
        for (const privateModule of ['platform-auth.js','supabase.js','storage.js','core.js','shell.js','workbench-ui.js']) assert.equal(html.includes(privateModule),false,`public reader must not load ${privateModule}`);
        assert.match(html, /name="referrer" content="no-referrer"/);
        assert.match(html, /name="robots" content="noindex, nofollow"/);
      }
      if(['index.html','life.html'].includes(name)){
        const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
        const ordered=['assets/life/core.js','assets/life/workbench.js', 'assets/life/rediscovery.js','assets/life/storage.js','assets/life/workbench-ui.js','assets/life/home.js','assets/life/ui.js','assets/life/shell.js'];
        for(let index=0;index<ordered.length;index++){
          assert.equal(scripts.filter(src=>src===ordered[index]).length,1,`${name}: ${ordered[index]} must load once`);
          if(index)assert.ok(scripts.indexOf(ordered[index-1])<scripts.indexOf(ordered[index]),`${name}: dependency order`);
        }
        assert.ok(html.indexOf('href="assets/life/ui.css"')<html.indexOf('href="assets/life/workbench.css"'),`${name}: workbench follows shared styles`);
        assert.ok(html.indexOf('href="assets/life/workbench.css"')<html.indexOf('href="assets/life/home.css"'),`${name}: home follows shared styles`);
        assert.match(html,new RegExp(`data-haedo-section="${name==='index.html'?'home':'records'}"`),`${name}: correct initial section`);
      }
      for(const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)){
        for(const attr of tag[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)){
          if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(attr[1]))continue;
          await fs.access(path.join(target,decodeURIComponent(attr[1].split(/[?#]/)[0])));
        }
      }
    }
    assert.equal(await fs.readFile(path.join(root,'assets/platform-config.js'),'utf8'),source);
    assert.match(await fs.readFile(path.join(target,'assets/platform-config.js'),'utf8'),/sb_publishable_anonymous_build_test/);
    for(const internal of ['.git','.agents','tests','scripts','docs','assets/design-review','assets/design-social',
      'design-sample.html','social-sample.html','quote-sample.html','vendor/lucide/UPSTREAM.json']){
      await assert.rejects(fs.access(path.join(target,internal)),`${internal} must not be published`);
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unowned nonempty output and source/symlink destinations are rejected without deleting files',async()=>{
  const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'haedo-build-guard-'));
  try{
    const target=path.join(dir,'unowned');await fs.mkdir(target);await fs.writeFile(path.join(target,'keep.txt'),'keep');
    assert.notEqual(build(target).status,0);assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'keep');
    assert.notEqual(build(root).status,0);assert.notEqual(build(path.join(root,'assets','generated')).status,0);
    const link=path.join(dir,'linked');await fs.symlink(path.join(root,'assets'),link,'dir');
    assert.notEqual(build(path.join(link,'generated')).status,0);
    await assert.rejects(fs.access(path.join(root,'assets','generated')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
