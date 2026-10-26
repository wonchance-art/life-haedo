/* Read-only candidates for explicitly scoped Obsidian sources. No implicit connection or file access. */
(function(root,factory){ const api=factory(); (root.HaedoLife ||= {}).ObsidianLinkCandidates=api; if(typeof module==='object'&&module.exports) module.exports=api; })(globalThis,function(){
  'use strict';
function maskedContent(text) {
  const escaped = (at) => {
    let count = 0;
    while (at > 0 && text[--at] === "\\") count++;
    return count % 2 === 1;
  };
  const nextTick = new Map(), lastTick = new Map(), tickSizes = new Map();
  const runs = [...text.matchAll(/`+/g)];
  for (let n = runs.length - 1; n >= 0; n--) {
    const run = runs[n], size = run[0].length;
    tickSizes.set(run.index, size);
    if (lastTick.has(size)) nextTick.set(run.index, lastTick.get(size));
    if (size > 1 && escaped(run.index)) {
      tickSizes.set(run.index + 1, size - 1);
      if (lastTick.has(size - 1)) nextTick.set(run.index + 1, lastTick.get(size - 1));
    }
    lastTick.set(size, run.index);
  }
  const chunks = [], lineAt = /[^\r\n]*(?:\r\n|\r|\n|$)/y;
  let fence = null, at = 0, kept = 0;
  const hide = (end) => {
    chunks.push(text.slice(kept, at), text.slice(at, end).replace(/[^\r\n]/g, " "));
    at = kept = end;
  };
  while (at < text.length) {
    if (at === 0 || text[at - 1] === "\n" || text[at - 1] === "\r" && text[at] !== "\n") {
      lineAt.lastIndex = at;
      const line = lineAt.exec(text)[0], content = line.replace(/[\r\n]+$/, "");
      const lineContent = at === 0 && content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
      const mark = lineContent.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^[ \t]*$/.test(mark[2])) fence = null;
        hide(at + line.length); continue;
      }
      // A backtick in the info string does not open a backtick fence.
      if (mark && (mark[1][0] !== "`" || !mark[2].includes("`"))) {
        fence = mark[1]; hide(at + line.length); continue;
      }
    }
    if ((text.startsWith("<!--", at) || text.startsWith("%%", at)) && !escaped(at)) {
      const html = text.startsWith("<!--", at), opening = html ? 4 : 2, closing = html ? "-->" : "%%";
      const end = text.indexOf(closing, at + opening);
      if (end >= 0 || html) { hide(end < 0 ? text.length : end + closing.length); continue; }
    }
    if (text[at] === "`") {
      const size = tickSizes.get(at), end = nextTick.get(at);
      if (escaped(at)) { at++; continue; }
      if (end !== undefined) { hide(end + size); continue; }
      at += size; continue;
    }
    at++;
  }
  chunks.push(text.slice(kept));
  return chunks.join("");
}

function scan(text) {
  if(typeof text!=='string'||text.length>1024*1024) throw new Error('invalid_text');
  const masked=maskedContent(text), found=[];
  for(const m of masked.matchAll(/!?\[\[([^\]\r\n]{1,2000})\]\]|!?\[[^\]\r\n]*\]\(([^)\r\n]{1,2048})\)/g)) {
    let slashes=0;for(let i=m.index-1;i>=0&&masked[i]==='\\';i--) slashes++;if(slashes%2) continue;
    const wiki=m[1]!==undefined,captured=wiki?m[1]:m[2],offset=wiki?m[0].indexOf('[[')+2:m[0].indexOf('](')+2;
    const raw=text.slice(m.index+offset,m.index+offset+captured.length);
    const dest=(v)=>wiki?v.split('|')[0].trim():v.trim().replace(/\s+["'][^"']*["']$/, '').replace(/^<([^>]+)>$/, '$1');
    let target=dest(raw),invalid=target!==dest(captured);
    if(!wiki && (raw.includes('(')|| /%23/i.test(target.split('#')[0]))) invalid=true;
    if(!wiki&&!invalid) try { target=decodeURIComponent(target); } catch (_) { invalid=true; }
    if(!target||/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) continue;
    found.push({start:m.index,end:m.index+m[0].length,token:text.slice(m.index,m.index+m[0].length),target,embed:m[0].startsWith('!'),syntax:wiki?'wiki':'markdown',invalid});
  }
  return found;
}
function anchors(text,fragment) {
  if(typeof text!=='string'||typeof fragment!=='string'||text.length>1024*1024) throw new Error('invalid_anchor');
  const masked=maskedContent(text), result=[], block=fragment.startsWith('^');
  if(!fragment || block && !/^\^[A-Za-z0-9-]+$/.test(fragment)) return result;
  for(const match of text.matchAll(/[^\r\n]+/g)) {
    const visible=masked.slice(match.index,match.index+match[0].length), withoutBom=match.index===0&&visible.charCodeAt(0)===0xfeff?visible.slice(1):visible, heading=withoutBom.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:\s+#+)?\s*$/);
    const trimmed=visible.trimEnd();
    if(block ? trimmed.endsWith(fragment)&&(trimmed.length===fragment.length||/[ \t]/.test(trimmed.at(-fragment.length-1))) : heading&&heading[1].trim()===fragment) result.push({start:match.index+(match.index===0&&match[0].charCodeAt(0)===0xfeff?1:0),end:match.index+match[0].length});
  }
  return result;
}
function normalized(base,target){
  if(typeof target!=='string'||/[\\\u0000-\u001f\u007f]/u.test(target)||/^[a-z]:/i.test(target))return null;
  const parts=(target.startsWith('/')?'':base).split('/').filter(Boolean);
  for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
  return parts.length?parts.join('/'):null;
}
function resolve({occurrence,fromPath,notes,attachments=null,requestedKind=null}){
  if(!occurrence||typeof occurrence.target!=='string'||typeof fromPath!=='string'||!Array.isArray(notes)||attachments!==null&&!Array.isArray(attachments)||requestedKind!==null&&!['note','attachment'].includes(requestedKind))throw new Error('invalid_scope');
  if(!fromPath||fromPath.startsWith('/')||/[\\\u0000-\u001f\u007f]/u.test(fromPath)||fromPath.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('invalid_scope');
  const target=occurrence.target,idx=target.indexOf('#'),file=idx<0?target:target.slice(0,idx),fragment=idx<0?'':target.slice(idx+1);
  const invalid=occurrence.invalid||/[\\\u0000-\u001f\u007f]/u.test(target)||/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)||(!file&&!fragment);
  const result=(status,kind,candidates=[])=>({status,kind,candidates,requiresSelection:true});
  if(invalid)return result('invalid',null);
  const origin=fromPath.split('/').slice(0,-1).join('/');
  const dotted=!!file&&/\.[^/]+$/.test(file)&&!/\.md$/i.test(file);
  const pathMatches=(path,name)=>path===normalized(origin,name)||path===normalized('',name)||!name.includes('/')&&path.split('/').at(-1)===name;
  const hasNote=dotted&&notes.some(v=>v?.origin==='obsidian'&&typeof v.path==='string'&&pathMatches(v.path,file+'.md'));
  const hasAttachment=dotted&&attachments?.some(v=>typeof v?.path==='string'&&pathMatches(v.path,file));
  if(hasNote&&hasAttachment&&!requestedKind)return result('ambiguous_kind',null);
  const kind=requestedKind||(dotted&&!hasNote?'attachment':'note');
  if(kind==='attachment'&&fragment)return result('unsupported_fragment',kind);
  if(kind==='attachment'&&attachments===null)return result('not_checked',kind);
  const paths=kind==='attachment'?attachments:notes;
  const name=kind==='note'&&file&&!/\.md$/i.test(file)?file+'.md':file;
  const relative=name?normalized(origin,name):fromPath,root=name?normalized('',name):fromPath;
  if(!relative&&!root)return result('invalid',kind);
  const matches=paths.filter(v=>v&&typeof v.path==='string'&&
    (kind==='note'?v.origin==='obsidian'&&typeof v.sourceId==='string'&&!!v.sourceId&&typeof v.sourceVersionId==='string'&&!!v.sourceVersionId:
      typeof v.copyId==='string'&&!!v.copyId&&typeof v.snapshotPath==='string'&&!!v.snapshotPath&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&typeof v.mime==='string'&&Number.isSafeInteger(v.bytes)&&v.bytes>=0)&&
    (v.path===relative||v.path===root||name&&!name.includes('/')&&v.path.split('/').at(-1)===name));
  if(matches.length>200) return {status:'too_many_candidates',kind,candidates:[],candidateCount:matches.length,requiresSelection:true};
  const candidates=[];
  for(const item of matches){
    if(kind==='attachment'){candidates.push({path:item.path,copyId:item.copyId,snapshotPath:item.snapshotPath,sha256:item.sha256,mime:item.mime,bytes:item.bytes});continue;}
    const locators=fragment&&typeof item.text==='string'?anchors(item.text,fragment):[];
    candidates.push({path:item.path,sourceId:item.sourceId,sourceVersionId:item.sourceVersionId,fragment,locators,
      anchorStatus:!fragment?'document':typeof item.text!=='string'?'text_missing':locators.length===0?'anchor_missing':locators.length===1?'anchor_found':'anchor_ambiguous'});
  }
  return result(candidates.length===0?'missing':candidates.length===1?'candidate':'ambiguous',kind,candidates);
}
return Object.freeze({scan,anchors,resolve});
});
