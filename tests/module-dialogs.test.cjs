const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(name){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page(name);p.onLoad({});await p.onShow();return {c,p};}
test('schedule import opens without scrolling the timetable and cannot close during import',async()=>{
 const {p}=await setup('schedule');p.setData({scrollTarget:'week-top-b'});p.openImport();assert.equal(p.data.scrollTarget,'week-top-b');p.setData({importBusy:true});p.closePanel();assert.equal(p.data.panel,'import');p.setData({importBusy:false});p.closePanel();assert.equal(p.data.panel,'');p.onUnload();
});
test('exam dialog retains its draft on failed save and locks duplicate submits and closing',async()=>{
 const {c,p}=await setup('schedule');p.addExam();p.onExamField({currentTarget:{dataset:{key:'title'}},detail:{value:'保留考试'}});let release,calls=0;const original=c.store.saveExam;c.store.saveExam=async()=>{calls++;await new Promise(r=>release=r);throw Error('断网');};
 const saving=p.saveExam();assert.equal(p.data.examBusy,true);p.closeExamForm();await p.saveExam();assert.equal(p.data.examFormVisible,true);assert.equal(calls,1);release();await saving;assert.equal(p.data.examBusy,false);assert.equal(p.data.examDraft.title,'保留考试');assert.match(p.data.examError,/断网/);c.store.saveExam=original;p.onUnload();
});
test('backup preview opens a dialog and closing does not change confirmed records',async()=>{
 const {c,p}=await setup('backup');p.onText({detail:{value:c.store.exportJSON()}});p.parse();assert.equal(p.data.restoreVisible,true);assert.ok(p.data.preview);p.setData({busy:true});p.closeRestore();assert.equal(p.data.restoreVisible,true);p.setData({busy:false});p.closeRestore();assert.equal(p.data.restoreVisible,false);assert.equal(c.store.read().todos.length,0);p.onUnload();
});
test('display settings and favorites open their own dialogs and cannot dismiss while saving',async()=>{
 const {p}=await setup('settings');p.openSettingsDialog({currentTarget:{dataset:{dialog:'appearance'}}});assert.equal(p.data.settingsDialog,'appearance');p.setData({settingsBusy:true});p.closeSettingsDialog();assert.equal(p.data.settingsDialog,'appearance');p.setData({settingsBusy:false});p.closeSettingsDialog();assert.equal(p.data.settingsDialog,'');p.onUnload();
});
test('timer duration input belongs to a dialog and closes only after confirmed start',async()=>{
 const {p}=await setup('focus');p.openTimerSettings();assert.equal(p.data.timerFormVisible,true);p.onMinutes({detail:{value:'3'}});await p.start();assert.equal(p.data.timerFormVisible,false);assert.ok(p.data.timer);p.onUnload();
});

test('tool calculator dialog preserves catalog filters and previous input when reopened',async()=>{
 const {p}=await setup('tools');p.setData({toolQuery:'计算',principal:'35'});p.openTool({currentTarget:{dataset:{id:'mortgage'}}});assert.equal(p.data.activeTool,'mortgage');p.backToTools();assert.equal(p.data.activeTool,'');assert.equal(p.data.toolQuery,'计算');p.openTool({currentTarget:{dataset:{id:'mortgage'}}});assert.equal(p.data.principal,'35');p.onUnload();
});
test('automatic preference save locks dismissal and reports failures without changing confirmed preferences',async()=>{
 const {c,p}=await setup('settings');p.openSettingsDialog({currentTarget:{dataset:{dialog:'appearance'}}});const original=c.store.savePreferences;let release;c.store.savePreferences=async()=>{await new Promise(r=>release=r);throw Error('断网');};
 const saving=p.save({theme:'blue'});assert.equal(p.data.settingsBusy,true);p.closeSettingsDialog();assert.equal(p.data.settingsDialog,'appearance');release();await saving;assert.equal(p.data.settingsBusy,false);assert.match(p.data.settingsError,/断网/);assert.equal(c.store.read().preferences.theme,'mint');c.store.savePreferences=original;p.onUnload();
});
test('timer failed start keeps duration draft and cancel restores the previously configured duration',async()=>{
 const {c,p}=await setup('focus');p.openTimerSettings();p.onMinutes({detail:{value:'12'}});let release;const original=c.store.startTimer;c.store.startTimer=async()=>{await new Promise(r=>release=r);throw Error('断网');};
 const saving=p.start();p.closeTimerSettings();assert.equal(p.data.timerFormVisible,true);release();await saving;assert.equal(p.data.minutes,'12');assert.match(p.data.timerError,/断网/);assert.equal(p.data.timerBusy,false);p.closeTimerSettings();assert.equal(p.data.minutes,'25');c.store.startTimer=original;p.onUnload();
});
