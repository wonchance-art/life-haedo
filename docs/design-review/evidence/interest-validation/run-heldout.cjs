const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const base=__dirname, app='/workspace/haedo-discovery';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fixturePath=path.join(base,'private-heldout.json');
const fixture=JSON.parse(fs.readFileSync(fixturePath));
const docs=fixture.documents.map(({id,text,originalAuthor})=>({id,text,originalAuthor}));
const sources={baseline:'/workspace/model-01-validation/recovered/interest-analysis.cjs',candidate:path.join(base,'frozen-interest-analysis.js')};
const frozen={heldoutSHA256:sha(fixturePath),baseline:{sha256:sha(sources.baseline)},candidate:{sha256:sha(sources.candidate)}};
fs.writeFileSync(path.join(base,'frozen-sources.json'),JSON.stringify(frozen,null,2));
let browser;const network={requests:[],errors:[],responses:[],phases:[]};
const safe=u=>{const url=new URL(u);return url.origin+url.pathname};
(async()=>{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'},args:['--no-sandbox','--enable-precise-memory-info']});
 const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(30000);
 context.on('request',r=>{if(r.url().startsWith('https:'))network.requests.push({url:safe(r.url()),method:r.method(),hasBody:!!r.postData()});});
 context.on('response',r=>{if(r.url().startsWith('https:'))network.responses.push({url:safe(r.url()),status:r.status()});});
 page.on('console',m=>{if(m.type()==='error')network.errors.push({type:'console',message:m.text()});});
 page.on('pageerror',e=>network.errors.push({type:'page',message:e.message}));
 await page.exposeFunction('phase',p=>{network.phases.push(p);if(p.phase!=='analysis'||p.completed%64===0)console.log(JSON.stringify(p));});
 const r=await page.goto('http://127.0.0.1:4173/privacy.html');if(r.status()!==200)throw Error('harness HTTP status');
 await page.addScriptTag({url:'http://127.0.0.1:4173/assets/life/interest-model-loader.js'});
 network.idleRemoteRequests=network.requests.length;
 await page.evaluate(async()=>{window.owner=HaedoLife.InterestModel.create();const t=performance.now();window.localModel=await owner.loadModel({onProgress:p=>{if(p.phase==='verified')window.phase(p);}});window.prepareMs=performance.now()-t;window.phase({phase:'ready',preparedMs:prepareMs});});
 // Token counts are measured without truncation by the same fixed public tokenizer.
 const tokenCounts=await page.evaluate(async docs=>{const runtime=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');runtime.env.allowLocalModels=false;runtime.env.remotePathTemplate='{model}/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/';const tok=await runtime.AutoTokenizer.from_pretrained('Xenova/paraphrase-multilingual-MiniLM-L12-v2',{revision:'2c4055b12046f11709e9df2c122e59ffbdc2f900'});return Object.fromEntries(docs.map(d=>[d.id,tok.encode(d.text).length]));},docs);
 for(const name of ['baseline','candidate']){
   await page.addScriptTag({content:fs.readFileSync(sources[name],'utf8')});
   const output=await page.evaluate(async({docs,name})=>{
     const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
     const bundle={workspaceId:'heldout-workspace',revision:1,sources:docs.map(d=>({id:'s-'+d.id,title:'합성 자료 '+d.id})),sourceVersions:await Promise.all(docs.map(async d=>({id:'v-'+d.id,sourceId:'s-'+d.id,contentText:d.text,contentHash:await sha(d.text),originalAuthor:d.originalAuthor,coverage:{status:'full_text'}})))};
     const before=JSON.stringify(bundle), options={modelId:HaedoLife.InterestModel.manifest.modelId,modelRevision:HaedoLife.InterestModel.manifest.modelRevision,embed:(texts,settings)=>window.localModel.embed(texts,settings)};
     const analysis=HaedoLife.InterestAnalysis.create(options); const t=performance.now();
     const result=await analysis.analyze(bundle,{sourceVersionIds:bundle.sourceVersions.map(v=>v.id),onProgress:p=>window.phase({name,...p})});
     const elapsedMs=performance.now()-t;await analysis.dispose();
     return {result,bundleUnchanged:before===JSON.stringify(bundle),elapsedMs,model:HaedoLife.InterestModel.manifest.modelId,runtime:HaedoLife.InterestModel.manifest,config:HaedoLife.InterestAnalysis.LIMITS,prepareMs:window.prepareMs,heapUsed:performance.memory?.usedJSHeapSize};
   },{docs,name});
   output.sourceSHA256=frozen[name].sha256;output.tokenCounts=tokenCounts;
   fs.writeFileSync(path.join(base,name+'-output.json'),JSON.stringify(output,null,2));console.log(name+' actual inference completed');
 }
 const runtimeChecks=await page.evaluate(async()=>{const controller=new AbortController();const pending=localModel.embed(['실제 추론 취소 확인을 위한 합성 문장'],{signal:controller.signal});controller.abort();const aborted=await pending.then(()=>false,e=>e.name==='AbortError');const t=performance.now();const retry=await localModel.embed(['취소 뒤 같은 모델을 다시 준비하여 확인하는 합성 문장']);const retryMs=performance.now()-t;await localModel.dispose();await owner.dispose();return {aborted,retryDimensions:retry[0].length,retryMs,disposed:true};});
 network.runtimeChecks=runtimeChecks;network.mutableRevisionRequests=network.requests.filter(r=>r.url.includes('/resolve/main/'));network.bodyRequests=network.requests.filter(r=>r.hasBody||r.method!=='GET');
 fs.writeFileSync(path.join(base,'worker-browser.json'),JSON.stringify(network,null,2));
 console.log(JSON.stringify({runtimeChecks,errors:network.errors.length,main:network.mutableRevisionRequests.length,body:network.bodyRequests.length}));
})().catch(e=>{fs.writeFileSync(path.join(base,'worker-failure.json'),JSON.stringify({name:e.name,message:e.message,stack:e.stack,network},null,2));console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
