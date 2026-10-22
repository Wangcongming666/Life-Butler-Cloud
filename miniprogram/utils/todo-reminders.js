const config = require('./reminder-config');
const cloud = require('./cloud');
const subscriptionError = (code, message) => Object.assign(Error(message), {code});
const settingsRequired = () => subscriptionError('SUBSCRIPTION_SETTINGS_REQUIRED', '微信已关闭订阅消息，请在设置中允许接收，再回来重新开启到期通知');
function subscriptionSettings() {
  if (typeof wx.getSetting !== 'function') return Promise.resolve(null);
  return new Promise(resolve => wx.getSetting({withSubscriptions: true,
    success: result => resolve(result.subscriptionsSetting || null), fail: () => resolve(null)}));
}
function openSettings() {
  if (typeof wx.openSetting !== 'function') return Promise.reject(Error('请从小程序右上角设置中开启消息通知'));
  // 只由用户确认“去设置”的点击回调调用；返回设置结果不等于新增一次订阅授权。
  return new Promise((resolve, reject) => wx.openSetting({withSubscriptions: true, success: resolve,
    fail: () => reject(Error('请从小程序右上角设置中开启消息通知'))}));
}
function errorMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (/DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection not exists/i.test(message)) return '通知服务正在准备，请稍后重试';
  if (/index|索引/i.test(message)) return '通知服务尚未就绪，请稍后重试';
  if (error && error.code === 'NETWORK') return '连接失败，请检查网络后重试';
  if (/database|document\.(?:get|set|update)|ResourceNotFound|PERMISSION_DENIED|creation denied|createCollection/i.test(message)) return '通知暂不可用，请稍后重试';
  return message && message.length <= 80 ? message : '通知暂不可用，请稍后重试';
}

async function subscribe(todo) {
  if (!todo || todo.done || !Number.isFinite(todo.dueAt) || todo.dueAt <= Date.now()) throw Error('只能为未到期且未完成的待办开启提醒');
  if (!config.templateId) throw Error('到期提醒尚未配置，请先配置微信订阅消息模板');
  if (typeof wx.requestSubscribeMessage !== 'function') throw Error('当前微信版本不支持订阅提醒，请升级微信');
  // 必须在点击处理函数中直接调用，不在授权前等待网络请求。
  const result = await new Promise((resolve, reject) => wx.requestSubscribeMessage({
    tmplIds: [config.templateId], success: resolve, fail: error => reject(error && error.errCode === 20004
      ? settingsRequired() : subscriptionError('SUBSCRIPTION_FAILED', '未开启提醒，请返回小程序重新点击开关重试'))
  }));
  if (result[config.templateId] !== 'accept') {
    if (result[config.templateId] === 'ban') throw subscriptionError('SUBSCRIPTION_BLOCKED', '该通知模板暂不可订阅，请稍后重试');
    const settings = await subscriptionSettings();
    if (settings && (settings.mainSwitch === false || settings.itemSettings && settings.itemSettings[config.templateId] === 'reject')) throw settingsRequired();
    throw subscriptionError('SUBSCRIPTION_REJECTED', '未开启提醒，可再次点击开关并允许订阅');
  }
  const response = await cloud.call('reminderRegister', {id: todo.id, dueAt: todo.dueAt, templateId: config.templateId});
  if (!response.ok) throw Error(response.message || '提醒登记失败，请重试');
  return response;
}
async function disable(todo) {
  const response = await cloud.call('reminderDisable', {id: todo.id, dueAt: todo.dueAt});
  if (!response.ok) throw Object.assign(Error(response.message || '关闭通知失败，请重试'), {code: response.code, requestId: response.requestId});
  return response;
}
async function status(ids) {
  const result = [];
  for (let index = 0; index < ids.length; index += 40) {
    const response = await cloud.call('reminderStatus', {ids: ids.slice(index, index + 40)});
    if (!response.ok || !Array.isArray(response.reminders)) throw Error(response.message || '通知状态读取失败，请重试');
    result.push(...response.reminders);
  }
  return result;
}
module.exports = {subscribe, disable, status, errorMessage, openSettings};
