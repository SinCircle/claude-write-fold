import fs from 'node:fs';
import assert from 'node:assert/strict';
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
assert.equal(changedRenderer.changes.length,3);
assert(changedRenderer.changes.every(c=>c.before===''));
assert(changedRenderer.nativeRendererUnchanged);global.gc?.();
console.log('PASS: preview and indicator adapt while preserving native renderer bytes');
assert.throws(()=>adaptGrouping(changedGroup.source),/already patched/);
assert.throws(()=>adaptRenderer(changedRenderer.source),/already patched/);global.gc?.();
assert.throws(()=>adaptGrouping(group+'\nfunction fake(y){if(!y?.isSearchOrReadCommand)return{isCollapsible:!1};}'),/got 2/);
global.gc?.();
assert.throws(()=>adaptRenderer(render.replaceAll('isActiveGroup','changedUpstreamProperty')),/got 0/);
console.log('PASS: duplicate patches, ambiguous matches and structural drift are rejected');
