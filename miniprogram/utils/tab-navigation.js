/** 跨 Tab 页共享最后一次点击意图；原生切换串行执行，内容就绪后才撤下过渡层。 */
const PATHS=['/pages/todo/index','/pages/account/index','/pages/tools/index','/pages/profile/index'];
const LABELS=['待办','记账','工具','我的'];
function createNavigation(options){
 const listeners=new Set(),rendered=[false,false,false,false];
 let current=-1,target=null,flight=null;
 const valid=index=>Number.isInteger(index)&&index>=0&&index<PATHS.length;
 function getState(){
  const selected=target===null?current:target;
  return {selected,loading:selected>=0&&(!!flight||current!==selected||!rendered[selected]),label:LABELS[selected]||''};
 }
 function emit(){const state=getState();listeners.forEach(fn=>fn(state));}
 function pump(){
  if(flight||target===null)return;
  if(current===target){if(rendered[current]){target=null;emit();}return;}
  const job={index:target,failed:false};flight=job;rendered[job.index]=false;emit();
  const request={
   url:PATHS[job.index],
   success(){if(flight===job&&!job.failed){current=job.index;emit();}},
   fail(){
    if(flight!==job)return;job.failed=true;
    if(target===job.index&&options.onError)options.onError();
   },
   complete(){
    if(flight!==job)return;flight=null;
    if(job.failed&&target===job.index)target=null;
    emit();pump();
   }
  };
  try{options.switchTab(request);}catch(error){request.fail();request.complete();}
 }
 return {
  getState,
  request(index){if(!valid(index))return;target=index;emit();pump();},
  enter(index){if(!valid(index))return;current=index;rendered[index]=false;emit();},
  ready(index){if(!valid(index)||current!==index)return;rendered[index]=true;emit();pump();},
  subscribe(fn){listeners.add(fn);fn(getState());return()=>listeners.delete(fn);}
 };
}
let singleton;
function getDefault(){
 if(!singleton)singleton=createNavigation({switchTab:options=>wx.switchTab(options),onError:()=>wx.showToast({title:'切换失败，请重试',icon:'none'})});
 return singleton;
}
module.exports={createNavigation,getDefault};
