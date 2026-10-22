const ENV='YOUR_CLOUD_ENV_ID';
const APPID='YOUR_WECHAT_APPID';
let initialized=false;
function init(){if(initialized)return;if(!wx.cloud)throw Error('当前微信版本不支持云开发，请升级微信');wx.cloud.init({env:ENV,traceUser:true});initialized=true;}
async function call(action,payload){
 init();try{const response=await wx.cloud.callFunction({name:'lifeButler',data:{...payload,action},config:{env:ENV}});if(!response||!response.result)throw Error('云函数返回为空');return response.result.ok===false?{...response.result,requestId:response.requestID||response.result.requestId}:response.result;}
 catch(e){throw Object.assign(Error('云端连接失败，请检查网络及 lifeButler 云函数是否部署。'+(e.errMsg||e.message||'')),{code:'NETWORK'});}
}
module.exports={ENV,APPID,init,call};
