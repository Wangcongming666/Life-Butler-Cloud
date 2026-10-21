const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const event=(day,period)=>({currentTarget:{dataset:{day,period}}});
async function setup(){
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();
 await c.store.saveTerm({termName:'学期',termStart:'2026-09-07',totalWeeks:4});
 await c.store.saveCourse({title:'完整的课程名称不会截断',teacher:'张老师',location:'第一教学楼 302',day:1,start:1,end:2,weeks:'1-3'});
 const p=c.page('schedule');p.onLoad({});await p.onShow();p.changeWeek({detail:{value:1}});return {c,p};
}
test('empty period opens a prefilled one-week course dialog and saving updates only that week',async()=>{
 const {c,p}=await setup();p.openEmptySlot(event(2,4));
 assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.courseTemporary,true);
 assert.equal(p.data.draft.day,2);assert.equal(p.data.draft.start,4);assert.equal(p.data.draft.end,4);assert.equal(p.data.draft.weeks,'2');
 p.onCourseField({currentTarget:{dataset:{key:'title'}},detail:{value:'临时加课'}});await p.saveCourse();
 assert.equal(p.data.courseDialog,'');assert.equal(p.data.week,2);
 const added=c.store.read().schedule.courses.find(c=>c.title==='临时加课');assert.deepEqual(Array.from(added.weeks),[2]);assert.equal(added.day,2);assert.equal(added.start,4);
 assert.equal(p.data.days[1].blocks[0].title,'临时加课');p.nextWeek();assert.equal(p.data.days[1].blocks.length,0);p.onUnload();
});
test('occupied period opens full details; editing retains the same course and its original weeks',async()=>{
 const {c,p}=await setup();const id=p.data.term.courses[0].id;
 p.openEmptySlot(event(1,2));assert.equal(p.data.courseDialog,'details');assert.equal(p.data.courseDetails.length,1);
 const detail=p.data.courseDetails[0];assert.equal(detail.title,'完整的课程名称不会截断');assert.equal(detail.teacher,'张老师');assert.equal(detail.location,'第一教学楼 302');assert.equal(detail.weekdayText,'星期一');assert.ok(detail.weeksText.includes('3'));
 p.editCourse({currentTarget:{dataset:{id}}});assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.courseTemporary,false);assert.equal(p.data.draft.weeks,'1,2,3');
 p.onCourseField({currentTarget:{dataset:{key:'teacher'}},detail:{value:'李老师'}});await p.saveCourse();
 assert.equal(c.store.read().schedule.courses.length,1);assert.equal(c.store.read().schedule.courses[0].id,id);assert.equal(c.store.read().schedule.courses[0].teacher,'李老师');p.onUnload();
});
test('overlapping courses are all shown in one details dialog without the six-item action sheet limit',async()=>{
 const {c,p}=await setup();for(let i=0;i<7;i++)await c.store.saveCourse({title:'重叠'+i,teacher:'',location:'',day:1,start:2,end:3,weeks:'2'});
 await p.refresh();const block=p.data.days[0].blocks[0];p.openBlock({currentTarget:{dataset:{day:1,key:block.key}}});
 assert.equal(p.data.courseDialog,'details');assert.equal(p.data.courseDetails.length,8);assert.ok(p.data.courseDetails.some(c=>c.title==='重叠6'));p.onUnload();
});
test('cancel and invalid slots never write data; validation errors retain the course editor',async()=>{
 const {c,p}=await setup();for(const [day,period]of [[0,1],[8,1],[1,0],[1,99]])p.openEmptySlot(event(day,period));assert.equal(p.data.courseDialog,'');
 p.openEmptySlot(event(3,3));await p.saveCourse();assert.equal(p.data.courseDialog,'edit');assert.ok(p.data.courseError);assert.equal(c.store.read().schedule.courses.length,1);
 p.closeCourseDialog();assert.equal(p.data.courseDialog,'');assert.equal(c.store.read().schedule.courses.length,1);p.onUnload();
});
test('pending cloud save locks closing and duplicate actions; failure preserves draft for retry',async()=>{
 const {c,p}=await setup();p.openEmptySlot(event(3,3));p.setData({draft:{...p.data.draft,title:'保留草稿'}});
 const original=c.store.saveCourse;let release,calls=0;c.store.saveCourse=async()=>{calls++;await new Promise(resolve=>release=resolve);throw Error('断网');};
 const saving=p.saveCourse();assert.equal(p.data.courseBusy,true);p.closeCourseDialog();await p.saveCourse();assert.equal(calls,1);assert.equal(p.data.courseDialog,'edit');
 release();await saving;assert.equal(p.data.courseBusy,false);assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.draft.title,'保留草稿');assert.match(p.data.courseError,/断网/);
 c.store.saveCourse=original;await p.saveCourse();assert.equal(p.data.courseDialog,'');assert.equal(c.store.read().schedule.courses.length,2);p.onUnload();
});
test('course deletion confirms, preserves editor on cancel or failure, and succeeds on retry',async()=>{
 const {c,p}=await setup();p.editById(p.data.term.courses[0].id);p.deleteCourse();await c.notices.at(-1).success({confirm:false});
 assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.courseBusy,false);assert.equal(c.store.read().schedule.courses.length,1);
 c.offline();p.deleteCourse();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.courseDialog,'edit');assert.ok(p.data.courseError);assert.equal(p.data.courseBusy,false);
 c.offline(false);p.deleteCourse();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.courseDialog,'');assert.equal(c.store.read().schedule.courses.length,0);p.onUnload();
});
test('swipe and active dialogs cannot open an unintended empty-period editor',async()=>{
 const {p}=await setup();p.onWeekTouchStart({touches:[{clientX:250,clientY:120,identifier:1}]});p.onWeekTouchEnd({touches:[],changedTouches:[{clientX:60,clientY:120,identifier:1}]});p.openEmptySlot(event(3,3));assert.equal(p.data.courseDialog,'');
 p.addCourse();const week=p.data.week;p.onWeekTouchStart({touches:[{clientX:250,clientY:120,identifier:1}]});p.onWeekTouchEnd({touches:[],changedTouches:[{clientX:60,clientY:120,identifier:1}]});assert.equal(p.data.week,week);p.onUnload();
});
test('course editor and details use an overlay; a configured empty term still renders the tappable board',()=>{
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/schedule/index.wxml'),'utf8');
 assert.doesNotMatch(wxml,/panel === 'course'/);assert.match(wxml,/aria-role="dialog"/);assert.match(wxml,/bindtap="openEmptySlot"/);
 assert.match(wxml,/courseDialog === 'details'/);assert.match(wxml,/courseDialog === 'edit'/);assert.match(wxml,/!term.courses.length && !term.termStart/);
});

test('configured term without courses exposes empty periods and supports the first course',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();await c.store.saveTerm({termName:'空课表',termStart:'2026-09-07',totalWeeks:4});
 const p=c.page('schedule');p.onLoad({});await p.onShow();assert.equal(p.data.days.length,7);assert.equal(p.data.days[0].slots.length,14);assert.equal(p.data.days[0].slots[0].occupied,false);
 p.openEmptySlot(event(7,14));assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.draft.start,14);assert.equal(p.data.draft.end,14);p.closeCourseDialog();p.onUnload();
});
test('editing after another device changes the same course preserves conflict protection and the draft',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();
 await a.store.saveTerm({termName:'学期',termStart:'2026-09-07',totalWeeks:4});await a.store.saveCourse({title:'并发课程',teacher:'原教师',location:'101',day:1,start:1,end:2,weeks:'1-4'});
 const p=a.page('schedule');p.onLoad({});await p.onShow();const id=p.data.term.courses[0].id;p.editById(id);p.onCourseField({currentTarget:{dataset:{key:'teacher'}},detail:{value:'我的草稿'}});
 await b.sync.start();await b.store.saveCourse({...b.store.read().schedule.courses[0],teacher:'另一设备修改'});await a.sync.pull();await p.saveCourse();
 assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.draft.teacher,'我的草稿');assert.ok(p.data.courseError);assert.equal(a.store.read().schedule.courses[0].teacher,'另一设备修改');p.onUnload();
});
test('adding homework from course details preserves selected-week context when returning',async()=>{
 const {c,p}=await setup();let route;c.wx.navigateTo=options=>route=options.url;
 p.openEmptySlot(event(1,1));const id=p.data.courseDetails[0].id;p.addHomework({currentTarget:{dataset:{id}}});assert.ok(route.includes(encodeURIComponent(id)));
 p.onHide();await p.onShow();assert.equal(p.data.week,2);assert.equal(p.data.courseDialog,'details');p.onUnload();
});
