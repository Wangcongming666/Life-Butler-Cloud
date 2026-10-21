const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const event=id=>({currentTarget:{dataset:{id}}});
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('schedule');p.onLoad({});await p.onShow();return {c,p};}
const csv='课程名称,星期,开始节次,结束节次,周次,教师,教室\n数学,星期一,1,2,1-16周,王老师,A101';
test('exam and import editors move out of schedule content into dialogs with complete exam details',async()=>{
 const w=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/schedule/index.wxml'),'utf8'),content=w.slice(w.indexOf('<scroll-view class="content"'),w.indexOf('  </scroll-view>'));
 assert.doesNotMatch(content,/wx:if="{{examFormVisible}}"|wx:if="{{panel === 'import'}}"/);assert.match(w,/id="exam-editor"[^>]*class="info-dialog/);assert.match(w,/id="exam-detail"[^>]*class="info-dialog/);assert.match(w,/id="schedule-import"[^>]*class="info-dialog/);
 const {c,p}=await setup(),note='完整考试备注'.repeat(25);await c.store.saveExam({title:'高等数学',date:'2026-12-01',start:'09:00',end:'11:00',location:'教室A',seat:'23',method:'笔试',note});await p.refresh();const id=p.data.term.exams[0].id;p.openExamDetail(event(id));assert.equal(p.data.examDetail.note,note);assert.equal(p.data.examDetail.seat,'23');p.editExam(event(id));assert.equal(p.data.examDetail,null);assert.equal(p.data.examDraft.note,note);assert.equal(p.data.examFormVisible,true);p.closeExamForm();assert.equal(p.data.examFormVisible,false);p.onUnload();
});
test('import cancellation and offline failure retain text and preview; confirmed success opens term setup',async()=>{
 const {c,p}=await setup();p.openImport();p.onImportText({detail:{value:csv}});await p.previewImport();assert.equal(p.data.previewCount,1);p.setData({importMode:1});p.confirmImport();assert.equal(p.data.importBusy,true);assert.match(c.notices.at(-1).title,/替换/);await c.notices.at(-1).success({confirm:false});assert.equal(p.data.importBusy,false);assert.equal(p.data.importText,csv);assert.equal(p.data.previewCount,1);
 c.offline();p.confirmImport();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.panel,'import');assert.equal(p.data.importText,csv);assert.equal(p.data.previewCount,1);assert.ok(p.data.importError);assert.equal(p.data.importBusy,false);
 c.offline(false);p.confirmImport();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.term.courses.length,1);assert.equal(p.data.panel,'settings');assert.equal(p.data.importText,'');p.onUnload();
});
test('file picker and read keep import dialog locked and show inline failure',async()=>{
 const {c,p}=await setup();p.openImport();let picker,reader;c.wx.chooseMessageFile=o=>{picker=o;};const fs=c.wx.getFileSystemManager();c.wx.getFileSystemManager=()=>({...fs,readFile:o=>{reader=o;}});p.chooseFile();assert.equal(p.data.importBusy,true);p.closePanel();assert.equal(p.data.panel,'import');picker.success({tempFiles:[{path:'/tmp/term.doc',size:10}]});assert.equal(p.data.importBusy,true);reader.fail();assert.equal(p.data.importBusy,false);assert.match(p.data.importError,/读取失败/);p.closePanel();assert.equal(p.data.panel,'');p.onUnload();
});

test('exam editor keeps stale version protection across cloud refresh and retains draft on conflict',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();await a.store.saveExam({title:'初始考试',date:'2026-12-01',start:'09:00',end:'11:00',method:'笔试'});const id=a.store.read().schedule.exams[0].id;
 const p=a.page('schedule');p.onLoad({section:'exams'});await p.onShow();p.openExamDetail(event(id));p.editExam(event(id));await b.sync.start();await b.store.saveExam({...b.store.read().schedule.exams[0],title:'另一设备的新考试'});await a.sync.pull({force:true});assert.equal(p.data.examDraft.title,'初始考试');p.onExamField({currentTarget:{dataset:{key:'title'}},detail:{value:'旧版本草稿'}});await p.saveExam();assert.equal(p.data.examFormVisible,true);assert.equal(p.data.examDraft.title,'旧版本草稿');assert.ok(p.data.examError);assert.equal(a.store.read().schedule.exams[0].title,'另一设备的新考试');p.onUnload();
});
