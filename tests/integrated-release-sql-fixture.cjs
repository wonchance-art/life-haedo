'use strict';
/* Existing isolated page/blog fixtures plus exactly three material RPCs.
 * No product SQL, production credentials or transport implementation is added. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {LocalSQLNineCloud}=require('./nine-public-sql-fixture.cjs');
const {LocalSQLMaterialCloud}=require('./material-continuity-sql-fixture.cjs');
const {digest}=require('./blog-completion-browser.cjs');
const migration='supabase/migrations/20261019005829_life_material_continuity.sql';
class LocalSQLIntegratedCloud extends LocalSQLNineCloud {
 constructor(options){super(options);this.materialRequests=[];this.materialFailure=null;this.materialMutation=null;this.materialGate=null;}
 async prepare(){await super.prepare();const sql=await fs.readFile(path.resolve(__dirname,'..',migration),'utf8');this.docker(['exec','-i',this.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','--dbname',this.database],sql);this.installedMigrationSha256=digest(Buffer.from(sql));}
 async initialize(){await super.initialize();const rows=this.sql(`select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[i],'type',format_type(p.proargtypes[i-1],null)) order by i),'[]') from generate_subscripts(p.proargnames,1) i))),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('life_material_get','life_material_list','life_material_put');`);assert.equal(rows.length,3);for(const row of rows){assert(!this.functions.has(row.name));this.functions.set(row.name,row.args);}}
 typed(value,type){return LocalSQLMaterialCloud.prototype.typed.call(this,value,type);}
 rpc(owner,name,args,role=owner?'authenticated':'anon'){return name.startsWith('life_material_')?LocalSQLMaterialCloud.prototype.rpc.call(this,owner,name,args,role):super.rpc(owner,name,args,role);}
 handle(route,device){return new URL(route.request().url()).pathname.startsWith('/rest/v1/rpc/life_material_')?LocalSQLMaterialCloud.prototype.handle.call(this,route,device):super.handle(route,device);}
 holdMaterialNext(predicate){return LocalSQLMaterialCloud.prototype.holdMaterialNext.call(this,predicate);}
}
module.exports={LocalSQLIntegratedCloud,migration};
