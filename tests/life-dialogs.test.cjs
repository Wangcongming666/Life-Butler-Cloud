const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const event=id=>({currentTarget:{dataset:{id}}});
async function setup(type='homework'){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('life');p.onLoad({type});await p.onShow();return {c,p};}
test('life editors and calendar are independent dialogs and lock the background',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/life/index.wxml'),'utf8');
 const content=w.slice(w.indexOf('<scroll-view class="content"'),w.indexOf('  </scroll-view>'));
 assert.doesNotMatch(content,/id="life-editor"|id="habit-calendar"/);
 assert.match(w,/scroll-y="{{!budgetFormVisible && !formVisible && !habitId && !detailRecord}}"/);
 for(const id of ['life-editor','habit-calendar','life-detail'])assert.match(w,new RegExp('class="info-dialog[^" ]*[^\"]*"[^>]*id="'+id+'"|id="'+id+'"[^>]*class="info-dialog'));
 assert.match(w,/class="record-note record-note-preview"/);
});
test('record details retain full notes and photos, editor and calendar replace details',async()=>{
 const {c,p}=await setup();const note='完整要求'.repeat(200);await c.store.saveLifeRecord({type:'homework',title:'长作业',date:'2026-10-21',time:'20:00',note,images:[]});await p.refresh();const id=p.data.records[0].id;
 p.openDetail(event(id));assert.equal(p.data.detailRecord.note,note);p.edit(event(id));assert.equal(p.data.detailRecord,null);assert.equal(p.data.formVisible,true);assert.equal(p.data.draft.note,note);
 p.closeForm();await c.notices.at(-1).success({confirm:true});p.openDetail(event(id));p.closeDetail();assert.equal(p.data.detailRecord,null);p.onUnload();
 const h=await setup('habits');await h.c.store.saveLifeRecord({type:'habits',title:'阅读'});await h.p.refresh();h.p.openDetail(event(h.p.data.records[0].id));h.p.openCalendar(event(h.p.data.records[0].id));assert.equal(h.p.data.detailRecord,null);assert.ok(h.p.data.habitId);assert.equal(h.p.data.scrollTarget,'');h.p.setData({busy:true});h.p.closeCalendar();assert.ok(h.p.data.habitId);h.p.setData({busy:false});h.p.closeCalendar();assert.equal(h.p.data.habitId,'');h.p.onUnload();
});
test('invalid save retains form with inline error and busy image selection prevents dismissal',async()=>{
 const {c,p}=await setup();p.add();await p.save();assert.equal(p.data.formVisible,true);assert.ok(p.data.formError);assert.equal(p.data.busy,false);
 let chooser;c.wx.chooseMedia=o=>{chooser=o;};const selecting=p.chooseImage({currentTarget:{dataset:{source:'album'}}});assert.equal(p.data.busy,true);const count=c.notices.length;p.closeForm();assert.equal(c.notices.length,count);assert.equal(p.data.formVisible,true);chooser.success({tempFiles:[{tempFilePath:'/tmp/photo.jpg',size:1}]});await selecting;assert.equal(p.data.draft.images[0],'/tmp/photo.jpg');p.closeForm();await c.notices.at(-1).success({confirm:false});assert.equal(p.data.formVisible,true);p.onUnload();
});

test('all six life editors save and reopen full drafts without changing course and image references',async()=>{
 for(const type of ['homework','assets','shopping','habits','countdown','expiry']){
  const {c,p}=await setup(type);p.add();assert.equal(p.data.scrollTarget,'');p.onField({currentTarget:{dataset:{key:'title'}},detail:{value:'测试'+type}});p.onField({currentTarget:{dataset:{key:'note'}},detail:{value:'完整备注\n第二行'}});await p.save();assert.equal(p.data.formVisible,false,type);assert.equal(c.store.read().life.records[0].note,'完整备注\n第二行',type);await p.refresh();p.edit(event(p.data.records[0].id));assert.equal(p.data.draft.title,'测试'+type);assert.equal(p.data.formError,'');p.onUnload();
 }
 const {c,p}=await setup();await c.store.importCourses([{title:'数学',day:1,start:1,end:2,weeks:[1,2]}],'append');await p.refresh();p.add();p.onCourse({detail:{value:'1'}});c.files.set('/tmp/attachment.jpg','YQ==');p.setData({draft:{...p.data.draft,title:'课程作业',images:['/tmp/attachment.jpg']}});await p.save();await p.refresh();const record=p.data.records[0];p.openDetail(event(record.id));assert.equal(p.data.detailRecord.images.length,1);p.edit(event(record.id));assert.equal(p.data.draft.courseTitle,'数学');assert.equal(p.data.courseIndex,1);assert.equal(p.data.draft.images[0],record.images[0]);p.closeForm();await c.notices.at(-1).success({confirm:true});assert.equal(c.store.read().life.records[0].images[0],record.images[0]);p.onUnload();
});
test('life editor conflict keeps draft and requires reopening instead of overwriting remote record',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();await b.sync.start();await a.store.saveLifeRecord({type:'homework',title:'原作业',date:'2026-10-22',time:'20:00'});await b.sync.pull({force:true});const p=a.page('life');p.onLoad({type:'homework'});await p.onShow();const id=p.data.records[0].id;p.edit(event(id));p.onField({currentTarget:{dataset:{key:'title'}},detail:{value:'本地草稿'}});await b.store.saveLifeRecord({...b.store.read().life.records[0],title:'另一设备更新'});await a.sync.pull({force:true});await p.save();assert.equal(p.data.formVisible,true);assert.equal(p.data.draft.title,'本地草稿');assert.ok(p.data.formError);assert.equal(a.store.read().life.records[0].title,'另一设备更新');p.closeForm();await a.notices.at(-1).success({confirm:true});p.edit(event(id));assert.equal(p.data.draft.title,'另一设备更新');p.onUnload();
});
