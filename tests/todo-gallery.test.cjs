const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('todo');p.onLoad({});await p.onShow();p.setData({todos:[{id:'album',title:'图片待办',images:['/tmp/a.jpg','/tmp/b.jpg','/tmp/c.jpg']}]});return {c,p};}
test('album opens on the selected thumbnail and keeps swipe position when reopened',async()=>{
 const {p}=await setup();p.onTodoImageChange({currentTarget:{dataset:{id:'album'}},detail:{current:1}});assert.equal(p.data.imageIndexes.album,1);
 p.previewTodoImage({currentTarget:{dataset:{id:'album'}}});assert.equal(p.data.galleryMounted,true);assert.equal(p.data.galleryCurrent,1);assert.equal(p.data.galleryImages.length,3);
 await new Promise(r=>setTimeout(r,50));assert.equal(p.data.galleryOpen,true);assert.equal(p.data.galleryScrollTarget,'gallery-photo-1');p.onGalleryChange({detail:{current:2}});assert.equal(p.data.imageIndexes.album,2);
 p.onGalleryImageLoad({currentTarget:{dataset:{index:2}}});p.closeGallery();assert.equal(p.data.galleryOpen,false);p.previewTodoImage({currentTarget:{dataset:{id:'album'}}});await new Promise(r=>setTimeout(r,340));assert.equal(p.data.galleryMounted,true);assert.equal(p.data.galleryCurrent,2);assert.equal(p.data.galleryStates[2],'loaded');p.onUnload();
});
test('gallery image states handle loaded, failed and retry, and page hide clears animation timers',async()=>{
 const {p}=await setup();p.previewTodoImage({currentTarget:{dataset:{id:'album',index:0}}});p.onGalleryImageError({currentTarget:{dataset:{index:0}}});assert.equal(p.data.galleryStates[0],'error');p.retryGalleryImage();assert.equal(p.data.galleryStates[0],'loading');p.onGalleryImageLoad({currentTarget:{dataset:{index:0}}});assert.equal(p.data.galleryStates[0],'loaded');
 p.onHide();await new Promise(r=>setTimeout(r,50));assert.equal(p.data.galleryMounted,false);assert.equal(p.data.galleryOpen,false);p.onUnload();
});
test('invalid album inputs are ignored and dragging the header left closes the panel',async()=>{
 const {p}=await setup();p.previewTodoImage({currentTarget:{dataset:{id:'missing'}}});assert.equal(p.data.galleryMounted,false);
 p.previewTodoImage({currentTarget:{dataset:{id:'album',index:99}}});assert.equal(p.data.galleryCurrent,0);
 p.onGalleryDragStart({touches:[{clientX:120,clientY:20}]});p.onGalleryDragEnd({changedTouches:[{clientX:20,clientY:25}]});assert.equal(p.data.galleryOpen,false);p.onUnload();
});
test('selected image expands directly from thumbnail and closes back to the same open list',async()=>{
 const {c,p}=await setup();p.previewTodoImage({currentTarget:{dataset:{id:'album',index:1}}});await new Promise(r=>setTimeout(r,50));
 p.onGalleryImageLoad({currentTarget:{dataset:{index:1}},detail:{width:800,height:500}});
 let selector,nativeCalls=0;c.wx.previewImage=()=>nativeCalls++;c.wx.getWindowInfo=()=>({windowWidth:375,windowHeight:700});
 c.wx.createSelectorQuery=()=>({select(value){selector=value;return this;},boundingClientRect(callback){callback({left:20,top:200,width:160,height:100});return this;},exec(){}});
 const target=p.data.galleryScrollTarget;p.viewGalleryPhoto({currentTarget:{dataset:{index:1}}});assert.equal(selector,'#gallery-photo-1 .todo-gallery-image');assert.equal(p.data.zoomSource,'/tmp/b.jpg');assert.equal(p.data.zoomMounted,true);assert.equal(p.data.zoomOpen,false);assert.match(p.data.zoomTransform,/scale\(/);assert.equal(nativeCalls,0);
 await new Promise(r=>setTimeout(r,50));assert.equal(p.data.zoomOpen,true);assert.equal(p.data.zoomTransform,'translate3d(0,0,0) scale(1,1)');
 p.closeImageZoom();await new Promise(r=>setTimeout(r,320));assert.equal(p.data.zoomMounted,false);assert.equal(p.data.galleryOpen,true);assert.equal(p.data.galleryCurrent,1);assert.equal(p.data.galleryScrollTarget,target);assert.equal(p.data.galleryStates[1],'loaded');p.onUnload();
});
test('late thumbnail measurement cannot reopen zoom after list has closed',async()=>{
 const {c,p}=await setup();p.previewTodoImage({currentTarget:{dataset:{id:'album'}}});await new Promise(r=>setTimeout(r,50));let measured;
 c.wx.createSelectorQuery=()=>({select(){return this;},boundingClientRect(callback){measured=callback;return this;},exec(){}});
 p.viewGalleryPhoto({currentTarget:{dataset:{index:1}}});p.closeGallery();measured({left:20,top:100,width:100,height:80});assert.equal(p.data.zoomMounted,false);p.onUnload();
});