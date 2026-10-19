/* Bounded architecture feasibility probe; never enables the application gate. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=__dirname,id='onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX',rev='cdc8277b4682665e2f2e87cd83da7da07b153d75';
const fixture=JSON.parse(fs.readFileSync(path.join(root,'private-nli-probe.json')));
const pairs=fixture.pairs.map(({id,premise,hypothesis})=>({id,premise,hypothesis}));
const report={modelId:id,revision:rev,runtime:'4.3.1',device:'wasm',dtype:'q8',numThreads:1,fixtureSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'private-nli-probe.json'))).digest('hex'),requests:[],errors:[]};
fs.writeFileSync(path.join(root,'nli-runner-freeze.json'),JSON.stringify({fixtureSHA256:report.fixtureSHA256,runnerSHA256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),modelId:id,revision:rev,labelRule:'raw3logits_argmax_no_threshold_tuning',maxLength:256},null,2));
let browser;const save=()=>fs.writeFileSync(path.join(root,'nli-output.json'),JSON.stringify(report,null,2));
(async()=>{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'},args:['--no-sandbox','--enable-precise-memory-info']});
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 context.on('request',r=>{if(r.url().startsWith('https:')){const u=new URL(r.url());report.requests.push({url:u.origin+u.pathname,method:r.method(),body:!!r.postData()});}});
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('phase',p=>{console.log(JSON.stringify(p));});
 await page.goto('http://127.0.0.1:4173/privacy.html');
 report.result=await page.evaluate(async({pairs,id,rev})=>{
   const start=performance.now(),progress=[];
   const metadata=await(await fetch('https://huggingface.co/api/models/'+id+'/revision/'+rev+'?blobs=true')).json();
   const file=metadata.siblings.find(f=>f.rfilename==='onnx/model_quantized.onnx');
   if(metadata.sha!==rev||metadata.cardData?.license!=='mit'||file?.lfs?.size!==338341610||file?.lfs?.sha256!=='f1920d10296efd121a601b2161e8de9fa0c934a6c0331cd1764fd09a06a83041')throw Error('fixed NLI metadata mismatch');
   const runtime=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');
   runtime.env.allowLocalModels=false;runtime.env.remotePathTemplate='{model}/resolve/'+rev+'/';runtime.env.backends.onnx.wasm.numThreads=1;
   const tokenizer=await runtime.AutoTokenizer.from_pretrained(id,{revision:rev});
   const model=await runtime.AutoModelForSequenceClassification.from_pretrained(id,{revision:rev,device:'wasm',dtype:'q8',progress_callback:p=>{if(p.status==='done')progress.push(p);}});
   const preparedMs=performance.now()-start;await window.phase({phase:'nli_ready',preparedMs});
   const predictions=[];const t=performance.now();
   for(const pair of pairs){const before=tokenizer(pair.premise,{text_pair:pair.hypothesis,truncation:false});const inputs=tokenizer(pair.premise,{text_pair:pair.hypothesis,truncation:true,max_length:256});const t0=performance.now();const result=await model(inputs);predictions.push({id:pair.id,logits:result.logits.tolist()[0],tokenCount:before.input_ids.dims[1],actualInputTokens:inputs.input_ids.dims[1],elapsedMs:performance.now()-t0});await window.phase({phase:'nli_pair',completed:predictions.length,total:pairs.length});}
   const inferenceMs=performance.now()-t;const heapUsed=performance.memory?.usedJSHeapSize;const id2label=model.config.id2label;await model.dispose();return{predictions,preparedMs,inferenceMs,heapUsed,id2label,progress,metadataBytes:file.lfs.size,disposed:true};
 },{pairs,id,rev});
 report.predictions=report.result.predictions;report.id2label=report.result.id2label;
 report.mutableRevisionRequests=report.requests.filter(r=>r.url.includes('/resolve/main/'));report.bodyRequests=report.requests.filter(r=>r.body||r.method!=='GET');save();
 console.log('NLI probe completed');
})().catch(e=>{report.fatal={name:e.name,message:e.message,stack:e.stack};save();console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
