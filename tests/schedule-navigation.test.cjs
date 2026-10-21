const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createClient}=require('./helpers/client.cjs');
async function setup(){
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();
 await c.store.saveTerm({termName:'测试学期',termStart:'2026-09-07',totalWeeks:4});
 await c.store.saveCourse({title:'第二周课程',teacher:'',location:'101',day:1,start:1,end:2,weeks:'2'});
 const p=c.page('schedule');p.onLoad({});await p.onShow();p.changeWeek({detail:{value:1}});
 return {c,p};
}
const point=(x,y,id=1)=>({clientX:x,clientY:y,identifier:id});
function swipe(p,from,to){p.onWeekTouchStart({touches:[point(...from)]});p.onWeekTouchMove({touches:[point(...to)]});p.onWeekTouchEnd({touches:[],changedTouches:[point(...to)]});}
test('left and right swipes update the complete weekly timetable and remain inside term bounds',async()=>{
 const {p}=await setup();assert.equal(p.data.thisWeek.length,1);
 const start=p.data.days[0].fullDate;
 swipe(p,[250,200],[90,210]);assert.equal(p.data.week,3);assert.equal(p.data.weekIndex,2);assert.equal(p.data.thisWeek.length,0);assert.notEqual(p.data.days[0].fullDate,start);
 swipe(p,[90,210],[250,200]);assert.equal(p.data.week,2);assert.equal(p.data.thisWeek[0].title,'第二周课程');
 p.changeWeek({detail:{value:0}});swipe(p,[60,150],[240,150]);assert.equal(p.data.week,1);
 p.changeWeek({detail:{value:3}});swipe(p,[240,150],[60,150]);assert.equal(p.data.week,4);
 p.onUnload();
});
test('vertical scrolling, diagonal gestures, taps, multi-touch and canceled gestures do not change week',async()=>{
 const {p}=await setup();
 for(const [from,to] of [[[180,200],[170,50]],[[180,200],[110,145]],[[180,200],[165,205]]]){swipe(p,from,to);assert.equal(p.data.week,2);}
 p.onWeekTouchStart({touches:[point(180,200)]});p.onWeekTouchMove({touches:[point(180,150)]});p.onWeekTouchEnd({touches:[],changedTouches:[point(30,150)]});assert.equal(p.data.week,2,'vertical intention stays vertical');
 p.onWeekTouchStart({touches:[point(180,200),point(200,200,2)]});p.onWeekTouchEnd({touches:[],changedTouches:[point(30,200)]});assert.equal(p.data.week,2);
 p.onWeekTouchStart({touches:[point(180,200)]});p.onWeekTouchCancel();p.onWeekTouchEnd({touches:[],changedTouches:[point(30,200)]});assert.equal(p.data.week,2);
 p.onWeekTouchStart({touches:[point(180,200)]});p.onHide();p.onWeekTouchEnd({touches:[],changedTouches:[point(30,200)]});assert.equal(p.data.week,2);
 p.onUnload();
});
test('swipes are disabled in exam and edit panels and cannot accidentally open a course',async()=>{
 const {p}=await setup();
 p.switchSection({currentTarget:{dataset:{section:'exams'}}});swipe(p,[240,200],[60,200]);assert.equal(p.data.week,2);
 p.switchSection({currentTarget:{dataset:{section:'courses'}}});p.openSettings();swipe(p,[240,200],[60,200]);assert.equal(p.data.week,2);p.closePanel();
 const day=p.data.days.find(day=>day.blocks.length),key=day.blocks[0].key;
 swipe(p,[240,200],[60,200]);swipe(p,[60,200],[240,200]);p.openBlock({currentTarget:{dataset:{day:day.day,key}}});assert.equal(p.data.courseDialog,'');
 p.currentWeek();assert.equal(p.data.week,4,'current week shortcut continues to work');
 p.onUnload();
});
test('timetable is the main scroll content while management actions remain in the bottom dock',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/schedule/index.wxml'),'utf8');
 const dock=source.indexOf('class="schedule-dock"');assert.ok(dock>source.indexOf('</scroll-view>',source.indexOf('class="board-scroll"')),'management dock is outside scrolling timetable');
 assert.doesNotMatch(source,/class="schedule-actions"/);
 assert.ok(source.indexOf('class="schedule-weekbar"')<source.indexOf('<scroll-view class="content"'));
 for(const handler of ['openHomework','openSettings','openImport','addCourse'])assert.match(source.slice(dock),new RegExp('bindtap="'+handler+'"'));
 for(const event of ['touchstart','touchmove','touchend','touchcancel'])assert.match(source,new RegExp('bind'+event+'="onWeekTouch'));
});

test('bottom management actions bring their forms into view and closing restores the timetable',async()=>{
 const {p}=await setup();
 const scroll=p.data.scrollTarget;p.addCourse();assert.equal(p.data.courseDialog,'edit');assert.equal(p.data.scrollTarget,scroll);
 p.closeCourseDialog();assert.equal(p.data.courseDialog,'');assert.equal(p.data.scrollTarget,scroll);
 p.openImport();assert.equal(p.data.panel,'import');assert.equal(p.data.scrollTarget,scroll);
 p.closePanel();const id=p.data.term.courses[0].id;p.editById(id);assert.equal(p.data.courseDialog,'edit');
 p.onUnload();
});
