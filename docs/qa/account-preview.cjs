/* Actual WXML/WXSS in a browser surrogate; native WeChat still needs device QA. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/76004/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {createClient}=require('../../tests/helpers/client.cjs');
const {createService}=require('../../cloudfunctions/lifeButler/service');
const {MemoryRepository}=require('../../tests/helpers/memory-cloud.cjs');
(async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();const data=c.store.read();
 data.expenses=Array.from({length:24},(_,i)=>({id:'bill'+i,category:i%2?'餐饮':'交通',note:'一笔日常支出',amountCents:100+i,createdAt:new Date(2024,1,29,12,i).getTime()}));c.store.read=()=>data;
 const p=c.page('account');p.onLoad({});await p.onShow();
 const base=path.resolve(__dirname,'../../miniprogram'),source=fs.readFileSync(path.join(base,'pages/account/index.wxml'),'utf8'),styles=fs.readFileSync(path.join(base,'app.wxss'),'utf8')+fs.readFileSync(path.join(base,'pages/account/index.wxss'),'utf8');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const width of [320,390,960]){for(const state of ['all','month','empty-dark']){
  await p.onScope({detail:{value:true}});if(state!=='all')await p.onMonth({detail:{value:state==='month'?'2024-02':'2023-12'}});
  const context=structuredClone(p.data);context.appearanceClass=state==='empty-dark'?'theme-dark font-large':'';
  const page=await browser.newPage({viewport:{width,height:1000}});
  const css=styles.replace(/(-?[\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/\bscroll-view\b/g,'section').replace(/\bview\b/g,'div').replace(/\btext\b(?=\s*[,\{])/g,'span');
  await page.setContent('<meta charset="utf-8"><style>html,body{margin:0}button{font-family:inherit;border:0}button:not([size=mini]){width:100%;margin-left:auto;margin-right:auto}section{display:block;overflow:auto}block{display:contents}'+css+'</style><main></main>');
  await page.evaluate(({source,context})=>{
   const template=document.createElement('template');template.innerHTML=source;
   const evaluate=(expr,ctx)=>Function('ctx','with(ctx){return ('+expr+');}')(ctx),value=(raw,ctx)=>raw.replace(/\{\{([\s\S]*?)\}\}/g,(_,e)=>String(evaluate(e,ctx)));
   function render(node,ctx){
    if(node.nodeType===3)return document.createTextNode(value(node.textContent,ctx));if(node.nodeType!==1)return document.createTextNode('');
    const cond=node.getAttribute('wx:if');if(cond&&!evaluate(cond.slice(2,-2),ctx))return document.createTextNode('');
    const loop=node.getAttribute('wx:for');if(loop){const fragment=document.createDocumentFragment();evaluate(loop.slice(2,-2),ctx).forEach((item,index)=>{const copy=node.cloneNode(true);copy.removeAttribute('wx:for');fragment.append(render(copy,{...ctx,item,index}));});return fragment;}
    const map={view:'div',text:'span','scroll-view':'section',picker:'div'},target=document.createElement(map[node.tagName.toLowerCase()]||node.tagName.toLowerCase());
    for(const attr of node.attributes){if(attr.name.startsWith('wx:')||/^(bind|catch)/.test(attr.name))continue;target.setAttribute(attr.name,value(attr.value,ctx));}node.childNodes.forEach(n=>target.append(render(n,ctx)));return target;
   }
   template.content.childNodes.forEach(n=>document.querySelector('main').append(render(n,context)));
  },{source,context});
  for(const selector of ['.account-summary','.billing-statistics','.billing-pagination','.list-heading']){
   const found=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({overflow:n.scrollWidth>n.clientWidth+1,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
   for(const bounds of found){assert.equal(bounds.overflow,false,selector+' overflow '+width);assert.ok(bounds.left>=0&&bounds.right<=width+1,selector+' outside viewport');}
  }
  assert.ok(await page.locator('.month-picker').evaluate(n=>n.getBoundingClientRect().height)>=44);
  await page.screenshot({path:path.join(__dirname,'account-'+width+'-'+state+'.png')});await page.close();console.log('PASS '+width+'px '+state);
 }} }finally{await browser.close();p.onUnload();}
})().catch(e=>{console.error(e);process.exitCode=1;});
