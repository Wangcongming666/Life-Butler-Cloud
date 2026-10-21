/** 本地图片附件：选图只产生临时路径，保存待办时才复制到持久目录。 */
const MAX_IMAGES = 6;
const MAX_BYTES = 10 * 1024 * 1024;
const cloud=require('./cloud'),sync=require('./sync');
// Only cache references in memory; temporary files remain managed by WeChat.
const localFiles = new Map(), localRequests = new Map(), previewURLs = new Map();
const CACHE_LIMIT = 100, PREVIEW_URL_TTL = 5 * 60 * 1000;
function remember(cache, key, value) {
  cache.delete(key); cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}
function cachedLocal(fileID) {
  const path = localFiles.get(fileID);
  if (!path) return '';
  try { wx.getFileSystemManager().accessSync(path); return path; }
  catch (error) { localFiles.delete(fileID); return ''; }
}
function isCloud(path){return typeof path==='string'&&path.startsWith('cloud://'+cloud.ENV+'.');}
function directory(kind) {
  const root = wx.env && wx.env.USER_DATA_PATH;
  if (!root) throw new Error('当前环境不支持本地图片保存，请在手机微信中使用');
  return root + (kind === 'note' ? '/note-images' : '/todo-images');
}
function isOwned(path) {
  if(isCloud(path))return true;
  try {
    return ['todo', 'note'].some(kind => {
      const prefix = directory(kind) + '/';
      return typeof path === 'string' && path.startsWith(prefix) && /^[a-z0-9_-]+\.(jpg|jpeg|png|gif|webp|heic)$/i.test(path.slice(prefix.length));
    });
  } catch (error) { return false; }
}
function choose(count, sourceType) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) return reject(new Error('每条记录最多添加 6 张图片'));
    const sources = sourceType === 'camera' ? ['camera'] : sourceType === 'album' ? ['album'] : ['album', 'camera'];
    const success = result => {
      const files = result.tempFiles || (result.tempFilePaths || []).map(path => ({ path }));
      if (files.length > count) return reject(new Error('选择的图片超过剩余数量'));
      if (files.some(file => file.size > MAX_BYTES)) return reject(new Error('单张图片不能超过 10MB，请压缩后重试'));
      const paths = files.map(file => file.tempFilePath || file.path);
      if (paths.some(path => typeof path !== 'string' || !path)) return reject(new Error('图片读取失败，请重新选择'));
      resolve(paths);
    };
    const fail = error => /cancel/i.test(error.errMsg || '') ? resolve([]) : reject(new Error('无法选择图片，请检查相册或相机权限后重试'));
    // camera 入口在手机上直接调起拍摄；开发者工具使用文件选择器模拟。
    if (wx.chooseMedia) wx.chooseMedia({ count, mediaType: ['image'], sourceType: sources, camera: 'back', sizeType: ['compressed'], success, fail });
    else if (wx.chooseImage) wx.chooseImage({ count, sourceType: sources, sizeType: ['compressed'], success, fail });
    else reject(new Error('当前环境不支持选图，请升级微信后重试'));
  });
}
async function remove(paths) {
  // 云文件可能被其他设备的草稿或尚未确认的提交引用，保守保留，禁止客户端直接删除。
  const targets = Array.from(new Set((paths || []).filter(p=>!isCloud(p)&&isOwned(p))));
  if (!targets.length) return;
  const fs = wx.getFileSystemManager();
  for (const path of targets) {
    await new Promise(resolve => fs.unlink({ filePath: path, success: resolve, fail: resolve }));
  }
}
/** 原生编辑只返回临时结果，取消和未保存草稿都不会改动原图。 */
async function edit(src) {
  src=await localFile(src);
  return new Promise((resolve, reject) => {
    if (typeof wx.editImage !== 'function') return reject(new Error('当前环境不支持图片编辑，请升级微信并在手机中使用'));
    wx.editImage({ src,
      success: result => result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('未获取到编辑后的图片，请重试')),
      fail: error => /cancel/i.test(error.errMsg || '') ? resolve(src) : reject(new Error('图片编辑未完成，请在手机微信中重试'))
    });
  });
}
async function persist(paths, existing, kind) {
  if (!Array.isArray(paths) || paths.length > MAX_IMAGES || paths.some(path => typeof path !== 'string' || !path)) throw new Error('图片附件格式异常，最多添加 6 张');
  if (!paths.length) return { paths: [], created: [] };
  const owner=sync.getDefault().owner();if(!owner)throw Error('请先连接云端后再上传图片');
  const result = [], created = [];
  try {
    for (const source of paths) {
      if (isCloud(source)) { result.push(source); continue; }
      const extension = (source.match(/\.(jpg|jpeg|png|gif|webp|heic)$/i) || [null, 'jpg'])[1].toLowerCase();
      const cloudPath='life-butler/'+owner+'/'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12)+'.'+extension;
      const uploaded=await wx.cloud.uploadFile({cloudPath,filePath:source,config:{env:cloud.ENV}});
      if(!uploaded.fileID)throw Error('照片上传未完成，请重试');created.push(uploaded.fileID);result.push(uploaded.fileID);remember(localFiles, uploaded.fileID, source);
    }
    return { paths: result, created };
  } catch (error) { await remove(created); throw error; }
}
async function localFile(path) {
  if (!isCloud(path)) return path;
  const cached = cachedLocal(path);
  if (cached) return cached;
  if (localRequests.has(path)) return localRequests.get(path);
  const request = Promise.resolve().then(async () => {
    try {
      const result = await wx.cloud.downloadFile({fileID: path, config: {env: cloud.ENV}});
      if (!result.tempFilePath) throw Error('没有下载到图片');
      remember(localFiles, path, result.tempFilePath);
      return result.tempFilePath;
    } catch (error) { throw Error('云端照片下载失败，请联网后重试'); }
    finally { localRequests.delete(path); }
  });
  localRequests.set(path, request);
  return request;
}
async function uploadData(data){
 const records=[].concat(data.todos||[],data.notes||[],data.life&&data.life.records||[],data.library&&data.library.loans||[],data.library&&data.library.recipes||[]),map=new Map();
 for(const record of records){if(!record.images)continue;const images=[];for(const path of record.images){if(!map.has(path))map.set(path,(await persist([path],[],'note')).paths[0]);images.push(map.get(path));}record.images=images;}return data;
}
async function preview(options) {
  try {
    if (!options || !Array.isArray(options.urls) || !options.urls.length) return;
    const resolved = new Map(), missing = [];
    for (const path of new Set(options.urls)) {
      if (!isCloud(path)) { resolved.set(path, path); continue; }
      const local = cachedLocal(path), cached = previewURLs.get(path);
      if (local) resolved.set(path, local);
      else if (cached && cached.expiresAt > Date.now()) resolved.set(path, cached.url);
      else missing.push(path);
    }
    if (missing.length && typeof wx.cloud.getTempFileURL === 'function') {
      try {
        const result = await wx.cloud.getTempFileURL({fileList: missing, config: {env: cloud.ENV}});
        for (const file of result.fileList || []) {
          if (!missing.includes(file.fileID) || !file.tempFileURL || (file.status !== undefined && file.status !== 0)) continue;
          remember(previewURLs, file.fileID, {url: file.tempFileURL, expiresAt: Date.now() + PREVIEW_URL_TTL});
          resolved.set(file.fileID, file.tempFileURL);
        }
      } catch (error) { /* Fall back to authenticated cloud downloads below. */ }
    }
    await Promise.all(missing.filter(path => !resolved.has(path)).map(async path => {
      resolved.set(path, await localFile(path));
    }));
    const urls = options.urls.map(path => resolved.get(path));
    const index = Math.max(0, options.urls.indexOf(options.current));
    const fail = () => {
      // A previously valid signed URL may expire or be revoked; retry with cloud download.
      options.urls.forEach(path => previewURLs.delete(path));
      Promise.all(options.urls.map(path => localFile(path))).then(localURLs => {
        wx.previewImage({...options, urls: localURLs, current: localURLs[index], fail: () => {
          if (typeof options.fail === 'function') options.fail();
          else wx.showModal({title: '照片未能打开', content: '图片加载失败，请联网后重试', showCancel: false});
        }});
      }).catch(error => wx.showModal({title: '照片未能打开', content: error.message, showCancel: false}));
    };
    wx.previewImage({...options, urls, current: urls[index], fail});
  } catch (error) { wx.showModal({title: '照片未能打开', content: error.message, showCancel: false}); }
}
module.exports = { MAX_IMAGES, choose, edit, persist, remove, isOwned, isCloud,localFile,uploadData,preview };
