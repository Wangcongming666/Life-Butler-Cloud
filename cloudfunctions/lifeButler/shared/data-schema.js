const schedule=require('./schedule'), life=require('./life'), journal=require('./journal');
const MAX_CENTS=999999999;
function emptyData() { return { version: 1, todos: [], signins: [], expenses: [], notes: [], life: life.empty(), library: journal.empty(), preferences: journal.preferences(), schedule: schedule.empty() }; }
function validTime(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
function validate(data, imagePredicate) {
  const validateImages = images => checkImages(images, imagePredicate);
  if (!data || data.version !== 1 || !Array.isArray(data.todos) || !Array.isArray(data.expenses)) {
    throw new Error('本地数据格式异常，请先导出备份后处理');
  }
  // Daily app attendance is separate from habit records; old snapshots default to empty.
  data.signins = data.signins === undefined ? [] : data.signins;
  if (!Array.isArray(data.signins) || data.signins.length > 36600) throw new Error('签到记录格式异常');
  const signedDates = new Set();
  data.signins.forEach(record => {
    if (!record || record.id !== record.date || signedDates.has(record.date) || !validTime(record.createdAt)) throw new Error('签到记录异常');
    journal.date(record.date); signedDates.add(record.date);
  });
  const ids = new Set();
  data.todos.forEach(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 ||
        typeof item.done !== 'boolean' || !validTime(item.dueAt) || !validTime(item.createdAt)) {
      throw new Error('待办数据异常，请先导出原始数据');
    }
    ids.add(item.id);
    if (item.images !== undefined) validateImages(item.images);
    if (item.startAt !== undefined && (!validTime(item.startAt) || item.startAt > item.dueAt)) throw new Error('待办起始时间异常');
    if (item.doneAt !== undefined && !validTime(item.doneAt)) throw new Error('待办完成时间异常');
  });
  data.expenses.forEach(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
        !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 || item.amountCents > MAX_CENTS ||
        typeof item.category !== 'string' || !item.category || typeof item.note !== 'string' || item.note.length > 120 ||
        !validTime(item.createdAt) || (item.updatedAt !== undefined && !validTime(item.updatedAt))) {
      throw new Error('记账数据异常，请先导出原始数据');
    }
    ids.add(item.id);
  });
  data.notes = data.notes === undefined ? [] : data.notes;
  if (!Array.isArray(data.notes) || data.notes.length > 500) throw new Error('随记数据异常，请先导出原始数据');
  data.notes.forEach(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 ||
        typeof item.comment !== 'string' || item.comment.length > 2000 ||
        !(item.priceCents === null || (Number.isSafeInteger(item.priceCents) && item.priceCents >= 0 && item.priceCents <= MAX_CENTS)) ||
        !validTime(item.createdAt) || !validTime(item.updatedAt)) throw new Error('随记数据异常，请先导出原始数据');
    validateImages(item.images);
    ids.add(item.id);
  });
  // 兼容升级前的记录，只在内存补齐；下次主动保存时一起持久化。
  data.schedule = data.schedule === undefined ? schedule.empty() : schedule.validate(data.schedule);
  data.life = data.life === undefined ? life.empty() : life.validate(data.life, validateImages);
  data.library = data.library === undefined ? journal.empty() : journal.validate(data.library, validateImages);
  data.preferences = data.preferences === undefined ? journal.preferences() : journal.validatePreferences(data.preferences);
  return data;
}
function checkImages(images, predicate) {
  predicate=predicate || (p=>typeof p==='string' && p.startsWith('cloud://'));
  if(!Array.isArray(images)||images.length>6||new Set(images).size!==images.length||images.some(p=>!predicate(p))) throw Error('图片数据异常');
  return images.slice();
}
module.exports={emptyData,validate,validTime,checkImages};
