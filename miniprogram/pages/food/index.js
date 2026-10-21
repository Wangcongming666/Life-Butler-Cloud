const cloudMedia=require('../../utils/media');
const store=require('../../utils/storage');const journal=require('../../utils/journal');const {attempt}=require('../../utils/ui');const appearance=require('../../utils/appearance');
function recipe(){return{id:'',title:'',category:'家常菜',servings:'2',ingredientsText:'',steps:'',note:'',images:[]};}
require('../../utils/page-sync').definePage({
  data:{section:'recipes',recipes:[],query:'',formVisible:false,detailVisible:false,detail:{},formError:'',draft:{},busy:false,scrollTarget:'',weekDate:journal.dayText(),weekRange:'',days:[],mealVisible:false,mealError:'',meal:{},recipeNames:['自由填写餐食'],recipeIndex:0,slots:['早餐','午餐','晚餐'],slotIndex:0},
  onLoad(o){this._id=o&&o.id;if(o&&o.date)this.setData({section:'plan',weekDate:o.date});},
  onShow(){appearance.apply(this);this.refresh();if(this._id){const id=this._id;this._id='';this.edit({currentTarget:{dataset:{id}}});}},
  refresh(){return attempt(async () =>{const data=store.read(),q=this.data.query.trim().toLowerCase(),range=journal.period('week',this.data.weekDate),days=[];
    for(let n=0;n<7;n++){const date=new Date(journal.date(range.start)+n*86400000).toISOString().slice(0,10);days.push({date,label:'周'+'一二三四五六日'[n],slots:journal.SLOTS.map(slot=>{const m=data.library.meals.find(m=>m.date===date&&m.slot===slot);return{slot,name:journal.SLOT_NAMES[slot],id:m?m.id:'',title:m?m.title:'还没安排',note:m?m.note:''};})});}
    this._allRecipes=data.library.recipes;this.setData({recipes:data.library.recipes.filter(r=>!q||(r.title+r.category+r.note+r.ingredients.map(i=>i.name).join(' ')).toLowerCase().includes(q)).sort((a,b)=>b.updatedAt-a.updatedAt),recipeNames:['自由填写餐食'].concat(data.library.recipes.map(r=>r.title)),weekRange:range.start+' ～ '+range.end,days});});},
  switchSection(e){if(!this.data.busy)this.setData({section:e.currentTarget.dataset.section});},
  onQuery(e){this.setData({query:e.detail.value});this.refresh();},
  stopTouch(){},
  showDetail(e){if(this.data.busy)return;const r=this.data.recipes.find(r=>r.id===e.currentTarget.dataset.id);if(r)this.setData({detail:r,detailVisible:true});},
  closeDetail(){if(!this.data.busy)this.setData({detailVisible:false});},
  add(){if(!this.data.busy)this.setData({draft:recipe(),detailVisible:false,formError:'',formVisible:true,scrollTarget:''});},
  edit(e){if(this.data.busy)return;attempt(async () =>{const r=store.read().library.recipes.find(r=>r.id===e.currentTarget.dataset.id);if(!r)throw Error('菜谱已不存在');this.setData({section:'recipes',detailVisible:false,formError:'',formVisible:true,scrollTarget:'',draft:Object.assign({},r,{images:r.images.slice(),ingredientsText:r.ingredients.map(i=>i.name+(i.quantity?' '+i.quantity:'')).join('\n')})});});},
  onField(e){const key=e.currentTarget.dataset.key;if(!this.data.busy&&['title','category','servings','ingredientsText','steps','note'].includes(key))this.setData({draft:Object.assign({},this.data.draft,{[key]:e.detail.value})});},
  onPhotos(e){this.setData({draft:Object.assign({},this.data.draft,{images:e.detail.images})});},onBusy(e){this.setData({busy:e.detail.value});},
  close(){if(this.data.busy)return;wx.showModal({title:'放弃本次编辑？',content:'未保存的修改将丢失。',success: async r =>{if(r.confirm&&!this.data.busy)this.setData({formVisible:false,scrollTarget:''});}});},
  async save(){if(this.data.busy)return;this.setData({busy:true,formError:''});try{await store.saveLibraryRecord('recipes',Object.assign({},this.data.draft,{ingredients:journal.parseIngredients(this.data.draft.ingredientsText)}));this.setData({formVisible:false,scrollTarget:''});this.refresh();wx.showToast({title:'菜谱已保存',icon:'success'});}catch(e){this.setData({formError:e.message||'保存失败，请重试'});}finally{this.setData({busy:false});}},
  async remove(e){if(this.data.busy)return;wx.showModal({title:'删除这份菜谱？',content:'饮食安排会保留餐名；菜谱照片将按引用情况清理。',success: async r =>{if(r.confirm&&!this.data.busy)attempt(async () =>{await store.removeLibraryRecord('recipes',e.currentTarget.dataset.id);this.refresh();});}});},
  async shopping(e){if(!this.data.busy)attempt(async () =>{const n=await store.recipeToShopping(e.currentTarget.dataset.id);wx.showToast({title:n?'已加入'+n+'项食材':'食材已在待购清单',icon:'none'});});},
  preview(e){const r=this.data.recipes.find(r=>r.id===e.currentTarget.dataset.id);if(r&&r.images.length)cloudMedia.preview({urls:r.images,current:r.images[0]});},
  onWeek(e){return attempt(async () =>{journal.date(e.detail.value);this.setData({weekDate:e.detail.value});this.refresh();});},
  shiftWeek(e){const t=journal.date(this.data.weekDate)+Number(e.currentTarget.dataset.step)*7*86400000;this.setData({weekDate:new Date(t).toISOString().slice(0,10)});this.refresh();},
  openMeal(e){if(this.data.busy)return;return attempt(async () =>{const ds=e.currentTarget.dataset,date=ds.date||journal.dayText(),slot=ds.slot||'dinner',existing=store.read().library.meals.find(m=>m.date===date&&m.slot===slot),recipeId=ds.recipe||existing&&existing.recipeId||'',index=(this._allRecipes||[]).findIndex(r=>r.id===recipeId);
    this.setData({section:'plan',detailVisible:false,mealError:'',mealVisible:true,scrollTarget:'',recipeIndex:index+1,slotIndex:journal.SLOTS.indexOf(slot),meal:{id:existing?existing.id:'',date,slot,recipeId:index>=0?recipeId:'',title:existing?existing.title:'',note:existing?existing.note:''}});});},
  onMeal(e){if(this.data.busy)return;const key=e.currentTarget.dataset.key;if(['date','title','note'].includes(key))this.setData({meal:Object.assign({},this.data.meal,{[key]:e.detail.value})});},
  onSlot(e){if(this.data.busy)return;const index=Number(e.detail.value);this.setData({slotIndex:index,meal:Object.assign({},this.data.meal,{slot:journal.SLOTS[index]})});},
  onRecipe(e){if(this.data.busy)return;const index=Number(e.detail.value),r=(this._allRecipes||[])[index-1];this.setData({recipeIndex:index,meal:Object.assign({},this.data.meal,{recipeId:r?r.id:'',title:r?r.title:this.data.meal.title})});},
  async saveMeal(){if(this.data.busy)return;this.setData({busy:true,mealError:''});try{await store.saveMeal(this.data.meal);this.setData({mealVisible:false,scrollTarget:'',weekDate:this.data.meal.date});this.refresh();wx.showToast({title:'安排已保存',icon:'success'});}catch(e){this.setData({mealError:e.message||'保存失败，请重试'});}finally{this.setData({busy:false});}},
  closeMeal(){if(this.data.busy)return;wx.showModal({title:'放弃本次编辑？',content:'未保存的修改将丢失。',success:r=>{if(r.confirm&&!this.data.busy)this.setData({mealVisible:false,scrollTarget:''});}});},
  async removeMeal(e){wx.showModal({title:'移除这餐安排？',content:'菜谱会保留。',success: async r =>{if(r.confirm)attempt(async () =>{await store.removeMeal(e.currentTarget.dataset.id);this.refresh();});}});}
});
