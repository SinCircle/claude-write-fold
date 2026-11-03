import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse,tokenizer} from '../vendor/acorn.mjs';
import {adaptGrouping,adaptRenderer,adaptFocusedLoading,adaptAnimationClock} from '../adapter.mjs';

const options={ecmaVersion:'latest',sourceType:'module'};
function walk(n,fn){if(!n||typeof n!=='object')return;if(n.type)fn(n);for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c,fn);else if(v&&typeof v==='object')walk(v,fn)}}
function renameBindings(source){
  const ast=parse(source,options),names=new Set(),excluded=new Set(),preserve=new Set();
  walk(ast,n=>{
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')names.add(n.id.name);
    if(n.type==='FunctionDeclaration'||n.type==='FunctionExpression'||n.type==='ArrowFunctionExpression'){
      if(n.id)names.add(n.id.name);
      for(const p of n.params)if(p.type==='Identifier')names.add(p.name);
    }
    if(n.type==='ImportSpecifier'||n.type==='ImportDefaultSpecifier'||n.type==='ImportNamespaceSpecifier'){
      names.add(n.local.name);if(n.imported)excluded.add(n.imported.start);
    }
    if(n.type==='MemberExpression'&&!n.computed&&n.property.type==='Identifier')excluded.add(n.property.start);
    if((n.type==='Property'||n.type==='MethodDefinition')&&!n.computed&&n.key.type==='Identifier')excluded.add(n.key.start);
    if(n.type==='ExportSpecifier'){
      excluded.add(n.exported.start);
      if(n.local.start===n.exported.start)preserve.add(n.local.name);
    }
  });
  for(const name of preserve)names.delete(name);
  const edits=[];
  const contextual=new Set(['of','async','await','as','from','get','set','static','yield','let','using']);
  for(const t of tokenizer(source,options))if(t.type.label==='name'&&names.has(t.value)&&!excluded.has(t.start)&&!contextual.has(t.value))edits.push(t);
  const parts=[];let at=0;
  for(const t of edits){parts.push(source.slice(at,t.start),'renamed_'+t.value);at=t.end;}
  parts.push(source.slice(at));source=parts.join('');
  source=source.replaceAll('else if','else\n if').replaceAll('// Version: 2.1.311','// Version: 9.9.999');
  parse(source,options);return source;
}

assert(process.argv[2] && process.argv[3] && process.argv[4] && process.argv[5], 'Pass grouping, renderer, focus and clock source paths.');
const group=fs.readFileSync(process.argv[2],'utf8'),render=fs.readFileSync(process.argv[3],'utf8'),focus=fs.readFileSync(process.argv[4],'utf8'),clock=fs.readFileSync(process.argv[5],'utf8');
const profile=group.includes('workshopEditsByToolUseId')?'workshop':'popOutOnErrorIds';
const changedGroup=adaptGrouping(renameBindings(group));
assert.equal(changedGroup.changes.length,11);global.gc?.();
console.log('PASS: '+profile+' grouping adapts to renamed identifiers and whitespace');
const changedRenderer=adaptRenderer(renameBindings(render));
assert.equal(changedRenderer.changes.length,7);
assert(changedRenderer.changes.every(c=>c.before===''));
assert(changedRenderer.nativeRendererUnchanged);global.gc?.();
console.log('PASS: preview adapts while preserving native renderer bytes');
const changedClock=adaptAnimationClock(renameBindings(clock));
assert.equal(changedClock.changes.length,3);
assert(changedClock.changes.every(c=>c.before===''));
assert.throws(()=>adaptAnimationClock(changedClock.source),/already patched/);
assert.throws(()=>adaptAnimationClock(clock.replaceAll('subscribeLayout','upstreamChangedLayout')),/got 0/);
console.log('PASS: animation visibility reuses the native layout hook; unchanged native code and strict structural checks');
const changedFocus=adaptFocusedLoading(renameBindings(focus));
assert.equal(changedFocus.changes.length,3);
assert(changedFocus.changes.every(c=>c.before===''));
assert.throws(()=>adaptFocusedLoading(changedFocus.source),/already patched/);
assert.throws(()=>adaptFocusedLoading(focus.replaceAll('focused.inProgressToolUseIDs','focused.upstreamChangedIDs')),/got 0/);
console.log('PASS: focused-loading adapter preserves native code and rejects unsupported upstream changes');
// Exercise the actual injected routing and native brief-loading expression.
// Tool gaps must use the focused agent flag; main/static views stay unchanged.
const focusPatch=adaptFocusedLoading(focus),focusAst=parse(focusPatch.source,options);
const routing=focusPatch.changes[0].after;
const routeNames=routing.match(/if\((\w+)\.kind==="live"&&!\1\.focused.isMain\)(\w+)=\1\.focused.isLoading;/);
assert(routeNames);
const loadingNodes=[];
walk(focusAst,node=>{if(node.type==='VariableDeclarator'&&node.init?.type==='ConditionalExpression'&&focusPatch.source.slice(node.init.start,node.init.end).includes('.focused.inProgressToolUseIDs.size>0||'))loadingNodes.push(node)});
assert.equal(loadingNodes.length,1);
const loadingExpr=loadingNodes[0].init,mainName=loadingExpr.test.name;
const foldedName=loadingExpr.consequent.right.argument.name;
for(const mainBusy of [false,true])for(const focusedBusy of [false,true])for(const isMain of [false,true])for(const kind of ['live','static'])for(const executing of [false,true]){
  const context={
    [routeNames[1]]:{kind,focused:{isMain,isLoading:focusedBusy,inProgressToolUseIDs:new Set(executing?['tool']:[])}},
    [routeNames[2]]:mainBusy,[mainName]:kind==='live'&&isMain,[foldedName]:false,
  };
  vm.createContext(context);vm.runInContext(routing,context);
  const expected=kind==='live'&&!isMain?focusedBusy:mainBusy;
  assert.equal(context[routeNames[2]],expected);
  const brief=vm.runInContext(focusPatch.source.slice(loadingExpr.start,loadingExpr.end),context);
  assert.equal(brief,kind==='live'?(isMain?mainBusy:executing||focusedBusy):false);
}
console.log('PASS: 32 focused-loading states keep running agents active between tools and preserve main/static views');
assert.throws(()=>adaptGrouping(changedGroup.source),/already patched/);
assert.throws(()=>adaptRenderer(changedRenderer.source),/already patched/);global.gc?.();
assert.throws(()=>adaptGrouping(group+'\nfunction fake(y){if(!y?.isSearchOrReadCommand)return{isCollapsible:!1};}'),/got 2/);
global.gc?.();
assert.throws(()=>adaptRenderer(render.replaceAll('isActiveGroup','changedUpstreamProperty')),/got 0/);
console.log('PASS: duplicate patches, ambiguous matches and structural drift are rejected');

// Compare the actual native and patched indicator output over animation,
// reduced-motion, static-frame, error and completion states. The indicator is
// now byte-identical to upstream: no special prop, ref policy or remount key.
const patched=adaptRenderer(render).source;
const patchedAst=parse(patched,options),nativeAst=parse(render,options);
const indicator=patchedAst.body.find(n=>n.type==='FunctionDeclaration'&&n.params[0]?.type==='ObjectPattern'&&n.params[0].properties.some(p=>p.key?.name==='isUnresolved')&&n.params[0].properties.some(p=>p.key?.name==='shouldAnimate'));
assert(indicator);assert(!patched.includes('__wfLiveGroup'));
const original=nativeAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===indicator.id.name);
assert.equal(patched.slice(indicator.start,indicator.end),render.slice(original.start,original.end));
const declarations=original.body.body[0].declarations;
assert.equal(declarations.length,6);
const sequence=original.body.body.at(-1).argument;
const box=sequence.expressions.at(-1),boxProps=box.arguments[1];
const text=boxProps.properties.find(p=>p.key.name==='children').value;
const textProps=text.arguments[1];
const glyph=textProps.properties.find(p=>p.key.name==='children').value.consequent.name;
const visibilityRef=()=>{};
function renderIndicator(node,code,props,staticFrame,reducedMotion,phase){
  let animationEnabled;
  const context={
    [declarations[0].init.callee.name]:()=>staticFrame,
    [declarations[1].init.callee.name]:()=>reducedMotion,
    [declarations[2].init.callee.name]:enabled=>(animationEnabled=enabled,[visibilityRef,phase]),
    [declarations[4].init.callee.name]:()=>()=>{},
    [declarations[5].init.callee.name]:()=>({current:null}),
    [sequence.expressions[0].callee.name]:()=>{},
    [box.callee.name]:(type,props)=>({type,props}),
    [box.arguments[0].name]:'box',
    [text.arguments[0].name]:'text',
    [glyph]:'●',
  };
  vm.createContext(context);
  vm.runInContext(code.slice(node.start,node.end),context);
  return {tree:context[node.id.name](props),animationEnabled};
}
for(let flags=0;flags<128;flags++){
  const props={isError:!!(flags&1),isNeutral:!!(flags&2),isUnresolved:!!(flags&4),shouldAnimate:!!(flags&8)};
  const environment=[!!(flags&16),!!(flags&32),!!(flags&64)];
  const before=renderIndicator(original,render,props,...environment);
  const after=renderIndicator(indicator,patched,props,...environment);
  assert.equal(after.tree.props.ref,visibilityRef);
  assert.equal(after.animationEnabled,before.animationEnabled);
  assert.equal(JSON.stringify(after.tree),JSON.stringify(before.tree));
}
console.log('PASS: native indicator is byte-identical; 128 states preserve output, visibility ref and motion guards');

// Exercise the exact injected notification parser against native envelopes.
// Any ambiguity must leave the standalone notification visible.
const parserNode=patchedAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='__wfBackgroundTask');
assert(parserNode);
const parserContext={};vm.createContext(parserContext);
vm.runInContext(patched.slice(parserNode.start,parserNode.end),parserContext);
function notification(task='task_1',tool='toolu_1',exitCode=0){
  return {type:'attachment',uuid:'notification_'+task,attachment:{type:'queued_command',commandMode:'task-notification',origin:{kind:'task-notification',producer:'session-task'},prompt:`<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<output-file>fixture/tasks/${task}.output</output-file>\n<status>${exitCode===0?'completed':'failed'}</status>\n<summary>Background command "Fixture background task" ${exitCode===0?'completed (exit code 0)':'failed with exit code '+exitCode}</summary>\n</task-notification>`}};
}
const completion=notification(),saved=JSON.stringify(completion);
assert.equal(parserContext.__wfBackgroundTask(completion).toolUseId,'toolu_1');
assert.equal(parserContext.__wfBackgroundTask(completion).taskId,'task_1');
assert.equal(parserContext.__wfBackgroundTask(completion).status,'completed');
for(const exitCode of [1,7,-1,137])assert.equal(parserContext.__wfBackgroundTask(notification('task_1','toolu_1',exitCode)).status,'failed');
assert.equal(JSON.stringify(completion),saved);
const invalid=[undefined,null,{}, {type:'user',message:{content:completion.attachment.prompt}}];
for(const [from,to] of [['<status>completed','<status>failed'],['<status>completed','<status>killed'],['exit code 0','exit code 7'],['Background command','Agent'],['<tool-use-id>toolu_1</tool-use-id>',''],['<task-id>task_1</task-id>',''],['<output-file>fixture/tasks/task_1.output</output-file>',''],['</task-notification>','</task-notification>\nExtra user text'],['<status>completed</status>','<status>completed</status><status>failed</status>']]){
  const row=notification();row.attachment.prompt=row.attachment.prompt.replace(from,to);invalid.push(row);
}
for(const [key,value] of [['commandMode','prompt'],['origin',{kind:'human'}],['prompt',[{type:'text',text:completion.attachment.prompt}]]]){
  const row=notification();row.attachment[key]=value;invalid.push(row);
}
for(const row of invalid)assert.equal(parserContext.__wfBackgroundTask(row),undefined);
for(const changed of [notification('task_1','toolu_1',1).attachment.prompt.replace('failed with exit code 1','failed with exit code 0'),notification('task_1','toolu_1',1).attachment.prompt.replace('<status>failed','<status>completed')]){
  assert.equal(parserContext.__wfBackgroundTask({...completion,attachment:{...completion.attachment,prompt:changed}}),undefined);
}
// The exact inserted branch only accepts IDs in the current group's Bash map.
const backgroundGroup=adaptGrouping(group);
const branch=backgroundGroup.changes.find(c=>c.reason.startsWith('Absorb completion')).after;
const binding=branch.match(/else if\((\w+)\.bashCommands\?\.has\(__wfBackgroundTask\((\w+)\)/);
assert(binding);
for(const linked of [false,true])for(const outcome of [completion,notification('task_1','toolu_1',1)]){
  const state={messages:[],bashCommands:new Map(linked?[['toolu_1','fixture command']]:[])};
  const context={...parserContext,[binding[1]]:state,[binding[2]]:outcome};vm.createContext(context);
  vm.runInContext('if(false){}'+branch,context);
  assert.equal(state.messages.length,0);
  assert.equal(state.__wfBackgroundTasks?.length??0,linked?1:0);
  if(linked)assert.equal(state.__wfBackgroundTasks[0],outcome);
}
console.log('PASS: linked successful/failed shell notifications preserve their original objects; malformed and unrelated notifications stay standalone');
const summary=adaptRenderer(render).changes.find(c=>c.reason.startsWith('Append only successful background')).after;
const messageName=summary.match(/of (\w+)\.__wfBackgroundTasks/)[1];
const summaryCall=summary.match(/if\(__wfDone>0\)(\w+)\(/)[1];
const jsx=summary.match(/"completed",(\w+)\((\w+),/);
const bold=summary.match(/children:\[(\w+)\(/)[1];
const failure=notification('task_2','toolu_2',1),sameTaskFailure=notification('task_1','toolu_1',7);
for(const [notifications,done,failed] of [[[],0,0],[[completion],1,0],[[completion,completion],1,0],[[completion,notification('task_2','toolu_2')],2,0],[[failure],0,1],[[failure,failure],0,1],[[completion,failure],1,1],[[completion,sameTaskFailure],0,1],[[sameTaskFailure,completion],0,1]]){
  const calls=[],context={...parserContext,[messageName]:{__wfBackgroundTasks:notifications},[summaryCall]:(...args)=>calls.push(args),[jsx[1]]:(type,props)=>props,[bold]:(type,props)=>props,[jsx[2]]:'text'};
  vm.createContext(context);
  assert.equal(JSON.stringify(vm.runInContext(summary+';__wfDone',context)),JSON.stringify(done));
  assert.equal(calls.length,Number(done>0));
  if(done)assert.equal(calls.find(c=>c[1]==='completed')[2].children[0].children,done);
}
console.log('PASS: compact background summary hides failures, deduplicates success and never counts a conflicting failure as success');

// Exercise per-call rollback with a native grouped-tool row: a failed sibling
// must not remove the successful sibling's counts or mutate either message.
const writeBranch=backgroundGroup.changes.find(c=>c.reason.startsWith('Track file calls')).after;
const writeNames=writeBranch.match(/else if\((\w+)\.__wfFileWrite\)\{(\w+)\.editFileCount=.*?\+(\w+);/);
const rowName=writeBranch.match(/of \((\w+)\.type/)[1];
const lineName=writeBranch.match(/let __wfLines=(\w+)\(/)[1];
const cleanName=writeBranch.match(/latestDisplayHint=(\w+)\(/)[1];
const rollback=backgroundGroup.changes.find(c=>c.reason.startsWith('Keep file failures')).after;
let rollbackFunction;
if(profile==='workshop'){
  const ast=parse(backgroundGroup.source,options);
  walk(ast,n=>{if(n.type==='FunctionDeclaration'&&backgroundGroup.source.slice(n.start,n.end).includes('continue}'+rollback.split('continue}')[1]))rollbackFunction=backgroundGroup.source.slice(n.start,n.end)});
  assert(rollbackFunction);
}
for(const grouped of [false,true])for(const denied of [false,true]){
  const calls=[{type:'tool_use',id:'bad',name:'Edit',input:{added:1,removed:2}}];
  if(grouped)calls.push({type:'tool_use',id:'good',name:'Edit',input:{added:3,removed:1}});
  const rows=calls.map(call=>({type:'assistant',message:{content:[call]}}));
  const row=grouped?{type:'grouped_tool_use',messages:rows}:rows[0],saved=JSON.stringify(row),state={};
  const context={[writeNames[1]]:{__wfFileWrite:true,toolUseIds:calls.map(c=>c.id),editLines:{added:grouped?4:1,removed:grouped?3:2},name:'Edit',input:{}},[writeNames[2]]:state,[writeNames[3]]:calls.length,[rowName]:row,[lineName]:(name,input)=>input,[cleanName]:v=>v};
  vm.createContext(context);vm.runInContext('if(false){}'+writeBranch,context);
  assert.equal(JSON.stringify(row),saved);
  const failure={type:'user',message:{content:[{type:'tool_result',tool_use_id:'bad',is_error:true}]},...(denied?{toolDenialKind:'permission'}:{})};
  function fail(message){
    if(profile==='workshop')return vm.runInNewContext('('+rollbackFunction+')(message,state)',{message,state});
    const name=rollback.match(/if\((\w+)\.type/)[1];context[name]=message;vm.runInContext(rollback,context);
  }
  for(let repeat=0;repeat<2;repeat++){
    assert.equal(fail(failure),profile==='workshop'&&repeat===0?denied:profile==='workshop'?false:undefined);
    assert.equal(state.editFileCount,grouped?1:0);
    assert.equal(state.linesAdded,grouped?3:0);assert.equal(state.linesRemoved,grouped?1:0);
  }
  if(profile==='popOutOnErrorIds')assert.equal(state.popOutOnErrorIds.has('bad'),denied);
  if(grouped)fail({type:'user',message:{content:[{type:'tool_result',tool_use_id:'good',is_error:true}]}});
  assert.equal(state.editFileCount,0);assert.equal(state.linesAdded,0);assert.equal(state.linesRemoved,0);
  const forward=backgroundGroup.changes.find(c=>c.reason==='Forward counts and latest preview identity').after;
  const ids=forward.match(/if\((\w+)\.__wfLatestFileWriteId!==void 0\)(\w+)\.editFileCount/),output={};
  vm.runInNewContext(forward,{[ids[1]]:state,[ids[2]]:output});
  assert.equal(output.__wfLatestFileWriteId,calls.at(-1).id);assert.equal(output.editFileCount,0);
}
console.log('PASS: file failures roll back only their own counts once, preserve denial routing and retain failed-only preview identity');

// The original result objects remain available to transcript expansion.
const previewNode=patchedAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='__writeFoldPreview');
assert(previewNode);
const previewSource=patched.slice(previewNode.start,previewNode.end);
const previewJSX=previewSource.match(/return t\?\.is_error\?null:t\?(\w+)\((\w+),/);
assert(previewJSX);
for(const outcome of ['pending','success','failure']){
  const result={type:'tool_result',tool_use_id:'file',is_error:outcome==='failure',content:'original detail'};
  const message={type:'user',message:{content:[result]}},saved=JSON.stringify(message);
  const props={content:{id:'file'},tools:[],columns:80,fallback:'native hint',lookups:{progressMessagesByToolUseID:new Map,toolResultByToolUseID:new Map(outcome==='pending'?[]:[['file',message]])}};
  const value=vm.runInNewContext('('+previewSource+')(props)',{props,[previewJSX[1]]:(type,props)=>props,[previewJSX[2]]:'native-result'});
  if(outcome==='failure')assert.equal(value,null);
  else if(outcome==='pending')assert.equal(value,'native hint');
  else{assert.equal(value.param,result);assert.equal(value.message,message)}
  assert.equal(JSON.stringify(message),saved);
}
const quietIndicator=adaptRenderer(render).changes.find(c=>c.reason.startsWith('Keep ordinary grouped')).after;
const quietNames=quietIndicator.match(/&&(\w+)\.toolResultByToolUseID.get\((\w+)\)/);
for(const kind of [undefined,'permission-rule','automode-blocked']){
  const active=vm.runInNewContext('true'+quietIndicator,{[quietNames[1]]:{toolResultByToolUseID:new Map([['tool',{toolDenialKind:kind}]])},[quietNames[2]]:'tool'});
  assert.equal(active,kind!==undefined);
}
console.log('PASS: failed compact previews are hidden, success/pending previews and original results remain intact, native denial indicators remain visible');

const quietTask=adaptRenderer(render).changes.find(c=>c.reason.startsWith('Hide failed native task')).after;
const taskNames=quietTask.match(/if\((\w+)==="failed"&&!(\w+)&&!(\w+)\)/);
for(const status of ['failed','completed','killed',undefined])for(const verbose of [false,true])for(const expanded of [false,true]){
  const value=vm.runInNewContext('(function(){'+quietTask+'return "native"})()',{[taskNames[1]]:status,[taskNames[2]]:verbose,[taskNames[3]]:expanded});
  assert.equal(value,status==='failed'&&!verbose&&!expanded?null:'native');
}
console.log('PASS: native task failures are hidden when collapsed and preserved when expanded; success and other statuses keep their native rendering');
