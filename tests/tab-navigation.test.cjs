const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const mini=path.resolve(__dirname,'../miniprogram');
function setup(){
 const requests=[],errors=[];
 const {createNavigation}=require('../miniprogram/utils/tab-navigation');
 const nav=createNavigation({switchTab:options=>requests.push(options),onError:()=>errors.push('failed')});
 nav.enter(0);nav.ready(0);
 return {nav,requests,errors};
}
test('rapid taps preserve the latest tab across native switch and intermediate page rendering',()=>{
 const {nav,requests}=setup();
 nav.request(1);nav.request(2);
 assert.equal(requests.length,1,'never race native switch requests');
 assert.equal(nav.getState().selected,2);
 assert.equal(nav.getState().loading,true);
 assert.equal(nav.getState().label,'工具');
 nav.enter(1);nav.ready(1);
 assert.equal(nav.getState().selected,2,'intermediate page must not overwrite latest highlight');
 assert.equal(nav.getState().loading,true,'intermediate content stays covered');
 requests[0].success();requests[0].complete();
 assert.equal(requests.length,2);
 assert.equal(requests[1].url,'/pages/tools/index');
 nav.enter(2);requests[1].success();requests[1].complete();
 assert.equal(nav.getState().loading,true,'wait for rendered content, not switch completion');
 nav.ready(1);
 assert.equal(nav.getState().loading,true,'stale page completion is ignored');
 nav.ready(2);
 assert.equal(nav.getState().loading,false);
 assert.equal(nav.getState().selected,2);
});
test('many taps skip obsolete destinations, including a return to the original tab',()=>{
 const {nav,requests}=setup();nav.request(1);nav.request(2);nav.request(3);nav.request(0);
 nav.enter(1);requests[0].success();requests[0].complete();
 assert.equal(requests.length,2);assert.equal(requests[1].url,'/pages/todo/index');
 nav.enter(0);nav.ready(0);requests[1].success();requests[1].complete();
 assert.equal(nav.getState().selected,0);assert.equal(nav.getState().loading,false);
});
test('a failed older switch still advances to the newest destination',()=>{
 const {nav,requests,errors}=setup();nav.request(1);nav.request(2);
 requests[0].fail();requests[0].complete();
 assert.equal(errors.length,0);assert.equal(requests[1].url,'/pages/tools/index');
 requests[1].fail();requests[1].complete();
 assert.equal(errors.length,1);assert.equal(nav.getState().selected,0);assert.equal(nav.getState().loading,false);
 nav.request(3);assert.equal(requests.length,3,'failure must not permanently lock navigation');
});
test('all mounted tab bars receive the same latest intent and new instances receive it immediately',()=>{
 const {nav,requests}=setup(),a=[],b=[];
 const off=nav.subscribe(state=>a.push(state));nav.request(1);
 nav.subscribe(state=>b.push(state));assert.equal(b.at(-1).selected,1);
 off();nav.request(2);assert.equal(a.at(-1).selected,1);assert.equal(b.at(-1).selected,2);
 nav.request(2);assert.equal(requests.length,1,'duplicate taps do not enqueue duplicate native requests');
});
test('navigation loading covers old content without disabling the tab buttons',()=>{
 const markup=fs.readFileSync(path.join(mini,'custom-tab-bar/index.wxml'),'utf8');
 assert.match(markup,/wx:if="\{\{navigationLoading\}\}"/);
 assert.match(markup,/正在打开/);
 assert.doesNotMatch(markup,/disabled="\{\{(?:busy|navigationLoading)\}\}"/);
});
