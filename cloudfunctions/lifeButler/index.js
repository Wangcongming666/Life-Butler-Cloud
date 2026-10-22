const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database({throwOnNotFound:false});
const {createRepository}=require('./repository'),{createService}=require('./service');
const service=createService(createRepository(db));
const {createReminders,createReminderQueue}=require('./reminders');
const reminders=createReminders({records:createRepository(db),queue:createReminderQueue(db),
 send:payload=>cloud.openapi.subscribeMessage.send(payload),config:require('./shared/reminder-config')});
exports.main=async event=>{
 const wxContext=cloud.getWXContext(),owner=wxContext.OPENID;
 const source=String(wxContext.SOURCE||'').split(',')[0];
 if(event&&event.Type==='Timer'&&event.TriggerName==='todoDueReminders'){
  // 控制台/IDE 模拟调用可能没有有效微信云调用票据，不认领真实订阅。
  if(source==='wx_devtools'||source==='wx_localdebug')return {ok:false,code:'WECHAT_TRIGGER_REQUIRED',message:'云端测试不能验证真实微信通知。请通过微信开发者工具上传定时触发器，再用真机订阅的未到期任务验证。'};
  // SOURCE 取可信 SDK 上下文，绝不使用客户端 event 中自报的 SOURCE。
  // 云端测试可能带 OPENID；它只能测试自己的提醒。真实触发器不依赖 OPENID 是否为空。
  const all=source==='wx_trigger'||(!owner&&!source);
  if(!all&&!owner)return {ok:false,code:'UNAUTHENTICATED',message:'请使用定时触发器或已登录用户测试提醒'};
  console.info('todo-reminders:start',{source:source||'server',scope:all?'scheduled':'current-user'});
  try{
   const result=all?await reminders.run():await reminders.runForOwner(owner);
   console.info('todo-reminders:result',result);return result;
  }catch(error){console.error('todo-reminders:error',error.code||error.errCode||'',error.message);throw error;}
 }
 const reminderActions={reminderRegister:'register',reminderDisable:'disable',reminderStatus:'status'};
 if(event&&Object.prototype.hasOwnProperty.call(reminderActions,event.action)){
  try{return await reminders[reminderActions[event.action]](owner,event);}catch(error){
   console.error('todo-reminders:action-error',{action:event.action,code:error.code||error.errCode||'',message:String(error.errMsg||error.message||error).slice(0,500)});
   return {ok:false,code:'REMINDER_ERROR',message:error.message};
  }
 }
 return service(owner,event);
};
