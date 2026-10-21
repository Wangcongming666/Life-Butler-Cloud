const cloudMedia=require('../../utils/media');
const store=require('../../utils/storage');const journal=require('../../utils/journal');const {attempt}=require('../../utils/ui');const appearance=require('../../utils/appearance');
require('../../utils/page-sync').definePage({
  data:{events:[],visible:[],detailEvent:null,limit:40,query:'',mode:'all',anchor:journal.dayText(),kind:'全部',kinds:['全部','随记','待办','记账','生活','打卡','专注','菜谱','借还']},
  onShow(){appearance.apply(this);this.refresh();},
  refresh(){return attempt(async () =>{const events=journal.timeline(store.read(),{query:this.data.query,mode:this.data.mode,kind:this.data.kind,date:this.data.anchor}).map(e=>Object.assign({},e,{timeLabel:e.dateOnly?e.date:e.date+' '+store.timeText(e.at)}));this.setData({events,visible:events.slice(0,this.data.limit),detailEvent:this.data.detailEvent?events.find(e=>e.id===this.data.detailEvent.id)||null:null});});},
  onQuery(e){this.setData({query:e.detail.value,limit:40});this.refresh();},onMode(e){this.setData({mode:e.currentTarget.dataset.mode,limit:40});this.refresh();},onDate(e){this.setData({anchor:e.detail.value,limit:40});this.refresh();},onKind(e){this.setData({kind:e.currentTarget.dataset.kind,limit:40});this.refresh();},
  more(){this.setData({limit:this.data.limit+40});this.refresh();},
  stopDialogTap(){},
  openDetail(e){const event=this.data.events.find(r=>r.id===e.currentTarget.dataset.id);if(event)this.setData({detailEvent:event});},
  closeDetail(){this.setData({detailEvent:null});},
  preview(e){const event=this.data.events.find(r=>r.id===e.currentTarget.dataset.id);if(event&&event.images.length)return cloudMedia.preview({urls:event.images,current:event.images[Number(e.currentTarget.dataset.index)||0]||event.images[0]});},
  open(e){const event=this.data.events.find(r=>r.id===e.currentTarget.dataset.id);if(!event)return;if(['/pages/todo/index','/pages/account/index'].includes(event.route))wx.switchTab({url:event.route});else wx.navigateTo({url:event.route});}
});
