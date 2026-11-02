import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse,tokenizer} from '../vendor/acorn.mjs';
import {adaptGrouping,adaptRenderer} from '../adapter.mjs';

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

assert(process.argv[2] && process.argv[3], 'Pass grouping and renderer source paths.');
const group=fs.readFileSync(process.argv[2],'utf8'),render=fs.readFileSync(process.argv[3],'utf8');
const profile=group.includes('workshopEditsByToolUseId')?'workshop':'popOutOnErrorIds';
const changedGroup=adaptGrouping(renameBindings(group));
assert.equal(changedGroup.changes.length,7);global.gc?.();
console.log('PASS: '+profile+' grouping adapts to renamed identifiers and whitespace');
const changedRenderer=adaptRenderer(renameBindings(render));
assert.equal(changedRenderer.changes.length,5);
assert(changedRenderer.changes.every(c=>c.before===''));
assert(changedRenderer.nativeRendererUnchanged);global.gc?.();
console.log('PASS: preview and indicator adapt while preserving native renderer bytes');
assert.throws(()=>adaptGrouping(changedGroup.source),/already patched/);
assert.throws(()=>adaptRenderer(changedRenderer.source),/already patched/);global.gc?.();
assert.throws(()=>adaptGrouping(group+'\nfunction fake(y){if(!y?.isSearchOrReadCommand)return{isCollapsible:!1};}'),/got 2/);
global.gc?.();
assert.throws(()=>adaptRenderer(render.replaceAll('isActiveGroup','changedUpstreamProperty')),/got 0/);
console.log('PASS: duplicate patches, ambiguous matches and structural drift are rejected');

// Compare the actual native and patched indicator output over animation,
// reduced-motion, static-frame, error and completion states. The only allowed
// difference is the visibility ref when the group explicitly opts in.
const patched=adaptRenderer(render).source;
const patchedAst=parse(patched,options),nativeAst=parse(render,options);
const indicator=patchedAst.body.find(n=>n.type==='FunctionDeclaration'&&n.params[0]?.type==='ObjectPattern'&&n.params[0].properties.some(p=>p.key?.name==='__wfLiveGroup'));
assert(indicator);
const original=nativeAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===indicator.id.name);
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
  for(const optIn of [false,true]){
    const after=renderIndicator(indicator,patched,{...props,__wfLiveGroup:optIn},...environment);
    assert.equal(after.tree.props.ref,optIn?undefined:visibilityRef);
    assert.equal(after.animationEnabled,before.animationEnabled);
    assert.equal(JSON.stringify(after.tree),JSON.stringify(before.tree));
  }
}
console.log('PASS: 256 indicator states preserve native output and motion guards; only opted-in visibility changes');
