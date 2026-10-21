/** 所有同步存储失败都向用户反馈；失败时不执行成功后的界面更新。 */
function attempt(action) {
  const report=error=>{wx.showModal({title:'操作未完成',content:error.message||'云端操作失败，请联网后重试',showCancel:false});};
  try { const result=action(); if(result&&typeof result.then==='function')return result.catch(error=>{report(error);return undefined;});return result; }
  catch (error) {
    wx.showModal({ title: '操作未完成', content: error.message || '本地存储失败，请检查设备空间', showCancel: false });
    return undefined;
  }
}
module.exports = { attempt };
