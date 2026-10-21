const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const prefix='cloud://cloud1-d9gt20q4c67e72873.bucket/';
function setup(){const files=new Set(),downloads=[],batches=[],previews=[],notices=[];let fail=false;
 const wx={env:{USER_DATA_PATH:'/device'},getFileSystemManager:()=>({accessSync:p=>{if(!files.has(p))throw Error('missing');}}),showModal:o=>notices.push(o),previewImage:o=>previews.push(o),cloud:{
 uploadFile:async()=>({fileID:prefix+'uploaded.jpg'}),
 downloadFile:async o=>{downloads.push(o.fileID);if(fail)throw Error('offline');const tempFilePath='/tmp/'+downloads.length+'.jpg';files.add(tempFilePath);return {tempFilePath};},
 getTempFileURL:async o=>{batches.push(o.fileList);if(fail)throw Error('offline');return {fileList:o.fileList.map(fileID=>({fileID,status:0,tempFileURL:'https://example.com/'+fileID.split('/').pop()}))};}}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/media.js'),'utf8'),{module,wx,Date,console,require:id=>id==='./cloud'?{ENV:'cloud1-d9gt20q4c67e72873'}:{getDefault:()=>({owner:()=> 'user'})}});
 return {media:module.exports,wx,files,downloads,batches,previews,notices,offline:()=>{fail=true;}};
}
test('preview batches addresses without downloading every original and reuses valid URLs',async()=>{
 const h=setup(),a=prefix+'a.jpg',b=prefix+'b.jpg';await h.media.preview({urls:[a,b],current:b});assert.equal(h.downloads.length,0);assert.equal(h.batches.length,1);assert.equal(h.previews[0].current,'https://example.com/b.jpg');assert.equal(h.previews[0].urls.length,2);
 await h.media.preview({urls:[a,b],current:a});assert.equal(h.batches.length,1);assert.equal(h.previews.length,2);
});
test('local downloads are shared, reused and refreshed when the temporary file disappears',async()=>{
 const h=setup(),a=prefix+'a.jpg';const paths=await Promise.all([h.media.localFile(a),h.media.localFile(a)]);assert.equal(h.downloads.length,1);assert.equal(paths[0],paths[1]);
 assert.equal(await h.media.localFile(a),paths[0]);h.files.clear();await h.media.localFile(a);assert.equal(h.downloads.length,2);
});
test('uploaded image opens from its local source without waiting for the cloud',async()=>{
 const h=setup();h.files.add('/tmp/source.jpg');const uploaded=await h.media.persist(['/tmp/source.jpg'],[]);h.offline();await h.media.preview({urls:uploaded.paths,current:uploaded.paths[0]});assert.equal(h.previews[0].current,'/tmp/source.jpg');assert.equal(h.downloads.length,0);assert.equal(h.batches.length,0);
});
test('preview falls back to downloads if temporary URL lookup fails',async()=>{
 const h=setup(),a=prefix+'a.jpg';h.wx.cloud.getTempFileURL=async()=>{throw Error('lookup failed');};await h.media.preview({urls:[a],current:a});assert.equal(h.downloads.length,1);assert.equal(h.previews.length,1);
});
test('failed download can be retried and is not cached as an in-flight request',async()=>{
 const h=setup(),a=prefix+'a.jpg';h.offline();await assert.rejects(h.media.localFile(a));await assert.rejects(h.media.localFile(a));assert.equal(h.downloads.length,2);
});
test('native preview failure clears URL cache and retries authenticated local files',async()=>{
 const h=setup(),a=prefix+'a.jpg';await h.media.preview({urls:[a],current:a});h.previews[0].fail();
 for(let i=0;i<12;i++)await Promise.resolve();assert.equal(h.downloads.length,1);assert.equal(h.previews.length,2);assert.match(h.previews[1].current,/^\/tmp\//);
});