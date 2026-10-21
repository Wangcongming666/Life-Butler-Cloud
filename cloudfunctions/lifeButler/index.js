const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database({throwOnNotFound:false});
const {createRepository}=require('./repository'),{createService}=require('./service');
const service=createService(createRepository(db));
const {createReminders,createReminderQueue}=require('./reminders');
const reminders=createReminders({records:createRepository(db),queue:createReminderQueue(db),
 send:payload=>cloud.openapi.subscribeMessage.send(payload),config:require('./shared/reminder-config')});
exports.main=async event=>{
 const owner=cloud.getWXContext().OPENID;
 // 不接受客户端自报 Timer 身份；有 OPENID 的小程序调用无法触发批量发送。
 if(!owner&&event&&event.Type==='Timer'&&event.TriggerName==='todoDueReminders')return reminders.run();
 const reminderActions={reminderRegister:'register',reminderDisable:'disable',reminderStatus:'status'};
 if(event&&Object.prototype.hasOwnProperty.call(reminderActions,event.action)){
  try{return await reminders[reminderActions[event.action]](owner,event);}catch(error){return {ok:false,code:'REMINDER_ERROR',message:error.message};}
 }
 return service(owner,event);
};
