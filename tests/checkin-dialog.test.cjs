const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('dialog exposes quote and source separately and responds to global dismissal',()=>{
 let component,listener,disposed=false;const welcome={subscribe(fn){listener=fn;fn(null);return()=>disposed=true;},dismiss(){listener(null);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/daily-checkin-dialog/index.js'),'utf8'),{Component:value=>component=value,require:id=>id.endsWith('login-checkin')?welcome:{read:()=>({preferences:{theme:'mint',dark:false,font:'normal'}})}});
 const instance={data:{},setData(patch){Object.assign(this.data,patch);}};component.lifetimes.attached.call(instance);assert.equal(instance.data.visible,false);
 listener({streak:3,quote:{text:'千里之行，始于足下。',source:'《道德经》'}});assert.equal(instance.data.visible,true);assert.equal(instance.data.streak,3);assert.equal(instance.data.quote.source,'《道德经》');
 component.methods.dismiss.call(instance);assert.equal(instance.data.visible,false);component.lifetimes.detached.call(instance);assert.equal(disposed,true);
});