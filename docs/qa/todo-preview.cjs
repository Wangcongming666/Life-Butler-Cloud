/* Browser layout surrogate using the actual WXML/WXSS; not a native WeChat render. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/76004/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),mini=path.join(root,'miniprogram');
const source=fs.readFileSync(path.join(mini,'pages/todo/index.wxml'),'utf8');
const styles=fs.readFileSync(path.join(mini,'app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(mini,'pages/todo/index.wxss'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const width of [320,390,960]){
  const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
  const css=styles.replace(/(-?[\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/\bscroll-view\b/g,'section').replace(/\bview\b/g,'div').replace(/\btext\b(?=\s*[,\{])/g,'span');
  await page.setContent('<meta charset="utf-8"><style>html,body{margin:0}button{font-family:inherit;border:0}button:not([size=mini]){width:100%;margin-left:auto;margin-right:auto}section{display:block;overflow:auto}'+css+'</style><main id="preview"></main>');
  await page.evaluate(({source})=>{
   const mockImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#e1eee8"/><path d="M72 112V58M72 85Q22 75 34 38Q75 38 72 85M72 75Q110 72 114 32Q71 30 72 75" fill="#7b9e89" stroke="#4c7c6d" stroke-width="3"/></svg>');
   const context={appearanceClass:'',cloudReady:true,cloudStatus:'synced',cloudMessage:'已同步',pending:1,alerts:[],formVisible:false,query:'',filters:['全部','未完成','已完成'],filter:0,sorts:['截止时间从早到晚','截止时间从晚到早'],sort:0,togglingId:'',todos:[{id:'a',title:'浇花',done:false,overdue:true,dueText:'2026-10-19 18:32',images:[mockImage]},{id:'b',title:'整理本周的学习资料和工作记录，再把需要备份的照片分类保存，检查长标题在手机与电脑上的换行是否自然',done:true,overdue:false,dueText:'2026-10-20 09:00',images:[mockImage,mockImage,mockImage]}]};
   Object.assign(context,{filter:1,completed:1,scrollTarget:'',saving:false,choosing:false,rangeVisible:false,rangeActive:false,rangeStartDate:'2026-10-19',rangeStartTime:'19:30',rangeEndDate:'2026-10-20',rangeEndTime:'00:00',rangeError:'',rangeLabel:'不限时间'});
   const template=document.createElement('template');template.innerHTML=source.replace(/<checkbox\b([^>]*?)\/>/g,'<input type="checkbox"$1>');
   const evaluate=(expr,ctx)=>Function('ctx','with(ctx){return ('+expr+');}')(ctx);
   const value=(raw,ctx)=>raw.replace(/\{\{([\s\S]*?)\}\}/g,(_,e)=>String(evaluate(e,ctx)));
   function render(node,ctx){
    if(node.nodeType===3)return document.createTextNode(value(node.textContent,ctx));
    if(node.nodeType!==1)return document.createTextNode('');
    const condition=node.getAttribute('wx:if');if(condition&&!evaluate(condition.slice(2,-2),ctx))return document.createTextNode('');
    const loop=node.getAttribute('wx:for');if(loop){const list=evaluate(loop.slice(2,-2),ctx),fragment=document.createDocumentFragment();list.forEach((item,index)=>{const copy=node.cloneNode(true);copy.removeAttribute('wx:for');fragment.append(render(copy,{...ctx,[node.getAttribute('wx:for-item')||'item']:item,[node.getAttribute('wx:for-index')||'index']:index}));});return fragment;}
    const map={view:'div',text:'span',image:'img','scroll-view':'section',picker:'div','checkbox-group':'div',checkbox:'input'};
    const target=document.createElement(map[node.tagName.toLowerCase()]||node.tagName.toLowerCase());
    if(node.tagName.toLowerCase()==='checkbox')target.setAttribute('type','checkbox');
    for(const attr of node.attributes){if(attr.name.startsWith('wx:')||/^(bind|catch)/.test(attr.name))continue;const resolved=value(attr.value,ctx);if(['disabled','checked'].includes(attr.name)&&resolved==='false')continue;target.setAttribute(attr.name,resolved);}
    node.childNodes.forEach(child=>target.append(render(child,ctx)));return target;
   }
   const preview=document.querySelector('#preview');function draw(){preview.replaceChildren();template.content.childNodes.forEach(n=>preview.append(render(n,context)));}draw();window.showRangePreview=()=>{context.rangeVisible=true;draw();};
  },{source});
  await page.locator('.todo-card').last().waitFor();
  // Mimic native mini-button rules that a plain browser does not supply.
  await page.addStyleTag({content:'button[size=mini]{display:inline-block;line-height:2.3;vertical-align:middle}'});
  const measurements=await page.locator('.todo-card').evaluateAll(cards=>cards.map(card=>{
   const bounds=card.getBoundingClientRect(),title=card.querySelector('.todo-title').getBoundingClientRect(),check=card.querySelector('.check-target').getBoundingClientRect(),buttons=[...card.querySelectorAll('.todo-action')].map(b=>b.getBoundingClientRect());
   return {card:{left:bounds.left,right:bounds.right},titleLeft:title.left,checkRight:check.right,buttons:buttons.map(b=>({left:b.left,right:b.right,width:b.width,height:b.height})),overflow:card.scrollWidth>card.clientWidth+1};
  }));
  for(const result of measurements){assert.equal(result.overflow,false,'card overflow at '+width);assert.ok(result.titleLeft-result.checkRight<=9,'title detached from checkbox at '+width);for(const b of result.buttons){assert.ok(b.right<=result.card.right+1&&b.left>=result.card.left,'button outside card at '+width);assert.ok(b.height>=44,'tap target too small');}}
  await page.locator('.todo-card').first().screenshot({path:path.join(__dirname,'todo-'+width+'.png')});
  const controls=await page.locator('.controls').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,targets:[...n.querySelectorAll('.range-value,.range-action')].map(t=>{const r=t.getBoundingClientRect(),parent=n.getBoundingClientRect();return {height:r.height,inside:r.left>=parent.left&&r.right<=parent.right};})}));
  assert.equal(controls.overflow,false);for(const t of controls.targets){assert.ok(t.height>=44);assert.ok(t.inside);}
  const filterLayout=await page.locator('.todo-filter-row').evaluate(n=>{
   const trigger=n.querySelector('.range-trigger').getBoundingClientRect(),toggle=n.querySelector('.range-checkbox').getBoundingClientRect(),sort=n.lastElementChild.getBoundingClientRect();
   const box=n.querySelector('.range-checkbox-box').getBoundingClientRect(),label=n.querySelector('.range-trigger-label').getBoundingClientRect();
   return {centerDifference:Math.abs((box.top+box.bottom-label.top-label.bottom)/2),before:toggle.right<=trigger.left+1,touch:toggle.width>=44&&toggle.height>=44,sameLine:Math.abs(toggle.top-trigger.top)<1,sortSameLine:Math.abs(sort.top-trigger.top)<1,overflow:n.scrollWidth>n.clientWidth+1};
  });
  assert.equal(filterLayout.before,true);assert.equal(filterLayout.touch,true);assert.equal(filterLayout.sameLine,true);assert.equal(filterLayout.sortSameLine,true);assert.equal(filterLayout.overflow,false);
  assert.ok(filterLayout.centerDifference<=0.5,'checkbox and text centers differ by '+filterLayout.centerDifference+'px at '+width);
  await page.locator('.controls').screenshot({path:path.join(__dirname,'todo-range-'+width+'.png')});
  assert.equal(await page.locator('.controls .range-endpoint').count(),0);assert.equal(await page.locator('.range-sheet').count(),0);
  await page.evaluate(()=>window.showRangePreview());
  const sheet=await page.locator('.range-sheet').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:n.scrollWidth>n.clientWidth+1,targets:[...n.querySelectorAll('.range-value,.range-action,.filter-control')].map(t=>t.getBoundingClientRect().height)};});
  assert.ok(sheet.left>=0&&sheet.right<=width+1&&sheet.bottom<=1001);assert.equal(sheet.overflow,false);assert.ok(sheet.targets.every(h=>h>=44));
  await page.locator('.range-sheet').screenshot({path:path.join(__dirname,'todo-range-panel-'+width+'.png')});
  if(width===390){await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.screen').evaluate(el=>el.classList.add('theme-dark','font-large'));await page.locator('.todo-card').first().screenshot({path:path.join(__dirname,'todo-dark-large.png')});}
  console.log('PASS browser layout surrogate '+width+'px: no card/button overflow, 44px touch targets, adjacent title');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
