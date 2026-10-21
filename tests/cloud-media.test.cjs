const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){const uploads=[],deleted=[];let fail=false;const wx={env:{USER_DATA_PATH:'/device'},cloud:{uploadFile:async o=>{uploads.push(o);return {fileID:'cloud://cloud1-d9gt20q4c67e72873.bucket/'+o.cloudPath};},downloadFile:async()=>{if(fail)throw Error('下载失败');return {tempFilePath:'/tmp/download.jpg'};}},getFileSystemManager:()=>({unlink:o=>{deleted.push(o.filePath);o.success();}})};const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/media.js'),'utf8'),{wx,module:m,require:id=>id==='./sync'?{getDefault:()=>({owner:()=> 'user'})}:id==='./cloud'?{ENV:'cloud1-d9gt20q4c67e72873'}:require(id),console,Date});return {media:m.exports,uploads,deleted,failDownload(){fail=true;}};}
test('new images upload and existing cloud references survive cleanup',async()=>{
 const h=load(),r=await h.media.persist(['/tmp/a.jpg'],[],'note');assert.match(r.paths[0],/^cloud:\/\//);assert.equal(h.uploads.length,1);assert.match(h.uploads[0].cloudPath,/life-butler\/user\//);
 const next=await h.media.persist(r.paths,r.paths);assert.equal(next.paths[0],r.paths[0]);assert.equal(h.uploads.length,1);await h.media.remove(r.paths);assert.equal(h.deleted.length,0);
});
test('private cloud image is downloaded before editing or backup',async()=>{
 const h=load();assert.equal(await h.media.localFile('cloud://cloud1-d9gt20q4c67e72873.bucket/life-butler/user/a.jpg'),'/tmp/download.jpg');h.failDownload();await assert.rejects(h.media.localFile('cloud://cloud1-d9gt20q4c67e72873.bucket/life-butler/user/b.jpg'));
});
