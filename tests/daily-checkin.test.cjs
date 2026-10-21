const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
const checkin=require('../miniprogram/utils/checkin'),schema=require('../miniprogram/utils/data-schema'),model=require('../miniprogram/utils/record-model');
const at=s=>new Date(s+'T12:00:00').getTime(),rows=dates=>dates.map(date=>({id:date,date,createdAt:at(date)}));
test('streak uses calendar days across month/year, breaks on missed days and deduplicates dates',()=>{
 let r=checkin.stats(rows(['2025-12-30','2025-12-31','2026-01-01','2026-01-01']),at('2026-01-01'));assert.equal(r.streak,3);assert.equal(r.longest,3);assert.equal(r.total,3);assert.equal(r.signedToday,true);
 r=checkin.stats(rows(['2026-02-27','2026-02-28','2026-03-01']),at('2026-03-02'));assert.equal(r.streak,3);assert.equal(r.signedToday,false);
 r=checkin.stats(rows(['2026-01-01','2026-01-02','2026-01-05']),at('2026-01-07'));assert.equal(r.streak,0);assert.equal(r.longest,2);
});
test('calendar marks actual check-ins and handles leap day without recording future days',()=>{
 const calendar=checkin.calendar('2024-02',rows(['2024-02-28','2024-02-29']),at('2024-02-29'));assert.equal(calendar.filter(c=>c.checked).length,2);assert.equal(calendar.filter(c=>!c.blank).length,29);assert.equal(calendar.find(c=>c.date==='2024-02-29').today,true);
});
test('legacy snapshots gain empty sign-ins and signed dates survive cloud model roundtrip',()=>{
 const data=schema.emptyData();delete data.signins;schema.validate(data);assert.deepEqual(data.signins,[]);data.signins=rows(['2026-10-19']);assert.deepEqual(model.hydrate(model.flatten(data)),data);
 data.signins.push({...data.signins[0]});assert.throws(()=>schema.validate(data));
});
test('first daily login creates one cloud record; repeat and parallel calls do not duplicate',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();const results=await Promise.all([c.store.checkInToday(at('2026-10-19')),c.store.checkInToday(at('2026-10-19'))]);assert.equal(c.store.read().signins.length,1);assert.equal(results[0].created,true);assert.equal((await c.store.checkInToday(at('2026-10-19'))).created,false);
 const next=await c.store.checkInToday(at('2026-10-20'));assert.equal(next.streak,2);assert.equal(c.store.read().life.records.length,0);
});
test('two devices signing the same day reconcile to one shared record',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),a=createClient(service),b=createClient(service);await a.sync.start();await b.sync.start();const out=await Promise.all([a.store.checkInToday(at('2026-10-19')),b.store.checkInToday(at('2026-10-19'))]);assert.equal(out.filter(r=>r.created).length,1);await a.sync.pull({force:true});assert.equal(a.store.read().signins.length,1);
});
test('daily welcome shows once after confirmed sign-in and does not show a false success offline',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();const welcome=c.load('utils/login-checkin.js'),shown=[];const off=welcome.subscribe(value=>{if(value)shown.push(value);});await welcome.run();assert.equal(shown.length,1);assert.equal(shown[0].quote.text,'千里之行，始于足下。');welcome.dismiss();await welcome.run();assert.equal(shown.length,1);off();
 const offline=createClient(createService(new MemoryRepository()));await offline.sync.start();offline.offline();await assert.rejects(offline.load('utils/login-checkin.js').run());assert.equal(offline.notices.length,0);
});
test('foreground reconnect triggers automatic sign-in after an initial offline launch',async()=>{
 const c=createClient(createService(new MemoryRepository())),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let app;
 const shown=[];c.load('utils/login-checkin.js').subscribe(value=>{if(value)shown.push(value);});c.offline();vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/app.js'),'utf8'),{App:value=>app=value,require:id=>c.load(id.replace('./','')+'.js'),console:{error(){}},setInterval:()=>1,clearInterval(){}});
 app.onShow();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));assert.equal(c.notices.length,0);
 c.offline(false);await c.sync.pull({force:true});for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));assert.equal(c.store.read().signins.length,1);assert.equal(shown.length,1);
 await c.sync.pull({force:true});for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));assert.equal(shown.length,1);app.onHide();
});
test('welcome waits for component attachment and dismisses across pages without repeating',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();const welcome=c.load('utils/login-checkin.js');await welcome.run();
 const pageA=[],pageB=[];const offA=welcome.subscribe(value=>pageA.push(value)),offB=welcome.subscribe(value=>pageB.push(value));assert.equal(pageA[0].streak,1);assert.equal(pageB[0].streak,1);
 welcome.dismiss();assert.equal(pageA.at(-1),null);assert.equal(pageB.at(-1),null);await welcome.run();assert.equal(pageA.length,2);assert.equal(pageB.length,2);offA();offB();
});