/** 可移植 JSON 备份。图片以 base64 嵌入，导入内容绝不执行为代码。 */
const media = require('./media');
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
function utf8Bytes(text) {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) total++; else if (code < 2048) total += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { total += 4; i++; }
    else total += 3;
  }
  return total;
}
function records(data) { return [].concat(data.todos || [], data.notes || [], data.life && data.life.records || [], data.library && data.library.loans || [], data.library && data.library.recipes || []); }
function paths(data) { return Array.from(new Set(records(data).reduce((all, r) => all.concat(r.images || []), []))); }
async function fileRead(path) {
  path=await media.localFile(path);
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: r => resolve(r.data), fail: () => reject(new Error('有照片无法读取，请重新添加或删除缺失照片后再备份')) }));
}
function bytes(base64) { return base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0); }
function checkBase64(value) {
  // 扁平字符校验，避免大照片在重复分组正则中耗尽调用栈。
  if (typeof value !== 'string' || !value.length || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('备份图片内容损坏');
  return bytes(value);
}
async function build(data) {
  const images = []; let size = 0;
  const allPaths = paths(data);
  if (allPaths.length > 15000) throw new Error('备份最多包含15000张照片，请减少后重试');
  for (const path of allPaths) {
    if (!media.isOwned(path)) throw new Error('图片路径异常，无法完整备份');
    const base64 = await fileRead(path); size += checkBase64(base64);
    if (size > MAX_BYTES) throw new Error('完整备份照片总量超过25MB，请先减少照片');
    images.push({ path, base64 });
  }
  const text = JSON.stringify({ app: '生活管家', format: 'life-butler-full', backupVersion: 1, exportedAt: new Date().toISOString(), data, images });
  if (utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('备份文件超过40MB，请减少照片或记录后重试');
  return text;
}
function inspect(text, validate) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES || utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('备份文件过大，最多40MB');
  let pkg;
  try { pkg = JSON.parse(text); } catch (error) { throw new Error('不是有效的 JSON 备份'); }
  if (!pkg || pkg.app !== '生活管家' || !pkg.data) throw new Error('请选择生活管家导出的备份');
  const full = pkg.format === 'life-butler-full';
  if (pkg.format && !full || full && pkg.backupVersion !== 1) throw new Error('备份版本不支持');
  const embedded = new Map(), targets = new Set(paths(pkg.data)); let size = 0;
  if (full) {
    if (!Array.isArray(pkg.images) || pkg.images.length > 15000) throw new Error('备份图片列表异常');
    pkg.images.forEach(image => {
      if (!image || typeof image.path !== 'string' || !targets.has(image.path) || embedded.has(image.path)) throw new Error('备份图片索引异常');
      size += checkBase64(image.base64);
      if (size > MAX_BYTES) throw new Error('备份图片超过25MB');
      embedded.set(image.path, image.base64);
    });
    if (targets.size !== embedded.size) throw new Error('完整备份缺少照片，无法恢复');
  }
  const data = JSON.parse(JSON.stringify(pkg.data)), replacements = new Map(); let missing = 0, index = 0;
  for (const original of targets) {
    if (embedded.has(original)) replacements.set(original, wx.env.USER_DATA_PATH + '/note-images/restore_preview_' + index++ + '.jpg');
    else {
      let exists = false;
      if(media.isCloud(original))exists=true;
      else if (media.isOwned(original)) { try { wx.getFileSystemManager().accessSync(original); exists = true; } catch (error) { /* 旧文本备份可能在其他设备恢复。 */ } }
      replacements.set(original, exists ? original : ''); if (!exists) missing++;
    }
  }
  records(data).forEach(r => { if (r.images !== undefined) r.images = r.images.map(p => replacements.get(p)).filter(Boolean); });
  validate(data);
  return { data, embedded, replacements, missing, images: embedded.size,
    counts: { todos: data.todos.length, expenses: data.expenses.length, notes: data.notes.length, courses: data.schedule.courses.length, exams: data.schedule.exams.length, life: data.life.records.length, budgets: data.life.budgets.length, sessions: data.life.sessions.length, loans:data.library.loans.length, recipes:data.library.recipes.length, meals:data.library.meals.length } };
}
async function materialize(plan) {
  const fs = wx.getFileSystemManager(), root = wx.env.USER_DATA_PATH + '/note-images';
  const created = [], map = new Map();
  if (!plan.embedded.size) return { data: plan.data, created };
  try {
    try { fs.accessSync(root); } catch (error) { fs.mkdirSync(root, true); }
    for (const [original, base64] of plan.embedded) {
      const ext = (original.match(/\.(png|jpg|jpeg|gif|webp|heic)$/i) || ['', 'jpg'])[1].toLowerCase();
      const path = root + '/restore_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + '.' + ext;
      created.push(path);
      await new Promise((resolve, reject) => fs.writeFile({ filePath: path, data: base64, encoding: 'base64', success: resolve, fail: () => reject(new Error('照片恢复失败，请检查设备空间')) }));
      map.set(plan.replacements.get(original), path);
    }
    records(plan.data).forEach(r => { if (r.images) r.images = r.images.map(path => map.get(path) || path); });
    return { data: plan.data, created };
  } catch (error) { await media.remove(created); throw error; }
}
function exportDirectory() { return wx.env.USER_DATA_PATH + '/life-backups'; }
async function clearExports(keep) {
  const fs = wx.getFileSystemManager(), root = exportDirectory();
  if (typeof fs.readdir !== 'function') return;
  const names = await new Promise(resolve => fs.readdir({ dirPath: root, success: r => resolve(r.files), fail: () => resolve([]) }));
  for (const name of names) {
    if (!/^life_butler_backup_\d+\.json$/.test(name)) continue;
    const path = root + '/' + name;
    if (path !== keep) await new Promise(resolve => fs.unlink({ filePath: path, success: resolve, fail: resolve }));
  }
}
async function saveExport(text) {
  const fs = wx.getFileSystemManager(), root = exportDirectory();
  try { fs.accessSync(root); } catch (error) { fs.mkdirSync(root, true); }
  const name = 'life_butler_backup_' + Date.now() + '.json', path = root + '/' + name;
  await new Promise((resolve, reject) => fs.writeFile({ filePath: path, data: text, encoding: 'utf8', success: resolve, fail: () => reject(new Error('备份文件写入失败，请检查存储空间')) }));
  await clearExports(path); return { path, name };
}
module.exports = { build, inspect, materialize, paths, saveExport, clearExports };
