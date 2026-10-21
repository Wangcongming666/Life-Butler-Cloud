const config = require('./reminder-config');
const cloud = require('./cloud');

async function subscribe(todo) {
  if (!todo || todo.done || !Number.isFinite(todo.dueAt) || todo.dueAt <= Date.now()) throw Error('只能为未到期且未完成的待办开启提醒');
  if (!config.templateId) throw Error('到期提醒尚未配置，请先配置微信订阅消息模板');
  if (typeof wx.requestSubscribeMessage !== 'function') throw Error('当前微信版本不支持订阅提醒，请升级微信');
  // 必须在点击处理函数中直接调用，不在授权前等待网络请求。
  const result = await new Promise((resolve, reject) => wx.requestSubscribeMessage({
    tmplIds: [config.templateId], success: resolve, fail: () => reject(Error('未开启提醒，请检查微信订阅消息设置后重试'))
  }));
  if (result[config.templateId] !== 'accept') throw Error('未开启提醒，需要同意订阅消息');
  const response = await cloud.call('reminderRegister', {id: todo.id, dueAt: todo.dueAt, templateId: config.templateId});
  if (!response.ok) throw Error(response.message || '提醒登记失败，请重试');
  return response;
}
async function disable(todo) {
  const response = await cloud.call('reminderDisable', {id: todo.id, dueAt: todo.dueAt});
  if (!response.ok) throw Error(response.message || '关闭通知失败，请重试');
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
module.exports = {subscribe, disable, status};
