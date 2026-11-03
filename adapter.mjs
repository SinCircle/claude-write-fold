// Structural adapter for the native Claude Code fullscreen grouping pipeline.
// All matches are unique, token-aware, and checked before any output is written.
import fs from 'node:fs';
import {parse, tokenizer} from './vendor/acorn.mjs';

export const revision = '12-file-failures';
// Preserve the established grouping and preview markers.
const marker = '/* write-fold:8-background-failure */';
const options = {ecmaVersion:'latest',sourceType:'module'};
function insist(ok,message){if(!ok)throw new Error(message);}
function walk(node,fn){
  if(!node||typeof node!=='object')return;
  if(node.type)fn(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end')continue;
    if(Array.isArray(value))for(const child of value)walk(child,fn);
    else if(value&&typeof value==='object')walk(value,fn);
  }
}
function lex(source){return Array.from(tokenizer(source,options)).filter(t=>t.type.label!=='eof');}
function key(token){return token.type.label+':'+String(token.value??'');}
class Editor {
  constructor(source,label){
    insist(!source.includes('write-fold:')&&!source.includes('__wfFileWrite'),label+': already patched');
    this.source=source;this.label=label;this.ast=parse(source,options);this.tokens=lex(source);this.edits=[];this.functions=[];
    walk(this.ast,n=>{if(n.type==='FunctionDeclaration'||n.type==='FunctionExpression'||n.type==='ArrowFunctionExpression')this.functions.push(n)});
  }
  fn(at){
    const candidates=this.functions.filter(n=>n.start<=at&&n.end>at).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
    insist(candidates.length,this.label+': enclosing function missing');return candidates[0];
  }
  match(template,names='',scope=null,seed={}){
    const pattern=lex(template),variable=new Set(names.split(/\s+/).filter(Boolean));
    const hits=[],start=scope?.start??0,end=scope?.end??this.source.length;
    for(let i=0;i<=this.tokens.length-pattern.length;i++){
      const first=this.tokens[i];if(first.start<start||first.end>end)continue;
      if(!variable.has(pattern[0].value)&&key(first)!==key(pattern[0]))continue;
      const bindings={...seed};let good=true;
      for(let j=0;j<pattern.length;j++){
        const a=pattern[j],b=this.tokens[i+j];
        if(b.end>end){good=false;break;}
        if(a.type.label==='name'&&variable.has(a.value)){
          if(b.type.label!=='name'||(bindings[a.value]!==undefined&&bindings[a.value]!==b.value)){good=false;break;}
          bindings[a.value]=b.value;
        }else if(key(a)!==key(b)){good=false;break;}
      }
      if(good)hits.push({start:first.start,end:this.tokens[i+pattern.length-1].end,b:bindings});
    }
    insist(hits.length===1,`${this.label}: expected one structural match, got ${hits.length}: ${template.slice(0,100)}`);
    return hits[0];
  }
  add(start,end,text,reason){this.edits.push({start,end,text,reason});}
  replace(hit,text,reason){this.add(hit.start,hit.end,text,reason);}
  finish(){
    const sorted=this.edits.toSorted((a,b)=>a.start-b.start);
    for(let i=1;i<sorted.length;i++)insist(sorted[i].start>=sorted[i-1].end,this.label+': overlapping edits');
    let output=this.source;
    for(const change of [...sorted].reverse())output=output.slice(0,change.start)+change.text+output.slice(change.end);
    parse(output,options);
    return {source:output,changes:sorted.map(c=>({reason:c.reason,before:this.source.slice(c.start,c.end),after:c.text}))};
  }
}

// Accept native shell-task success and failure envelopes with matching status
// and exit code. Unknown formats stay standalone. Both modules share the parser;
// original messages stay untouched for transcript expansion and persistence.
const backgroundParser = String.raw`function __wfBackgroundTask(m){if(m?.type!=="attachment")return;let a=m.attachment;if(a?.type!=="queued_command"||a.commandMode!=="task-notification"||a.origin?.kind!=="task-notification"||typeof a.prompt!=="string")return;let p=a.prompt.trim().match(/^<task-notification>\s*<task-id>([\w-]+)<\/task-id>\s*<tool-use-id>([\w-]+)<\/tool-use-id>\s*<output-file>[^\r\n]+<\/output-file>\s*<status>(completed|failed)<\/status>\s*<summary>Background command "[^\r\n]*" (completed \(exit code 0\)|failed with exit code (-?[1-9]\d*))<\/summary>\s*<\/task-notification>$/);if(p&&(p[3]==="completed")===(p[5]===void 0))return{taskId:p[1],toolUseId:p[2],status:p[3]}}`;

function addBackgroundGrouping(ed){
  const hit=ed.match('else if(i1o(Oe)||Ge!==void 0&&BWt(Ge.message))','i1o Oe Ge BWt');
  const fn=ed.fn(hit.start),message=hit.b.Oe;
  const state=ed.match('z.bashCommands?.set(pt,nt)','z pt nt',fn).b.z;
  ed.add(fn.start,fn.start,backgroundParser,'Recognize native background shell success and failure notifications');
  ed.add(hit.start,hit.start,`else if(${state}.bashCommands?.has(__wfBackgroundTask(${message})?.toolUseId)){${state}.__wfBackgroundTasks??=[];${state}.__wfBackgroundTasks.push(${message});}`,'Absorb completion only when its original command belongs to this group');
  const flush=ed.match('if(n){if((e.bashCount??0)>0)Q.bashCount=','n e Q');
  ed.add(flush.start,flush.start,`if(${flush.b.e}.__wfBackgroundTasks?.length)${flush.b.Q}.__wfBackgroundTasks=${flush.b.e}.__wfBackgroundTasks;`,'Carry original notifications separately from native tool messages');
  const merge=ed.match('e.latestThinkingSummary=n.latestThinkingSummary??e.latestThinkingSummary,e.messages.push(...n.messages)','e n');
  ed.add(merge.end,merge.end,`;if(${merge.b.n}.__wfBackgroundTasks?.length)${merge.b.e}.__wfBackgroundTasks=[...${merge.b.e}.__wfBackgroundTasks??[],...${merge.b.n}.__wfBackgroundTasks]`,'Preserve attached notifications when native brief mode merges groups');
}

function addBackgroundRenderer(ed,fn,message){
  const bash=ed.match('if(b&&Co>0)eo("bash",T?"running":"ran",r(n,{children:[e(n,{bold:!0,children:Co})," shell"," ",Co===1?"command":"commands"]}));','b Co eo T r n e',fn);
  const {eo,r,n,e}=bash.b;
  ed.add(fn.start,fn.start,backgroundParser,'Recognize preserved background completions in group messages');
  ed.add(bash.end,bash.end,`let __wfTasks=new Map;for(let __wfRow of ${message}.__wfBackgroundTasks??[]){let __wfTask=__wfBackgroundTask(__wfRow);if(__wfTask&&(__wfTask.status==="failed"||!__wfTasks.has(__wfTask.taskId)))__wfTasks.set(__wfTask.taskId,__wfTask.status)}let __wfDone=[...__wfTasks.values()].filter(v=>v==="completed").length,__wfFailed=__wfTasks.size-__wfDone;if(__wfDone>0)${eo}("wf-background","completed",${r}(${n},{children:[${e}(${n},{bold:!0,children:__wfDone})," background ",__wfDone===1?"task":"tasks"]}));if(__wfFailed>0)${eo}("wf-background-failed","failed",${r}(${n},{color:"error",children:[${e}(${n},{bold:!0,children:__wfFailed})," background ",__wfFailed===1?"task":"tasks"]}));`,'Append background outcome counts using the native summary formatter');
  const attachment=ed.fn(ed.match('case"queued_command":').start);
  insist(attachment.type==='FunctionDeclaration','attachment renderer is no longer a named function');
  const transcript=ed.match('li=V.map(Ne)','li V Ne',fn),rows=transcript.b.li;
  const memo=[];
  walk(fn.body,node=>{if(node.type==='IfStatement'&&node.start<transcript.start&&node.end>transcript.end&&node.alternate?.expression?.left?.name===rows)memo.push(node)});
  insist(memo.length===1,'expanded notification row boundary changed');
  ed.add(memo[0].end,memo[0].end,`if(${message}.__wfBackgroundTasks?.length)${rows}=[...${rows},...${message}.__wfBackgroundTasks.map(v=>${e}(${attachment.id.name},{attachment:v.attachment,addMargin:!0,verbose:!0,isTranscriptMode:!0,messageId:v.uuid},v.uuid))];`,'Render preserved notifications with the native attachment renderer when expanded');
}

// Retain per-call counts so a failed member of a native grouped_tool_use does
// not subtract its successful siblings. Line counts use the native calculator.
function fileWriteBranch({state,info,count,message,lineCounter,cleaner,map,popOut=false}){
  return `else if(${info}.__wfFileWrite){${state}.editFileCount=(${state}.editFileCount??0)+${count};${state}.__wfLatestFileWriteId=${info}.toolUseIds.at(-1);${state}.linesAdded=(${state}.linesAdded??0)+(${info}.editLines?.added??0);${state}.linesRemoved=(${state}.linesRemoved??0)+(${info}.editLines?.removed??0);${state}.${map}??=new Map;${popOut?`${state}.popOutOnErrorIds??=new Set;`:''}for(let __wfMessage of (${message}.type==="grouped_tool_use"?${message}.messages:[${message}])){let __wfCall=__wfMessage.message.content[0];if(__wfCall?.type!=="tool_use")continue;let __wfLines=${lineCounter}(__wfCall.name,__wfCall.input);${state}.${map}.set(__wfCall.id,{count:1,added:__wfLines.added,removed:__wfLines.removed,spent:!1,__wfFileWrite:!0});${popOut?`${state}.popOutOnErrorIds.add(__wfCall.id);`:''}}${state}.latestDisplayHint=${cleaner}(${info}.name+"("+(${info}.input.file_path??${info}.input.notebook_path??"")+")")}`;
}

function addFileFailureRenderer(ed,fn,message,lookups,toolCalls){
  const expanded=ed.match('if(f){let dT=[];for(const au of V){','f dT au V',fn);
  ed.add(expanded.start,expanded.start,`let __wfFailedWrites=new Set(${toolCalls}(${message}).filter(v=>["Write","Edit","NotebookEdit"].includes(v.name)&&${lookups}.erroredToolUseIDs.has(v.id)&&${lookups}.toolResultByToolUseID.get(v.id)?.toolDenialKind===void 0).map(v=>v.id)).size;`,'Count failed file calls from native messages and error lookups');
  const empty=ed.match('if(!ue&&!ye&&!Je&&!Ts){','ue ye Je Ts',fn);
  const statements=[];walk(fn.body,n=>{if(n.type==='IfStatement'&&n.start===empty.start)statements.push(n)});
  insist(statements.length===1,'Empty-group condition changed');
  ed.add(statements[0].test.end,statements[0].test.end,'&&!__wfFailedWrites','Keep groups containing only failed file calls visible');
  const bash=ed.match('if(b&&Co>0)eo("bash",T?"running":"ran",r(n,{children:[e(n,{bold:!0,children:Co})," shell"," ",Co===1?"command":"commands"]}));','b Co eo T r n e',fn);
  const {eo,r,n,e}=bash.b;
  ed.add(bash.end,bash.end,`if(__wfFailedWrites>0)${eo}("wf-file-failed","failed",${r}(${n},{color:"error",children:[${e}(${n},{bold:!0,children:__wfFailedWrites})," file ",__wfFailedWrites===1?"operation":"operations"]}));`,'Append failed file count using the native summary formatter');
}

export function adaptGrouping(source){
  if(!source.includes('workshopEditsByToolUseId'))return adaptGroupingModern(source);
  const ed=new Editor(source,'grouping');
  const classify=ed.match('if(!y?.isSearchOrReadCommand)return{isCollapsible:!1','y');
  const fn=ed.fn(classify.start);
  insist(fn.params.length===3&&fn.params.every(n=>n.type==='Identifier'),'classifier parameters changed');
  const [name,input]=fn.params.map(p=>p.name),tool=classify.b.y;
  const fullscreen=ed.match('isBash:sd()?!Se&&we:void 0','sd Se we',fn).b.sd;
  const remote=ed.match('if(Jht(y,n)!==void 0)return{isCollapsible:!1','Jht y n',fn,{y:tool,n:input}).b.Jht;
  ed.add(classify.start,classify.start,
    `${marker}if(${fullscreen}()&&["Write","Edit","NotebookEdit"].includes(${name})&&${tool}&&${remote}(${tool},${input})===void 0)return{isCollapsible:!0,isSearch:!1,isRead:!1,isList:!1,isREPL:!1,isMemoryWrite:!1,isScratchpadWrite:!1,isWorkshopWrite:!1,isAbsorbedSilently:!1,__wfFileWrite:!0};`,
    'Classify normal local file writes after existing special rules');
  let hit=ed.match('accountMemory:r.accountMemory,isBash:r.isBash}}return null}','r');
  ed.replace(hit,`accountMemory:${hit.b.r}.accountMemory,isBash:${hit.b.r}.isBash,__wfFileWrite:${hit.b.r}.__wfFileWrite}}return null}`,'Carry the file-write classification');
  hit=ed.match('else if(r.isWorkshopWrite||r.isScratchpadWrite||r.isAbsorbedSilently);','r');
  ed.replace(hit,`else if(${hit.b.r}.__wfFileWrite||${hit.b.r}.isWorkshopWrite||${hit.b.r}.isScratchpadWrite||${hit.b.r}.isAbsorbedSilently);`,'Keep writes out of read counts');
  hit=ed.match('let Q=null;if(r.isScratchpadWrite||r.isWorkshopWrite){','Q r');
  ed.replace(hit,`let ${hit.b.Q}=null;if(${hit.b.r}.__wfFileWrite||${hit.b.r}.isScratchpadWrite||${hit.b.r}.isWorkshopWrite){`,'Reuse native line counting');
  const lineCounter=ed.match('let Ce=r9n(r.name,Ee.input);Se+=Ce.added,we+=Ce.removed','Ce r9n r Ee Se we',ed.fn(hit.start)).b.r9n;
  hit=ed.match('else if(je.isWorkshopWrite){if(z.workshopWriteCount=(z.workshopWriteCount??0)+st,je.editLines)','je z st');
  const {je,z,st}=hit.b,groupFn=ed.fn(hit.start);
  const workshopEnd=ed.match('else if(je.isScratchpadWrite){','je',groupFn,{je}).start;
  const cleaner=ed.match('let gt=Soe(je.input),vt=gt?hoe(os(gt)):"";if(vt)z.latestDisplayHint=vt','gt Soe je vt hoe os z',{start:hit.start,end:workshopEnd},{je,z}).b.hoe;
  const callMessage=ed.match('for(let nt of je.toolUseIds)z.toolUseIds.add(nt);z.messages.push(Oe)','nt je z Oe',groupFn,{je,z}).b.Oe;
  const branch=fileWriteBranch({state:z,info:je,count:st,message:callMessage,lineCounter,cleaner,map:'workshopEditsByToolUseId'});
  ed.add(hit.start,hit.start,branch,'Track file calls with native line counts and latest preview identity');
  hit=ed.match('if(n){if((e.bashCount??0)>0)Q.bashCount=','n e Q');
  const state=hit.b.e,out=hit.b.Q;
  ed.add(hit.start,hit.start,`if(${state}.__wfLatestFileWriteId!==void 0)${out}.editFileCount=${state}.editFileCount,${out}.linesAdded=${state}.linesAdded,${out}.linesRemoved=${state}.linesRemoved,${out}.__wfLatestFileWriteId=${state}.__wfLatestFileWriteId;`,'Forward counts and latest preview identity');
  hit=ed.match('if(!h||h.spent)continue;h.spent=!0,n.workshopWriteCount=','h n');
  const errFn=ed.fn(hit.start),changed=ed.match(',r=!0}return r}','r',errFn).b.r;
  const {h,n}=hit.b,resultMessage=errFn.params[0].name;
  ed.replace(hit,`if(!${h}||${h}.spent)continue;if(${h}.__wfFileWrite){${h}.spent=!0;${n}.editFileCount=Math.max(0,(${n}.editFileCount??0)-${h}.count);${n}.linesAdded=Math.max(0,(${n}.linesAdded??0)-${h}.added);${n}.linesRemoved=Math.max(0,(${n}.linesRemoved??0)-${h}.removed);${changed}=${changed}||${resultMessage}.toolDenialKind!==void 0;continue}${h}.spent=!0,${n}.workshopWriteCount=`,'Keep file failures grouped while retaining native denial and interruption pop-out');
  addBackgroundGrouping(ed);
  return ed.finish();
}

// Newer native builds removed Workshop and replaced its error bookkeeping with
// popOutOnErrorIds. This is a separate reviewed structural profile, not a loose
// fallback: every anchor below still has to match exactly once.
function adaptGroupingModern(source){
  const ed=new Editor(source,'grouping/popOutOnErrorIds');
  const classify=ed.match('if(!y?.isSearchOrReadCommand)return{isCollapsible:!1','y');
  const fn=ed.fn(classify.start);
  insist(fn.params.length===3&&fn.params.every(p=>p.type==='Identifier'),'classifier parameters changed');
  const [name,input]=fn.params.map(p=>p.name),tool=classify.b.y;
  const fullscreen=ed.match('isBash:sd()?!Se&&we:void 0','sd Se we',fn).b.sd;
  const remote=ed.match('if(Jht(y,n)!==void 0)return{isCollapsible:!1','Jht y n',fn,{y:tool,n:input}).b.Jht;
  ed.add(classify.start,classify.start,`${marker}if(${fullscreen}()&&["Write","Edit","NotebookEdit"].includes(${name})&&${tool}&&${remote}(${tool},${input})===void 0)return{isCollapsible:!0,isSearch:!1,isRead:!1,isList:!1,isREPL:!1,isMemoryWrite:!1,isScratchpadWrite:!1,isAbsorbedSilently:!1,__wfFileWrite:!0};`,'Classify ordinary local file writes');
  let hit=ed.match('accountMemory:r.accountMemory,isBash:r.isBash}}return null}','r');
  ed.replace(hit,`accountMemory:${hit.b.r}.accountMemory,isBash:${hit.b.r}.isBash,__wfFileWrite:${hit.b.r}.__wfFileWrite}}return null}`,'Carry the file-write classification');
  hit=ed.match('else if(r.isScratchpadWrite||r.isAbsorbedSilently);','r');
  ed.replace(hit,`else if(${hit.b.r}.__wfFileWrite||${hit.b.r}.isScratchpadWrite||${hit.b.r}.isAbsorbedSilently);`,'Keep writes out of read counts');
  hit=ed.match('let Q=null;if(r.isScratchpadWrite){','Q r');
  ed.replace(hit,`let ${hit.b.Q}=null;if(${hit.b.r}.__wfFileWrite||${hit.b.r}.isScratchpadWrite){`,'Reuse native line counting');
  const lineCounter=ed.match('let Ce=r9n(r.name,Ee.input);Se+=Ce.added,we+=Ce.removed','Ce r9n r Ee Se we',ed.fn(hit.start)).b.r9n;
  hit=ed.match('else if(je.isScratchpadWrite){if(z.scratchpadWriteCount=(z.scratchpadWriteCount??0)+st,je.editLines)','je z st');
  const {je,z,st}=hit.b,groupFn=ed.fn(hit.start);
  const cleaner=ed.match('let gt=Soe(je.input),vt=gt?hoe(os(gt)):"";if(vt)z.latestDisplayHint=vt','gt Soe je vt hoe os z',groupFn,{je,z}).b.hoe;
  ed.match('z.popOutOnErrorIds??=new Set;for(let nt of je.toolUseIds)z.popOutOnErrorIds.add(nt)','z nt je',groupFn,{z,je});
  const callMessage=ed.match('for(let nt of je.toolUseIds)z.toolUseIds.add(nt);z.messages.push(Oe)','nt je z Oe',groupFn,{je,z}).b.Oe;
  ed.add(hit.start,hit.start,fileWriteBranch({state:z,info:je,count:st,message:callMessage,lineCounter,cleaner,map:'__wfEditsById',popOut:true}),'Track file calls with native line counts and latest preview identity');
  hit=ed.match('if(n){if((e.bashCount??0)>0)Q.bashCount=','n e Q');
  const state=hit.b.e,out=hit.b.Q;
  ed.add(hit.start,hit.start,`if(${state}.__wfLatestFileWriteId!==void 0)${out}.editFileCount=${state}.editFileCount,${out}.linesAdded=${state}.linesAdded,${out}.linesRemoved=${state}.linesRemoved,${out}.__wfLatestFileWriteId=${state}.__wfLatestFileWriteId;`,'Forward counts and latest preview identity');
  const classifyRow=ed.match('let We=W2n(Oe)?Opt(Oe,n):null,Ge=We===null?j2n(Oe):void 0,lt=We===null?Xvs(Oe,z):V2n;','We W2n Oe Opt n Ge j2n lt Xvs z V2n',groupFn,{We:je,z});
  const message=classifyRow.b.Oe;
  ed.add(classifyRow.end,classifyRow.end,`if(${message}.type==="user"&&${z}.__wfEditsById)for(let __wfResult of ${message}.message.content){if(__wfResult.type!=="tool_result"||!__wfResult.is_error)continue;let __wfEdit=${z}.__wfEditsById.get(__wfResult.tool_use_id);if(!__wfEdit)continue;if(${message}.toolDenialKind===void 0)${z}.popOutOnErrorIds.delete(__wfResult.tool_use_id);if(__wfEdit.spent)continue;__wfEdit.spent=!0;${z}.editFileCount=Math.max(0,(${z}.editFileCount??0)-__wfEdit.count);${z}.linesAdded=Math.max(0,(${z}.linesAdded??0)-__wfEdit.added);${z}.linesRemoved=Math.max(0,(${z}.linesRemoved??0)-__wfEdit.removed);}`,'Keep file failures grouped and subtract only their own counts; preserve native denials');
  addBackgroundGrouping(ed);
  return ed.finish();
}

// The native focused-conversation projection already supplies isLoading for
// running, non-idle agents. Feed it into the existing group/brief predicates;
// the upstream indicator, task title and detail components need no new rules.
export function adaptFocusedLoading(source){
  const ed=new Editor(source,'focused-loading');
  const context=ed.match('D=T.kind==="live"?T.turn:null,L=T.kind==="live"&&T.focused.isMain','D T L');
  const fn=ed.fn(context.start),{D,T,L}=context.b;
  const load=ed.match('G=Oe(D,mL)??!1','G Oe D mL',fn,{D}),G=load.b.G;
  const focused=ed.match('Yt=L?G&&!st:T.kind==="live"&&T.focused.inProgressToolUseIDs.size>0','Yt L G st T',fn,{L,G,T});
  const declarations=[];
  walk(fn.body,node=>{if(node.type==='VariableDeclaration'&&node.start<focused.start&&node.end>focused.end)declarations.push(node)});
  insist(declarations.length===1,'focused loading declaration boundary changed');
  ed.add(declarations[0].start,declarations[0].start,`/* write-fold:10-focused-state */if(${T}.kind==="live"&&!${T}.focused.isMain)${G}=${T}.focused.isLoading;`,'Use native focused loading for the viewed subagent, including gaps between tools');
  const activeTools=ed.match('T.focused.inProgressToolUseIDs.size>0','T',focused,{T});
  ed.add(activeTools.start,activeTools.start,'(','Preserve the native in-progress-tools condition');
  ed.add(activeTools.end,activeTools.end,`||${T}.focused.isLoading)`,'Use the same native focused loading in brief-mode grouping');
  const result=ed.finish();
  insist(ed.edits.every(e=>e.start===e.end),'Native focused loading logic was overwritten');
  return result;
}

// Subscribe to the native layout snapshot instead of relying solely on the
// previous commit's visibility cache. The existing layout hook already handles
// post-commit snapshot changes and schedules the necessary React update.
export function adaptAnimationClock(source){
  const ed=new Editor(source,'animation-clock');
  const context=ed.match('let r=Se(wT),[l,{isVisible:u},d]=qK(),p=Cye(),m=A(p),b=u;if(m.current!==p)m.current=p,b=d();','r Se wT l u d qK p Cye m A b');
  const fn=ed.fn(context.start),bindings=context.b;
  const layout=ed.match('let{subscribeLayout:r}=Se(Ep),l=yt(r,o),[,u]=Uy((d)=>d+1,0);return Gt(()=>{if(!Object.is(o(),l))u()}),l','r Se Ep l yt o u Uy d Gt');
  const layoutFn=ed.fn(layout.start);
  insist(layoutFn.type==='FunctionDeclaration','Native layout subscription hook is no longer a named function');
  const tuple=ed.match('[l,{isVisible:u},d]=qK()','l u d qK',fn,bindings);
  const close=ed.tokens.find(t=>t.start>=tuple.start&&t.end<=tuple.end&&t.type.label===']');
  insist(close,'Native visibility tuple changed');
  ed.add(fn.start,fn.start,'/* write-fold:11-layout-subscription */','Mark the native clock visibility correction');
  ed.add(close.start,close.start,',__wfReadVisibility','Use the native live visibility reader');
  const initial=ed.match('b=u','b u',fn,bindings);
  const value=ed.tokens.find(t=>t.end===initial.end);
  ed.add(value.start,value.start,`${layoutFn.id.name}(__wfReadVisibility)??`,'Reuse native layout subscription and post-commit snapshot synchronization');
  const result=ed.finish();
  insist(ed.edits.every(e=>e.start===e.end),'Native animation or layout code was overwritten');
  return result;
}

export function adaptRenderer(source){
  const ed=new Editor(source,'renderer');
  const args=ed.match('{message:d,inProgressToolUseIDs:c,shouldAnimate:g,verbose:f,tools:h,lookups:b,isActiveGroup:M,addMargin:C}=m','d c g f h b M C m');
  const fn=ed.fn(args.start),{d,h,b,M}=args.b;
  insist(fn.type==='FunctionDeclaration','group component is no longer a named function');
  const K=ed.match('{columns:K}=Ce()','K Ce',fn).b.K;
  const Bt=ed.match('Bt(d).filter(BN)','Bt d BN',fn,{d}).b.Bt;
  const l3=ed.match('l3.isInterruptedCall(b.toolResultByToolUseID.get(dj.id))','l3 b dj',fn,{b}).b.l3;
  const live=ed.match('Pm=M&&Vt===null&&Ea!==void 0&&r(s,{flexDirection:"row",children:','Pm M Vt Ea r s',fn,{M});
  const Pm=live.b.Pm;
  let memo=[];
  walk(fn.body,n=>{
    if(n.type!=='IfStatement')return;
    const a=n.alternate?.expression;
    if(a?.type==='AssignmentExpression'&&a.left.type==='Identifier'&&a.left.name===Pm&&n.start<=live.start&&n.end>=live.end)memo.push(n);
  });
  insist(memo.length===1,'live-detail memo boundary changed');
  const result=ed.match('e(qd,{param:h,message:d,lookups:v,progressMessagesForMessage:f,style:b,tools:g,verbose:M,width:G,isTranscriptMode:B})','e qd h d v f b g M G B').b;
  const helper=`${marker}function __writeFoldPreview(m){let{content:d,tools:h,lookups:b,columns:K}=m,p=b.progressMessagesByToolUseID.get(d.id)??[],u=b.toolResultByToolUseID.get(d.id),t=u?.type==="user"?u.message.content.find(v=>v.type==="tool_result"&&v.tool_use_id===d.id):void 0;return t?${result.e}(${result.qd},{param:t,message:u,lookups:b,progressMessagesForMessage:p,tools:h,verbose:!1,width:Math.max(1,K-5),isTranscriptMode:!1}):m.fallback}`;
  ed.add(fn.start,fn.start,helper,'Add a result-preview-only component; no ToolUse title');
  const inject=`let __wfLast=${M}?${Bt}(${d}).at(-1):void 0;if(__wfLast&&__wfLast.id===${d}.__wfLatestFileWriteId&&!${l3}.isInterruptedCall(${b}.toolResultByToolUseID.get(__wfLast.id)))${Pm}=${result.e}(__writeFoldPreview,{content:__wfLast,tools:${h},lookups:${b},columns:${K},fallback:${Pm}},__wfLast.id);`;
  ed.add(memo[0].end,memo[0].end,inject,'Replace only active detail content; preserve every native title expression');
  addFileFailureRenderer(ed,fn,d,b,Bt);
  addBackgroundRenderer(ed,fn,d);
  const output=ed.finish();
  // All renderer changes are insertions. All upstream renderer bytes survive.
  insist(ed.edits.every(e=>e.start===e.end),'Native renderer was overwritten');
  return {...output,nativeRendererUnchanged:true};
}

if(process.argv[1]&&import.meta.url===new URL('file:///'+process.argv[1].replaceAll('\\','/')).href){
  try{
    const manifestPath=process.argv[2];insist(manifestPath,'Usage: node adapter.mjs manifest.json');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),report={revision,modules:[]};
    const prepared=[];
    for(const entry of manifest.modules){
      const before=fs.readFileSync(entry.input,'utf8');
      const adapt={grouping:adaptGrouping,renderer:adaptRenderer,focus:adaptFocusedLoading,clock:adaptAnimationClock}[entry.kind];
      insist(adapt,'Unknown module kind: '+entry.kind);
      const result=adapt(before);
      prepared.push([entry,result]);report.modules.push({kind:entry.kind,changes:result.changes,nativeRendererUnchanged:result.nativeRendererUnchanged??null});
    }
    for(const [entry,result] of prepared)fs.writeFileSync(entry.output,result.source);
    fs.writeFileSync(manifest.report,JSON.stringify(report,null,2));
    console.log('Structural matching and JavaScript parsing: PASS');
  }catch(error){console.error('Compatibility check failed: '+error.message);process.exitCode=2;}
}
