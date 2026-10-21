const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mini=path.resolve(__dirname,'../miniprogram');
test('all registered page data-entry fields live inside dialogs while list search stays available',()=>{
 const app=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8'));
 const violations=[];
 for(const route of app.pages){
  const source=fs.readFileSync(path.join(mini,route+'.wxml'),'utf8'),stack=[];
  const tags=/<\/?([\w-]+)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  for(const match of source.matchAll(tags)){
   const token=match[0],name=match[1];if(token.startsWith('</')){stack.pop();continue;}
   const dialog=/aria-role="dialog"/.test(token)||stack.some(n=>n.dialog);
   if(['input','textarea','switch'].includes(name)&&!dialog){
    const handler=(token.match(/bind(?:input|change)="([^"]+)"/)||[])[1];
    const notificationControl=route==='pages/todo/index'&&name==='switch'&&handler==='onNotificationChange';
    if(!notificationControl&&!['onQuery','onSearch','onToolSearch','onScope'].includes(handler))violations.push(route+':'+(source.slice(0,match.index).split('\n').length)+' '+(handler||name));
   }
   if(!/\/\s*>$/.test(token))stack.push({name,dialog});
  }
 }
 assert.deepEqual(violations,[],'persistent editors and full tool forms must not expand inside lists');
});
