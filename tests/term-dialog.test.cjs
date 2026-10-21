const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();await c.store.saveTerm({termName:'原学期',termStart:'2026-08-24',totalWeeks:20});await c.store.saveCourse({title:'保留课程',day:1,start:1,end:2,weeks:'1-16',teacher:'',location:''});const p=c.page('schedule');p.onLoad({});await p.onShow();return {c,p};}
const field=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
test('term settings opens as a modal without moving the timetable; cancel discards changes',async()=>{
 const {c,p}=await setup();p.setData({scrollTarget:'week-top-b'});p.openSettings();assert.equal(p.data.panel,'settings');assert.equal(p.data.scrollTarget,'week-top-b');
 p.onSetting(field('termName','未保存草稿'));p.closeSettings();assert.equal(p.data.panel,'');assert.equal(p.data.scrollTarget,'week-top-b');assert.equal(c.store.read().schedule.termName,'原学期');p.openSettings();assert.equal(p.data.termName,'原学期');p.onUnload();
});
test('date and current-week calibration both save from the dialog and preserve courses',async()=>{
 const {c,p}=await setup();p.openSettings();p.onSetting(field('termName','新学期'));await p.saveSettings();assert.equal(p.data.panel,'');assert.equal(c.store.read().schedule.termName,'新学期');assert.equal(c.store.read().schedule.courses.length,1);assert.match(p.data.scrollTarget,/^week-top-/);
 p.openSettings();p.onSetupMode({currentTarget:{dataset:{mode:'week'}}});p.onSetting(field('currentWeekInput','6'));assert.ok(p.data.calibrationPreview);await p.saveSettings();assert.equal(p.data.panel,'');assert.equal(p.data.week,6);p.onUnload();
});
test('invalid term settings stay in the dialog with the original data unchanged',async()=>{
 const {c,p}=await setup();p.openSettings();p.onSetting(field('totalWeeks','0'));await p.saveSettings();assert.equal(p.data.panel,'settings');assert.ok(p.data.termError);assert.equal(p.data.totalWeeks,'0');assert.equal(c.store.read().schedule.totalWeeks,20);p.onUnload();
});
test('pending term save blocks dismissing, duplicate submits and field edits; failure retains the draft',async()=>{
 const {c,p}=await setup();p.openSettings();p.onSetting(field('termName','保留草稿'));const original=c.store.saveTerm;let release,calls=0;c.store.saveTerm=async()=>{calls++;await new Promise(resolve=>release=resolve);throw Error('断网');};
 const saving=p.saveSettings();assert.equal(p.data.termBusy,true);p.closeSettings();p.closePanel();p.onSetting(field('termName','不能覆盖'));await p.saveSettings();assert.equal(p.data.panel,'settings');assert.equal(p.data.termName,'保留草稿');assert.equal(calls,1);
 release();await saving;assert.equal(p.data.termBusy,false);assert.equal(p.data.panel,'settings');assert.match(p.data.termError,/断网/);c.store.saveTerm=original;await p.saveSettings();assert.equal(p.data.panel,'');assert.equal(c.store.read().schedule.termName,'保留草稿');p.onUnload();
});
test('term dialog is outside scrolling content with fixed actions and disabled background scrolling',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/schedule/index.wxml'),'utf8');assert.match(source,/class="course-dialog-mask term-dialog-mask"/);assert.match(source,/aria-label="学期设置"/);assert.match(source,/bindtap="closeSettings"/);assert.match(source,/scroll-y="\{\{!courseDialog && !panel && !examFormVisible && !examDetail\}\}"/);
 const mask=source.indexOf('class="course-dialog-mask term-dialog-mask"');assert.ok(mask>source.indexOf('class="schedule-dock"'));
});
