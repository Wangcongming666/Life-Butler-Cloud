const sync=require('./sync'),appearance=require('./appearance');
const labels={loading:'正在加载云端数据',syncing:'正在同步',synced:'已同步',error:'同步失败'};
const editMethods={todo:{openEdit:'todos'},account:{openEdit:'expenses'},notes:{openEdit:'notes'},schedule:{editById:'courses',editExam:'exams',openSettings:'term'},life:{edit:'lifeRecords',onBudget:'budgets'},loans:{edit:'loans'},food:{edit:'recipes',openMeal:'meals'}};
function definePage(config){
 const show=config.onShow,hide=config.onHide,unload=config.onUnload,load=config.onLoad;
 config.onLoad=function(options){
  this._cloudLoadOptions=options||{};this._cloudEditTokens={};const originalSetData=this.setData.bind(this);
  this.setData=(patch,callback)=>{
   const closed=patch.formVisible===false||patch.examFormVisible===false||patch.mealVisible===false||patch.panel===''||patch.editingId===''||patch.editId===''||(patch.draft&&patch.draft.id==='');
   if(closed){sync.getDefault().endEdit(this._cloudEditTokens);this._cloudEditTokens={};}
   return originalSetData(patch,callback);
  };
 };
 config.data={...config.data,cloudReady:false,cloudStatus:'loading',cloudMessage:labels.loading,cloudLastSync:''};
 config.onShow=async function(){
  const token={};this._cloudShowToken=token;this._cloudVisible=true;
  const current=()=>this._cloudVisible&&this._cloudShowToken===token;
  const service=sync.getDefault();service.restoreEdit(this._cloudEditTokens);
  // 导航状态属于当前页面，不等待云端请求或业务数据加载。
  const tabIndex=['pages/todo/index','pages/account/index','pages/tools/index','pages/profile/index'].indexOf(this.route);
  const tabNavigation=tabIndex>=0?require('./tab-navigation').getDefault():null;
  if(tabNavigation)tabNavigation.enter(tabIndex);
  if(tabIndex>=0)require('./navigation').syncTab(this,tabIndex);
  let shown=false,activation=null;
  const activate=()=>{
   if(!current()||!service.getState().ready)return Promise.resolve();
   if(activation)return activation;
   activation=(async()=>{
    if(!this._cloudLoaded){
     if(!this._cloudLoadTask)this._cloudLoadTask=(async()=>{if(load)await load.call(this,this._cloudLoadOptions||{});this._cloudLoaded=true;})();
     await this._cloudLoadTask;
    }
    if(!current())return;
    shown=true;this._cloudRevisionTime=service.getState().lastSyncedAt;
    appearance.apply(this);if(show)await show.call(this);
    if(current()&&tabNavigation)await new Promise(resolve=>this.setData({cloudReady:true},()=>{
     if(current())tabNavigation.ready(tabIndex);resolve();
    }));
   })();
   // 激活可由订阅触发；统一在 onShow 尾部等待，避免悬空拒绝。
   activation.catch(()=>{if(current()&&tabNavigation)tabNavigation.ready(tabIndex);});return activation;
  };
  const update=state=>{
   if(!current())return;
   const values={cloudReady:state.ready,cloudStatus:state.status,cloudMessage:state.error||labels[state.status],cloudLastSync:state.lastSyncedAt?new Date(state.lastSyncedAt).toLocaleTimeString():''};
   const patch={};Object.keys(values).forEach(key=>{if(this.data[key]!==values[key])patch[key]=values[key];});
   if(Object.keys(patch).length)this.setData(patch);
   if(state.ready&&!shown){activate();return;}
   if(state.ready&&state.lastSyncedAt!==this._cloudRevisionTime){this._cloudRevisionTime=state.lastSyncedAt;appearance.apply(this);if(this.refresh)this.refresh();else if(this.search&&this.data.query)this.search();}
  };
  if(this._cloudOff)this._cloudOff();this._cloudOff=service.subscribe(update);update(service.getState());
  // 已确认的内存快照立即展示；后台先检查版本，未变化时不下载完整数据。
  try{await service.pull();}catch(e){if(!current())return;if(!service.getState().ready){if(tabNavigation)this.setData({cloudReady:false},()=>{if(current())tabNavigation.ready(tabIndex);});wx.showModal({title:'云端尚未连接',content:e.message,showCancel:false});return;}}
  if(!current())return;await activate();if(current())update(service.getState());
 };
 config.onHide=function(){this._cloudVisible=false;this._cloudShowToken=null;if(this._cloudOff)this._cloudOff();this._cloudOff=null;if(hide)hide.call(this);};
 config.onUnload=function(){this._cloudVisible=false;this._cloudShowToken=null;if(this._cloudOff)this._cloudOff();this._cloudOff=null;if(unload)unload.call(this);};
 config.syncNow=async function(){try{await sync.getDefault().pull({force:true});wx.showToast({title:'同步完成',icon:'success'});}catch(e){wx.showModal({title:'同步未完成',content:e.message,showCancel:false});}};
 const routeKinds={};Object.values(editMethods).forEach(methods=>Object.keys(methods).forEach(name=>{routeKinds[name]=true;}));
 Object.keys(config).forEach(name=>{
  const fn=config[name];if(typeof fn!=='function'||/^on(?:Load|Show|Hide|Unload)$/.test(name))return;
  if(routeKinds[name])config[name]=function(event){
   const page=(this.route||'').split('/')[1],kind=editMethods[page]&&editMethods[page][name];const ds=event&&event.currentTarget&&event.currentTarget.dataset||{};
   let id=typeof event==='string'?event:ds.id;
   if(kind==='meals'){const date=ds.date||new Date().toLocaleDateString('en-CA'),slot=ds.slot||'dinner';const meal=sync.getDefault().read().library.meals.find(m=>m.date===date&&m.slot===slot);if(meal)id=meal.id;}
   if(kind==='budgets'){if(!this._budgetDirty){id=this.data.month;this._budgetDirty=true;}else id=null;}
   if(kind==='term')id='singleton';
   if(kind&&id){const token=sync.getDefault().beginEdit(kind,id);this._cloudEditTokens=this._cloudEditTokens||{};this._cloudEditTokens[kind+':'+id]=token;}
   return fn.call(this,event);
  };
  if(/await store\./.test(fn.toString())&&name!=='refresh'){
   const previous=config[name];config[name]=async function(...args){if(this._cloudActionBusy)return;this._cloudActionBusy=true;try{return await previous.apply(this,args);}finally{this._cloudActionBusy=false;}};
  }
 });Page(config);
}
module.exports={definePage};
