const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
for(const name of ['data-schema','record-model','schedule','exams','life','journal','reminder-config'])fs.copyFileSync(path.join(root,'miniprogram/utils',name+'.js'),path.join(root,'cloudfunctions/lifeButler/shared',name+'.js'));
console.log('Shared validators synchronized; deploy lifeButler again after changes.');
