const store=require('../../utils/storage');const journal=require('../../utils/journal');const {attempt}=require('../../utils/ui');const appearance=require('../../utils/appearance');
const NAMES={checkin:'每日签到',homework:'课程作业',assets:'物品保修',shopping:'购物清单',budget:'月度预算',habits:'习惯打卡',focus:'番茄钟',countdown:'纪念倒数',expiry:'保质期',search:'全局搜索',backup:'备份恢复',loans:'借还管理',food:'饮食菜谱',review:'生活回顾',timeline:'时间轴',settings:'个性化设置'};
require('../../utils/page-sync').definePage({
  data:{settingsDialog:'',settingsBusy:false,settingsError:'',settings:{},themes:[{id:'mint',name:'薄荷绿'},{id:'blue',name:'雾蓝'},{id:'rose',name:'豆沙粉'}],entries:[],favorites:[]},
  preventSettingsTouch(){},
  openSettingsDialog(e){if(this.data.settingsBusy)return;const dialog=e.currentTarget.dataset.dialog;if(['appearance','favorites'].includes(dialog))this.setData({settingsDialog:dialog,settingsError:''});},
  closeSettingsDialog(){if(!this.data.settingsBusy)this.setData({settingsDialog:'',settingsError:''});},
  onShow(){this.refresh();},
  refresh(){return attempt(async () =>{const p=store.read().preferences;this.setData({settings:p,entries:journal.MANAGERS.map(id=>({id,name:NAMES[id],selected:p.favorites.includes(id)})),favorites:p.favorites.map(id=>({id,name:NAMES[id]}))});appearance.apply(this);});},
  async save(patch){if(this.data.settingsBusy)return;this.setData({settingsBusy:true,settingsError:''});try{await store.savePreferences(patch);await this.refresh();}catch(error){await this.refresh();this.setData({settingsError:error.message||'设置保存失败，请重试'});}finally{this.setData({settingsBusy:false});}},
  theme(e){this.save({theme:e.currentTarget.dataset.id});},onDark(e){this.save({dark:e.detail.value});},onLarge(e){this.save({font:e.detail.value?'large':'normal'});},onReminder(e){this.save({showReminders:e.detail.value});},
  favorite(e){const id=e.currentTarget.dataset.id,existing=this.data.settings.favorites;this.save({favorites:existing.includes(id)?existing.filter(v=>v!==id):existing.concat(id)});},
  move(e){const values=this.data.settings.favorites.slice(),index=values.indexOf(e.currentTarget.dataset.id),next=index+Number(e.currentTarget.dataset.step);if(index<0||next<0||next>=values.length)return;[values[index],values[next]]=[values[next],values[index]];this.save({favorites:values});},
  reset(){if(this.data.settingsBusy)return;wx.showModal({title:'恢复默认设置？',content:'只恢复显示和常用功能设置，业务记录会保留。',success: async r =>{if(r.confirm)this.save(journal.preferences());}});}
});
