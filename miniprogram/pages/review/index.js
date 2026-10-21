const cloudMedia=require('../../utils/media');
const store=require('../../utils/storage');const journal=require('../../utils/journal');const {attempt}=require('../../utils/ui');const appearance=require('../../utils/appearance');
require('../../utils/page-sync').definePage({
  data:{view:'week',mode:'week',anchorLabel:'',anchor:journal.dayText(),result:null},
  onLoad(options){this.setData({view:'week',mode:'week',anchor:journal.dayText()});if(options && /^\d{4}-(0[1-9]|1[0-2])$/.test(options.month || '') && options.month >= '1970-01' && options.month <= '2100-12')this.setData({view:'month',mode:'month',anchor:options.month+'-01'});},
  onShow(){appearance.apply(this);this.refresh();},
  refresh(){return attempt(async () =>{const r=journal.review(store.read(),this.data.mode,this.data.anchor),maximum=Math.max(1,...r.days.map(d=>d.amountCents));this.setData({anchorLabel:this.data.mode==='month'?this.data.anchor.slice(0,7):this.data.anchor,result:Object.assign({},r,{expenseText:store.money(r.expenseCents),categories:r.categories.map(c=>({name:c.name,amount:store.money(c.cents)})),days:r.days.map(d=>Object.assign({},d,{amount:store.money(d.amountCents),percent:Math.round(d.amountCents/maximum*100)}))})});});},
  onMode(e){const mode=e.currentTarget.dataset.mode;if(mode==='summary'){this.setData({view:'summary'});this.refresh();return;}if(!['week','month'].includes(mode))return;if(mode===this.data.mode){this.setData({view:mode});return;}this.setData({view:mode,mode,anchor:journal.dayText()});this.refresh();},
  onSummaryMode(e){const mode=e.currentTarget.dataset.mode;if(!['week','month'].includes(mode)||mode===this.data.mode)return;this.setData({mode,anchor:journal.dayText()});this.refresh();},
  onDate(e){const value=e.detail.value;this.setData({anchor:/^\d{4}-\d{2}$/.test(value)?value+'-01':value});this.refresh();},
  preview(e){const photos=this.data.result.photos;if(photos.length)cloudMedia.preview({urls:photos,current:photos[Number(e.currentTarget.dataset.index)]});},
  copy(){const r=this.data.result;if(!r)return;const text=(this.data.view==='summary'?'生活总结 ':'生活回顾 ')+r.range.start+' ～ '+r.range.end+'\n支出 ¥'+r.expenseText+'（'+r.expenseCount+'笔）\n新建待办 '+r.createdTodos+' 件\n完成待办 '+r.completedTodos+' 件（按时 '+r.onTimeCompletedTodos+' 件，逾期完成 '+r.lateCompletedTodos+' 件）\n专注 '+r.focusMinutes+' 分钟\n习惯打卡 '+r.checkins+' 次\n随记 '+r.notes+' 条\n新增菜谱 '+r.recipes+' 份'+(r.unknownCompleted?'\n另有 '+r.unknownCompleted+' 件历史已完成待办未记录完成时间，未计入本期。':'');wx.setClipboardData({data:text,success: async () =>wx.showToast({title:this.data.view==='summary'?'总结已复制':'回顾已复制',icon:'success'})});},
  openTimeline(){wx.navigateTo({url:'/pages/timeline/index'});}
});
