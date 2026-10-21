const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const event=id=>({currentTarget:{dataset:{id}}});
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('notes');p.onLoad({});await p.onShow();return {c,p};}
test('notes editor and full details use independent dialogs with locked background and compact cards',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/notes/index.wxml'),'utf8');const list=w.slice(w.indexOf('<scroll-view class="content"'),w.indexOf('  </scroll-view>'));
 assert.doesNotMatch(list,/id="note-editor"/);assert.match(w,/scroll-y="{{!formVisible && !detailNote}}"/);
 assert.match(w,/id="note-editor"[^>]*class="info-dialog/);assert.match(w,/id="note-detail"[^>]*class="info-dialog/);assert.match(w,/note-comment note-comment-preview/);assert.match(w,/info-dialog-error/);
});
test('full note details preserve all text and photos and editing replaces details without scrolling',async()=>{
 const {c,p}=await setup();const comment='完整想法'.repeat(300);await c.store.saveNoteWithImages({title:'心仪的杯子',comment,price:'23',images:[]});p.refresh();const id=p.data.notes[0].id;
 p.openDetail(event(id));assert.equal(p.data.detailNote.comment,comment);p.openEdit(event(id));assert.equal(p.data.detailNote,null);assert.equal(p.data.formVisible,true);assert.equal(p.data.commentInput,comment);assert.equal(p.data.scrollTarget,'');
 p.closeForm();await c.notices.at(-1).success({confirm:false});assert.equal(p.data.formVisible,true);p.closeForm();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.formVisible,false);
 p.openDetail(event(id));p.closeDetail();assert.equal(p.data.detailNote,null);p.onUnload();
});
test('failed save keeps draft and inline error; pending image picker blocks dismissal',async()=>{
 const {c,p}=await setup();p.openNew();p.onField({currentTarget:{dataset:{key:'titleInput'}},detail:{value:'未保存的文字'}});c.offline();await p.save();assert.equal(p.data.formVisible,true);assert.equal(p.data.titleInput,'未保存的文字');assert.ok(p.data.formError);assert.equal(p.data.busy,false);
 let chooser;c.wx.chooseMedia=o=>{chooser=o;};const selecting=p.chooseAlbum();assert.equal(p.data.busy,true);const notices=c.notices.length;p.closeForm();assert.equal(c.notices.length,notices);assert.equal(p.data.formVisible,true);chooser.success({tempFiles:[{tempFilePath:'/tmp/photo.jpg',size:1}]});await selecting;assert.equal(p.data.images[0],'/tmp/photo.jpg');p.onUnload();
});
test('saving prevents closing and success resets dialog only after confirmation',async()=>{
 const {c,p}=await setup();p.openNew();p.setData({titleInput:'等待云端'});let complete;c.store.saveNoteWithImages=()=>new Promise(resolve=>{complete=resolve;});const saving=p.save();assert.equal(p.data.busy,true);p.closeForm();p.openNew();assert.equal(p.data.titleInput,'等待云端');assert.equal(p.data.formVisible,true);complete();await saving;assert.equal(p.data.formVisible,false);assert.equal(p.data.busy,false);assert.equal(p.data.formError,'');p.onUnload();
});
test('notes edit dialog keeps original cloud version after refresh and preserves photo draft on conflict',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();a.files.set('/tmp/photo.jpg','YQ==');await a.store.saveNoteWithImages({title:'原文',comment:'',price:'',images:['/tmp/photo.jpg']});const id=a.store.read().notes[0].id;
 const p=a.page('notes');p.onLoad({});await p.onShow();p.openDetail(event(id));assert.equal(p.data.detailNote.images.length,1);p.openEdit(event(id));const image=p.data.images[0];await b.sync.start();await b.store.saveNoteWithImages({id,title:'远端最新',comment:'',price:'',images:[image]});await a.sync.pull({force:true});assert.equal(p.data.titleInput,'原文');p.setData({titleInput:'旧草稿'});await p.save();assert.equal(p.data.formVisible,true);assert.ok(p.data.formError);assert.equal(p.data.titleInput,'旧草稿');assert.equal(p.data.images[0],image);assert.equal(a.store.read().notes[0].title,'远端最新');p.onUnload();
});
