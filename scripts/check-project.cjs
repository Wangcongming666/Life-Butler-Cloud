const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),mini=path.join(root,'miniprogram'),read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&e.name!=='node_modules'?walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[]);}
for(const file of walk(mini).concat(walk(path.join(root,'cloudfunctions/lifeButler')))){if(file.endsWith('.js'))new vm.Script(read(file),{filename:file});if(file.endsWith('.json'))JSON.parse(read(file));}
const config=JSON.parse(read(path.join(root,'project.config.example.json'))),app=JSON.parse(read(path.join(mini,'app.json')));assert.equal(config.appid,'YOUR_WECHAT_APPID');assert.equal(config.miniprogramRoot,'miniprogram/');assert.equal(config.cloudfunctionRoot,'cloudfunctions/');
for(const route of app.pages){for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(mini,route+'.'+ext)),route+'.'+ext);const js=read(path.join(mini,route+'.js')),markup=read(path.join(mini,route+'.wxml'));assert.ok(js.includes('page-sync'),'missing sync '+route);assert.ok(markup.includes('cloudReady'),'missing loading gate '+route);
 const stack=[];for(const match of markup.matchAll(/<\/?([A-Za-z][\w-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)){const tag=match[0],name=match[1];if(tag.startsWith('</'))assert.equal(stack.pop(),name,route+' closing '+name);else if(!/\/\s*>$/.test(tag))stack.push(name);}assert.equal(stack.length,0,route+' unclosed tags');
 for(const match of markup.matchAll(/(?:bind|catch)(?::?[a-z]+)\s*=\s*"([A-Za-z_]\w*)"/g)){const name=match[1];assert.ok(name==='syncNow'||new RegExp('\\b'+name+'\\s*\\(').test(js),route+' missing handler '+name);}
}
assert.ok(read(path.join(mini,'utils/cloud.example.js')).includes('YOUR_CLOUD_ENV_ID'));
console.log('PASS syntax, JSON, '+app.pages.length+' pages, WXML handlers, environment templates');
