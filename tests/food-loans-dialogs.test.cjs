const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const event=dataset=>({currentTarget:{dataset}});
async function setup(name){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page(name);p.onLoad({});await p.onShow();return {c,p};}
for(const name of ['food','loans'])test(name+' details open without editing and transfer to guarded editor',async()=>{
 const {c,p}=await setup(name),kind=name==='food'?'recipes':'loans';
 await c.store.saveLibraryRecord(kind,name==='food'?{title:'番茄蛋',ingredients:[{name:'蛋',quantity:'2个'}],steps:'炒熟',note:'完整备注',images:[]}:{title:'书',person:'小王',direction:'out',borrowDate:'2026-10-20',note:'完整备注',images:[]});await p.refresh();
 const r=c.store.read().library[kind][0];p.showDetail(event({id:r.id}));assert.equal(p.data.detailVisible,true);assert.equal(p.data.detail.note,'完整备注');assert.equal(p.data.formVisible,false);
 p.edit(event({id:r.id}));assert.equal(p.data.detailVisible,false);assert.equal(p.data.formVisible,true);assert.ok(Object.keys(p._cloudEditTokens).length);
 p.onBusy({detail:{value:true}});const n=c.notices.length;p.close();assert.equal(c.notices.length,n);assert.equal(p.data.formVisible,true);
 p.onBusy({detail:{value:false}});c.offline();await p.save();assert.equal(p.data.formVisible,true);assert.equal(p.data.draft.note,'完整备注');assert.ok(p.data.formError);assert.ok(Object.keys(p._cloudEditTokens).length);p.onUnload();
});
test('meal dialog keeps date slot and recipe; blocks closing and changes during save; retains failed draft',async()=>{
 const {c,p}=await setup('food');await c.store.saveMeal({date:'2026-10-22',slot:'lunch',title:'米饭',recipeId:'',note:'旧备注'});await p.refresh();await p.openMeal(event({date:'2026-10-22',slot:'lunch'}));assert.equal(p.data.meal.title,'米饭');assert.equal(p.data.meal.slot,'lunch');
 c.offline();const saving=p.saveMeal();assert.equal(p.data.busy,true);p.closeMeal();p.onMeal({currentTarget:{dataset:{key:'title'}},detail:{value:'改动'}});assert.equal(p.data.mealVisible,true);assert.equal(p.data.meal.title,'米饭');await saving;assert.equal(p.data.busy,false);assert.equal(p.data.mealVisible,true);assert.ok(p.data.mealError);assert.ok(Object.keys(p._cloudEditTokens).length);p.onUnload();
});
for(const name of ['food','loans'])test(name+' editors and details use independent scrollable overlays',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.wxml'),'utf8');assert.match(w,/scroll-y="{{![^"]*formVisible/);assert.match(w,/info-dialog-mask/);assert.match(w,/info-dialog-header/);assert.match(w,/info-dialog-footer/);assert.match(w,/bindtap="showDetail"/);assert.match(w,/catchtouchmove="stopTouch"/);
 const list=w.slice(0,w.indexOf('</scroll-view>'));assert.doesNotMatch(list,/id="(?:recipe|meal|loan)-editor"/);assert.doesNotMatch(list,/{{item\.(?:steps|note)}}/);
});
for(const name of ['food','loans'])test(name+' dialog opening never requests scrolling the list',async()=>{const {p}=await setup(name);p.add();assert.equal(p.data.scrollTarget,'');p.onUnload();});
test('recipe details add ingredients to shopping and create linked meal; successful save closes modal',async()=>{
 const {c,p}=await setup('food');p.add();p.setData({draft:{...p.data.draft,title:'番茄蛋',ingredientsText:'蛋 2个\n番茄 1个',steps:'炒熟',note:'完整备注'}});await p.save();assert.equal(p.data.formVisible,false);await p.refresh();const id=c.store.read().library.recipes[0].id;p.showDetail(event({id}));await p.shopping(event({id}));await new Promise(resolve=>setTimeout(resolve,5));assert.equal(c.store.read().life.records.filter(r=>r.type==='shopping').length,2);
 await p.openMeal(event({recipe:id,date:'2026-10-23',slot:'dinner'}));assert.equal(p.data.detailVisible,false);assert.equal(p.data.meal.recipeId,id);assert.equal(p.data.meal.date,'2026-10-23');assert.equal(p.data.scrollTarget,'');await p.saveMeal();assert.equal(p.data.mealVisible,false);assert.equal(c.store.read().library.meals[0].title,'番茄蛋');assert.equal(c.store.read().library.meals[0].recipeId,id);p.onUnload();
});
for(const name of ['food','loans'])test(name+' conflicting cloud save preserves modal draft and confirmed remote record',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),c=createClient(service),other=createClient(service);await c.sync.start();await other.sync.start();const kind=name==='food'?'recipes':'loans';await c.store.saveLibraryRecord(kind,name==='food'?{title:'原菜谱',ingredients:[{name:'蛋',quantity:'2个'}],steps:'煮熟',images:[]}:{title:'原书',person:'同学',direction:'out',borrowDate:'2026-10-20',images:[]});const p=c.page(name);p.onLoad({});await p.onShow();const r=c.store.read().library[kind][0];p.edit(event({id:r.id}));p.onField({currentTarget:{dataset:{key:'note'}},detail:{value:'未保存备注'}});await other.sync.pull({force:true});await other.store.saveLibraryRecord(kind,{...other.store.read().library[kind][0],title:'另一设备修改'});await c.sync.pull({force:true});await p.save();assert.equal(p.data.formVisible,true);assert.equal(p.data.draft.note,'未保存备注');assert.ok(p.data.formError);assert.equal(c.store.read().library[kind][0].title,'另一设备修改');p.onUnload();
});
