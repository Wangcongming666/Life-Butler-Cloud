const test=require('node:test'),assert=require('node:assert/strict');const schema=require('../miniprogram/utils/data-schema'),{mergeLegacy}=require('../miniprogram/utils/record-model');
test('legacy merge appends, deduplicates and requires explicit conflict choices',()=>{
 const remote=schema.emptyData(),local=schema.emptyData();const t=(id,title)=>({id,title,done:false,dueAt:0,createdAt:0,images:[]});remote.todos=[t('same','云端')];local.todos=[t('same','本地'),t('new','新')];
 const preview=mergeLegacy(local,remote,{});assert.equal(preview.conflicts.length,1);assert.equal(preview.data.todos.length,2);assert.equal(preview.data.todos.find(t=>t.id==='same').title,'云端');
 const resolved=mergeLegacy(local,remote,{'todos:same':'local'});assert.equal(resolved.conflicts.length,0);assert.equal(resolved.data.todos.find(t=>t.id==='same').title,'本地');
 assert.equal(mergeLegacy(resolved.data,resolved.data,{}).conflicts.length,0);
});
test('different IDs for the same meal slot are an explicit merge conflict',()=>{
 const remote=schema.emptyData(),local=schema.emptyData();remote.library.meals=[{id:'remote',date:'2026-10-19',slot:'dinner',title:'云端晚饭',recipeId:'',note:'',updatedAt:0}];local.library.meals=[{id:'local',date:'2026-10-19',slot:'dinner',title:'旧版晚饭',recipeId:'',note:'',updatedAt:0}];
 const preview=mergeLegacy(local,remote,{});assert.equal(preview.conflicts.length,1);const fixed=mergeLegacy(local,remote,{[preview.conflicts[0].key]:'local'});assert.equal(fixed.data.library.meals.length,1);assert.equal(fixed.data.library.meals[0].title,'旧版晚饭');schema.validate(fixed.data);
});
