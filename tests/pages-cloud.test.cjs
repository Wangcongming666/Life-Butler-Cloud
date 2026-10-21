const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('account waits for cloud confirmation, keeps form on failure',async()=>{
 let page,resolveSave,rejectSave;const notices=[];
 const store={dateText:()=> '2026-10-19',timeText:()=> '12:00',addExpense:()=>new Promise((r,j)=>{resolveSave=r;rejectSave=j;})};
 const ui={attempt:async fn=>{try{return await fn();}catch(e){notices.push(e.message);}}};
 const pageSync={definePage:p=>{page=p;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/account/index.js'),'utf8'),{Page:p=>page=p,require:id=>id.endsWith('/storage')?store:id.endsWith('/ui')?ui:id.endsWith('/page-sync')?pageSync:{syncTab(){},takeSearch(){},apply(){}},wx:{showToast:o=>notices.push(o.title)},Date});
 page.data={...page.data,amount:'10',category:'餐饮',note:'原输入',editingId:'',date:'2026-10-19',time:'12:00'};page.setData=p=>Object.assign(page.data,p);page.selectedTime=()=>0;page.inputTime=()=>0;page.refresh=()=>{};
 const saving=page.save();await new Promise(r=>setImmediate(r));assert.equal(page.data.note,'原输入');assert.equal(notices.includes('已保存'),false);rejectSave(Error('断网'));await saving;assert.equal(page.data.note,'原输入');
});
