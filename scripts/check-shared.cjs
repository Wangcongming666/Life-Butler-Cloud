const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
for(const name of ['data-schema','record-model','schedule','exams','life','journal','reminder-config'])assert.equal(fs.readFileSync(path.join(root,'miniprogram/utils',name+'.js'),'utf8'),fs.readFileSync(path.join(root,'cloudfunctions/lifeButler/shared',name+'.js'),'utf8'),name+' shared module drift');
console.log('PASS shared validators match');
