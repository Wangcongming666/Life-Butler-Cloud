const store=require('./storage');
/** 页面显示时重新取设置，返回旧页面也能立即使用新主题。 */
function apply(page){
  try{
    const p=store.read().preferences;
    page.setData({appearanceClass:'theme-'+p.theme+(p.dark?' theme-dark':'')+(p.font==='large'?' font-large':'')});
    if(typeof wx.setNavigationBarColor==='function')wx.setNavigationBarColor({frontColor:p.dark?'#ffffff':'#000000',backgroundColor:p.dark?'#18221e':'#f4f7f6',fail(){}});
  }catch(error){/* 数据损坏由页面业务读取显示，不覆盖原始记录。 */}
}
module.exports={apply};
