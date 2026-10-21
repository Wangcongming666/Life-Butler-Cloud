const cloudMedia=require('../../utils/media');
const store=require('../../utils/storage');
const journal=require('../../utils/journal');
const {attempt}=require('../../utils/ui');
const appearance=require('../../utils/appearance');
function blank(){return{id:'',title:'',person:'',direction:'out',borrowDate:journal.dayText(),dueDate:'',note:'',images:[]};}
require('../../utils/page-sync').definePage({
  data:{records:[],query:'',filter:0,filters:['未归还','已归还','全部'],directions:['借出给别人','向别人借入'],directionIndex:0,draft:{},formVisible:false,detailVisible:false,detail:{},formError:'',busy:false,scrollTarget:''},
  onLoad(o){this._id=o&&o.id;},
  onShow(){appearance.apply(this);this.refresh();if(this._id){const id=this._id;this._id='';this.edit({currentTarget:{dataset:{id}}});}},
  refresh(){return attempt(async () =>{const q=this.data.query.trim().toLowerCase();this.setData({records:store.read().library.loans.filter(r=>(!q||(r.title+r.person+r.note).toLowerCase().includes(q))&&(this.data.filter===2||(this.data.filter===1?r.returnedAt!==null:r.returnedAt===null))).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||b.updatedAt-a.updatedAt).map(r=>Object.assign({},r,{directionText:r.direction==='out'?'借出':'借入',status:r.returnedAt!==null?'已归还':r.dueDate&&r.dueDate<journal.dayText()?'已逾期':'未归还',returnedText:r.returnedAt===null?'':store.dateText(r.returnedAt)+' '+store.timeText(r.returnedAt)}))});if(this.data.detailVisible){const detail=this.data.records.find(r=>r.id===this.data.detail.id);this.setData(detail?{detail}:{detailVisible:false});}});},
  stopTouch(){},
  showDetail(e){if(this.data.busy)return;const r=this.data.records.find(r=>r.id===e.currentTarget.dataset.id);if(r)this.setData({detail:r,detailVisible:true});},
  closeDetail(){if(!this.data.busy)this.setData({detailVisible:false});},
  add(){if(!this.data.busy)this.setData({draft:blank(),directionIndex:0,detailVisible:false,formError:'',formVisible:true,scrollTarget:''});},
  edit(e){if(this.data.busy)return;attempt(async () =>{const r=store.read().library.loans.find(r=>r.id===e.currentTarget.dataset.id);if(!r)throw Error('记录已不存在');this.setData({draft:Object.assign({},r,{images:r.images.slice()}),directionIndex:r.direction==='out'?0:1,detailVisible:false,formError:'',formVisible:true,scrollTarget:''});});},
  onField(e){if(this.data.busy)return;const key=e.currentTarget.dataset.key;if(['title','person','borrowDate','dueDate','note'].includes(key))this.setData({draft:Object.assign({},this.data.draft,{[key]:e.detail.value})});},
  onDirection(e){if(!this.data.busy)this.setData({directionIndex:Number(e.detail.value),draft:Object.assign({},this.data.draft,{direction:Number(e.detail.value)===0?'out':'in'})});},
  onPhotos(e){this.setData({draft:Object.assign({},this.data.draft,{images:e.detail.images})});},
  onBusy(e){this.setData({busy:e.detail.value});},
  clearDue(){if(!this.data.busy)this.setData({draft:Object.assign({},this.data.draft,{dueDate:''})});},
  onQuery(e){this.setData({query:e.detail.value});this.refresh();},
  onFilter(e){this.setData({filter:Number(e.detail.value)});this.refresh();},
  close(){if(this.data.busy)return;wx.showModal({title:'放弃本次编辑？',content:'未保存的修改将丢失。',success: async r =>{if(r.confirm&&!this.data.busy)this.setData({formVisible:false,scrollTarget:''});}});},
  async save(){if(this.data.busy)return;this.setData({busy:true,formError:''});try{await store.saveLibraryRecord('loans',this.data.draft);this.setData({formVisible:false,scrollTarget:''});this.refresh();wx.showToast({title:'已保存',icon:'success'});}catch(e){this.setData({formError:e.message||'保存失败，请重试'});}finally{this.setData({busy:false});}},
  async toggle(e){if(this.data.busy)return;const id=e.currentTarget.dataset.id;wx.showModal({title:'切换归还状态？',content:'未归还将标记为已归还；已归还可恢复为未归还。',success: async r =>{if(r.confirm&&!this.data.busy)attempt(async () =>{await store.toggleReturn(id);this.refresh();});}});},
  async remove(e){if(this.data.busy)return;wx.showModal({title:'删除借还记录？',content:'删除后无法撤销。',confirmColor:'#aa5849',success: async r =>{if(r.confirm&&!this.data.busy)attempt(async () =>{await store.removeLibraryRecord('loans',e.currentTarget.dataset.id);this.refresh();});}});},
  preview(e){const r=this.data.records.find(r=>r.id===e.currentTarget.dataset.id);if(r&&r.images.length)cloudMedia.preview({urls:r.images,current:r.images[0]});}
});
