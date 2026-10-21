/**
 * 唯一的持久化入口。金额单位为整数分；时间为本地生成的毫秒时间戳。
 * 读取损坏数据时抛错，避免静默重置、覆盖原始记录。
 */
const KEY = 'life_butler_data_v1';
const sync = require('./sync');
const MAX_CENTS = 999999999; // 单笔最多 9,999,999.99 元
const schedule = require('./schedule');
const media = require('./media');
const life = require('./life');
const backup = require('./backup');
const journal = require('./journal');

function emptyData() { return { version: 1, todos: [], signins: [], expenses: [], notes: [], life: life.empty(), library: journal.empty(), preferences: journal.preferences(), schedule: schedule.empty() }; }
function validTime(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
function validate(data) {
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
function read() { return sync.getDefault().read(); }
async function write(data, options) { validate(data); return sync.getDefault().commit(data, options); }

function id() { return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12); }
function pad(value) { return String(value).padStart(2, '0'); }
function dateText(value) {
  const d = new Date(value);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function timeText(value) {
  const d = new Date(value);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function money(cents) { return (cents / 100).toFixed(2); }
/** 严格按十进制字符串转成整数分，不使用浮点金额相乘。 */
function parseMoney(text) {
  const input = String(text).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input)) throw new Error('请输入金额，最多两位小数');
  const parts = input.split('.');
  const cents = Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
  if (cents <= 0 || cents > MAX_CENTS) throw new Error('金额需大于 0，且不超过 9,999,999.99 元');
  return cents;
}
function validateImages(images) {
  if (!Array.isArray(images) || images.length > media.MAX_IMAGES || images.some(path => !media.isOwned(path)) || new Set(images).size !== images.length) throw new Error('图片数据异常，请先导出备份');
  return images.slice();
}
function cleanImages(paths, data) {
  const referenced = new Set();
  data.todos.forEach(todo => (todo.images || []).forEach(path => referenced.add(path)));
  data.notes.forEach(note => note.images.forEach(path => referenced.add(path)));
  data.life.records.forEach(record => record.images.forEach(path => referenced.add(path)));
  data.library.loans.concat(data.library.recipes).forEach(record => record.images.forEach(path => referenced.add(path)));
  media.remove((paths || []).filter(path => !referenced.has(path))).catch(() => {});
}
let checkinRequest = null;
function checkInToday(now) {
  if (checkinRequest) return checkinRequest;
  checkinRequest = Promise.resolve().then(async () => {
    const service = sync.getDefault(), checkin = require('./checkin');
    if (service.hasPending()) await service.pull({force: true});
    const timestamp = now === undefined ? Date.now() : now, date = journal.dayText(timestamp), data = read();
    if ((data.signins || []).some(record => record.date === date)) return Object.assign({created: false}, checkin.stats(data.signins, timestamp));
    data.signins = (data.signins || []).concat({id: date, date, createdAt: timestamp});
    try { await write(data, {fast: true}); }
    catch (error) {
      if (error.code !== 'CONFLICT') throw error;
      await service.pull({force: true});
      const fresh = read();
      if (!(fresh.signins || []).some(record => record.date === date)) throw error;
      return Object.assign({created: false}, checkin.stats(fresh.signins, timestamp));
    }
    return Object.assign({created: true}, checkin.stats(read().signins, timestamp));
  }).finally(() => { checkinRequest = null; });
  return checkinRequest;
}
async function saveTodo(input) {
  const data = read();
  const title = String(input.title || '').trim();
  if (!title || title.length > 80) throw new Error('请输入 1～80 字的待办事项');
  if (!validTime(input.dueAt)) throw new Error('请选择有效的截止时间');
  if (input.startAt !== undefined && (!validTime(input.startAt) || input.startAt > input.dueAt)) throw new Error('起始时间需有效且不能晚于截止时间');
  let previousImages = [];
  if (input.id) {
    const item = data.todos.find(todo => todo.id === input.id);
    if (!item) throw new Error('该待办已不存在');
    previousImages = item.images || [];
    item.title = title;
    item.dueAt = input.dueAt;
    if (input.startAt !== undefined) item.startAt = input.startAt;
    if (input.images !== undefined) item.images = validateImages(input.images);
  } else {
    const item = { id: id(), title, dueAt: input.dueAt, done: false, createdAt: Date.now(), images: validateImages(input.images || []) };
    if (input.startAt !== undefined) item.startAt = input.startAt;
    data.todos.push(item);
  }
  await write(data);
  cleanImages(previousImages, data);
}
async function saveTodoWithImages(input) {
  if (!String(input.title || '').trim() || String(input.title).trim().length > 80) throw new Error('请输入 1～80 字的待办事项');
  if (!validTime(input.dueAt)) throw new Error('请选择有效的截止时间');
  if (input.startAt !== undefined && (!validTime(input.startAt) || input.startAt > input.dueAt)) throw new Error('起始时间需有效且不能晚于截止时间');
  const data = read();
  const previous = input.id ? data.todos.find(todo => todo.id === input.id) : null;
  if (input.id && !previous) throw new Error('该待办已不存在');
  const existing = previous ? previous.images || [] : [];
  const prepared = await media.persist(input.images === undefined ? existing : input.images, existing);
  try { await saveTodo(Object.assign({}, input, { images: prepared.paths })); }
  catch (error) { await media.remove(prepared.created); throw error; }
}
async function toggleTodo(todoId, desiredDone) {
  const data = read();
  const item = data.todos.find(todo => todo.id === todoId);
  if (!item) throw new Error('该待办已不存在');
  const next = typeof desiredDone === 'boolean' ? desiredDone : !item.done;
  if (item.done === next) return;
  item.done = next;
  if (item.done) item.doneAt = Date.now(); else delete item.doneAt;
  await write(data, { fast: true });
}
async function removeTodo(todoId) {
  const data = read();
  const previous = data.todos.find(todo => todo.id === todoId);
  data.todos = data.todos.filter(todo => todo.id !== todoId);
  await write(data);
  if (previous) cleanImages(previous.images || [], data);
}
/** 先保存图片，再提交记录；失败回滚新文件，成功才清理被替换的原图。 */
async function saveNoteWithImages(input) {
  const initial = read();
  const previous = input.id ? initial.notes.find(note => note.id === input.id) : null;
  if (input.id && !previous) throw new Error('该随记已不存在');
  if (!previous && initial.notes.length >= 500) throw new Error('最多保存 500 条随记');
  const title = String(input.title || '').trim(), comment = String(input.comment || '').trim();
  const existing = previous ? previous.images : [];
  const images = input.images === undefined ? existing : input.images;
  if (!title && !comment && (!Array.isArray(images) || !images.length)) throw new Error('请添加图片或写点内容');
  if (title.length > 80 || comment.length > 2000) throw new Error('标题最多 80 字，评论最多 2000 字');
  const price = String(input.price === undefined ? '' : input.price).trim();
  const priceCents = price === '' ? null : /^0(?:\.0{1,2})?$/.test(price) ? 0 : parseMoney(price);
  const prepared = await media.persist(images, existing, 'note');
  try {
    // 异步选图期间其他页面可能发生写入，提交前重新读取，避免覆盖。
    const data = read(), index = input.id ? data.notes.findIndex(note => note.id === input.id) : -1;
    if (input.id && index < 0) throw new Error('该随记已不存在');
    if (!input.id && data.notes.length >= 500) throw new Error('最多保存 500 条随记');
    const note = { id: previous ? previous.id : id(), title: title || '随手记录', comment, priceCents,
      images: validateImages(prepared.paths), createdAt: previous ? previous.createdAt : Date.now(), updatedAt: Date.now() };
    if (index >= 0) data.notes[index] = note;
    else data.notes.push(note);
    await write(data);
    cleanImages(existing, data);
  } catch (error) { await media.remove(prepared.created); throw error; }
}
async function removeNote(noteId) {
  const data = read(), previous = data.notes.find(note => note.id === noteId);
  data.notes = data.notes.filter(note => note.id !== noteId);
  await write(data);
  if (previous) cleanImages(previous.images, data);
}
function expenseFields(input, originalTime) {
  const amountCents = parseMoney(input.amount);
  const note = String(input.note || '').trim();
  const category = String(input.category || '').trim();
  if (note.length > 120) throw new Error('备注最多 120 字');
  if (!category || category.length > 20) throw new Error('请选择分类，分类名称最多 20 字');
  const createdAt = input.createdAt === undefined ? (originalTime === undefined ? Date.now() : originalTime) : input.createdAt;
  if (!validTime(createdAt)) throw new Error('请选择有效的记账时间');
  return { amountCents, category, note, createdAt };
}
async function addExpense(input) {
  const data = read();
  data.expenses.push(Object.assign({ id: id() }, expenseFields(input), { updatedAt: Date.now() }));
  await write(data);
}
/** 原位更新，保留编号；未传入记账时间时保留原始时间戳。 */
async function updateExpense(expenseId, input) {
  const data = read();
  const index = data.expenses.findIndex(item => item.id === expenseId);
  if (index < 0) throw new Error('该账目已不存在，请刷新后重试');
  data.expenses[index] = Object.assign({}, data.expenses[index], expenseFields(input, data.expenses[index].createdAt), { updatedAt: Date.now() });
  await write(data);
}
async function removeExpense(expenseId) {
  const data = read();
  data.expenses = data.expenses.filter(item => item.id !== expenseId);
  await write(data);
}
/** 按设备本地时区确定月份，不用 UTC 字符串截取。 */
function monthExpenses(data, now) {
  const date = new Date(now === undefined ? Date.now() : now);
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  return data.expenses.filter(item => item.createdAt >= start && item.createdAt < end);
}
function stats(data) {
  const month = monthExpenses(data);
  const completed = data.todos.filter(item => item.done).length;
  return {
    totalTodos: data.todos.length,
    noteCount: (data.notes || []).length,
    completedTodos: completed,
    pendingTodos: data.todos.length - completed,
    expenseCount: data.expenses.length,
    monthCount: month.length,
    monthTotal: money(month.reduce((sum, item) => sum + item.amountCents, 0)),
    totalExpense: money(data.expenses.reduce((sum, item) => sum + item.amountCents, 0))
  };
}
/** 不校验原始数据，异常记录也能导出，以便人工恢复。 */
function exportJSON() { return JSON.stringify({app:'生活管家',exportedAt:new Date().toISOString(),data:read()},null,2); }
/** 只重置本应用的业务数据，不影响开发工具或其他本地键。 */
async function clear() { const data=read(); Object.assign(data,emptyData()); await write(data,{replace:true}); await backup.clearExports(); }

async function saveTerm(input) {
  const data = read();
  data.schedule = schedule.validate(Object.assign({}, data.schedule, {
    termName: String(input.termName || '').trim(), termStart: input.termStart, totalWeeks: input.totalWeeks
  }));
  await write(data);
}
async function saveCourse(input) {
  const data = read();
  const course = schedule.normalize(input, data.schedule.totalWeeks);
  if (input.id) {
    const index = data.schedule.courses.findIndex(item => item.id === input.id);
    if (index < 0) throw new Error('该课程已不存在');
    data.schedule.courses[index] = course;
  } else {
    if (data.schedule.courses.length >= 300) throw new Error('最多保存 300 条上课安排');
    course.id = id();
    data.schedule.courses.push(course);
  }
  await write(data);
}
async function removeCourse(courseId) {
  const data = read();
  data.schedule.courses = data.schedule.courses.filter(course => course.id !== courseId);
  await write(data);
}
async function importCourses(courses, mode, metadata) {
  const data = read();
  if (!['append', 'replace'].includes(mode)) throw new Error('请选择追加或替换导入');
  if (!Array.isArray(courses) || !courses.length || courses.length > 300) throw new Error('导入数量应为 1～300 条');
  const merged = new Map();
  if (mode === 'append') data.schedule.courses.forEach(course => merged.set(schedule.fingerprint(course), course));
  courses.forEach(item => {
    const course = schedule.normalize(item, data.schedule.totalWeeks);
    const key = schedule.fingerprint(course);
    if (!merged.has(key)) merged.set(key, Object.assign({}, course, { id: id() }));
  });
  if (merged.size > 300) throw new Error('合并后超过 300 条，请减少课程');
  data.schedule.courses = Array.from(merged.values());
  if (metadata) {
    if (metadata.termName) data.schedule.termName = metadata.termName;
    if (metadata.periodTimes && metadata.periodTimes.length) data.schedule.periodTimes = metadata.periodTimes;
  }
  await write(data); // 全部校验完成后仅写一次，失败不会部分覆盖。
}
async function saveExam(input) {
  const data = read();
  // 复用课表校验保证新增与编辑有同一套验证规则。
  const examId = input.id || id();
  if (input.id) {
    const index = data.schedule.exams.findIndex(exam => exam.id === input.id);
    if (index < 0) throw new Error('考试安排已不存在');
    data.schedule.exams[index] = Object.assign({}, input, { id: examId });
  } else {
    if (data.schedule.exams.length >= 200) throw new Error('最多保存 200 条考试安排');
    data.schedule.exams.push(Object.assign({}, input, { id: examId }));
  }
  await write(data);
}
async function removeExam(examId) {
  const data = read();
  data.schedule.exams = data.schedule.exams.filter(exam => exam.id !== examId);
  await write(data);
}

async function saveLifeRecord(input) {
  const fields = life.normalize(input), initial = read();
  const old = input.id ? initial.life.records.find(r => r.id === input.id) : null;
  if (input.id && (!old || old.type !== fields.type)) throw new Error('记录已不存在或类型不符');
  const existing = old ? old.images : [];
  const prepared = await media.persist(input.images === undefined ? existing : input.images, existing, 'note');
  try {
    const data = read(), index = input.id ? data.life.records.findIndex(r => r.id === input.id) : -1;
    if (input.id && index < 0) throw new Error('记录已不存在');
    if (!input.id && data.life.records.length >= 2000) throw new Error('生活记录最多2000条');
    const previous = index >= 0 ? data.life.records[index] : null;
    const record = Object.assign({}, fields, { id: previous ? previous.id : id(), images: validateImages(prepared.paths),
      done: previous ? previous.done : false, checkins: previous ? previous.checkins : [], createdAt: previous ? previous.createdAt : Date.now(), updatedAt: Date.now() });
    if (index >= 0) data.life.records[index] = record; else data.life.records.push(record);
    await write(data); cleanImages(existing, data);
    return record.id;
  } catch (error) { await media.remove(prepared.created); throw error; }
}
async function removeLifeRecord(recordId) {
  const data = read(), old = data.life.records.find(r => r.id === recordId);
  data.life.records = data.life.records.filter(r => r.id !== recordId);
  await write(data); if (old) cleanImages(old.images, data);
}
async function toggleLifeRecord(recordId) {
  const data = read(), record = data.life.records.find(r => r.id === recordId);
  if (!record) throw new Error('记录已不存在');
  record.done = !record.done; record.updatedAt = Date.now(); await write(data);
}
async function toggleCheckin(recordId, date) {
  life.day(date); if (date > life.today()) throw new Error('不能提前打卡');
  const data = read(), record = data.life.records.find(r => r.id === recordId && r.type === 'habits');
  if (!record) throw new Error('习惯已不存在');
  record.checkins = record.checkins.includes(date) ? record.checkins.filter(d => d !== date) : record.checkins.concat(date).sort();
  record.updatedAt = Date.now(); await write(data);
}
async function noteToShopping(noteId) {
  const data = read(), note = data.notes.find(n => n.id === noteId);
  if (!note) throw new Error('随记已不存在');
  const previous = data.life.records.find(r => r.type === 'shopping' && r.sourceNoteId === noteId);
  if (previous) return previous.id;
  const record = Object.assign(life.normalize({ type: 'shopping', title: note.title, note: note.comment,
    sourceNoteId: noteId, amount: note.priceCents === null ? '' : money(note.priceCents) }),
  { id: id(), images: note.images.slice(), done: false, checkins: [], createdAt: Date.now(), updatedAt: Date.now() });
  data.life.records.push(record); await write(data); return record.id;
}
async function saveBudget(input) {
  life.day(input.month + '-01');
  const totalCents = life.cents(input.total);
  if (totalCents === null) throw new Error('请输入月度预算');
  if (!Array.isArray(input.categories)) throw new Error('分类预算格式错误');
  const categories = input.categories.map(c => ({ name: String(c.name || '').trim(), cents: life.cents(c.amount) }));
  const entry = life.validateBudget({ month: input.month, totalCents, categories });
  const data = read();
  const index = data.life.budgets.findIndex(b => b.month === input.month);
  if (index >= 0) data.life.budgets[index] = entry; else data.life.budgets.push(entry);
  await write(data);
}
async function removeBudget(month) { const data = read(); data.life.budgets = data.life.budgets.filter(b => b.month !== month); await write(data); }
async function startTimer(mode, minutes, now) {
  const seconds = Number(minutes) * 60, time = now === undefined ? Date.now() : now, data = read();
  if (data.life.timer) throw new Error('请先结束当前计时');
  data.life.timer = { id: id(), mode, seconds, remaining: seconds, status: 'running', endAt: time + seconds * 1000 };
  await write(data);
}
async function pauseTimer(now) {
  const time = now === undefined ? Date.now() : now; await settleTimer(time);
  const data = read(), t = data.life.timer;
  if (!t || t.status !== 'running') return;
  t.remaining = Math.max(0, Math.ceil((t.endAt - time) / 1000)); t.status = 'paused'; await write(data);
}
async function resumeTimer(now) {
  const data = read(), t = data.life.timer;
  if (!t || t.status !== 'paused') return;
  t.endAt = (now === undefined ? Date.now() : now) + t.remaining * 1000; t.status = 'running'; await write(data);
}
async function settleTimer(now) {
  const data = read(), t = data.life.timer, time = now === undefined ? Date.now() : now;
  if (!t || t.status !== 'running' || time < t.endAt) return null;
  if (!data.life.sessions.some(s => s.id === t.id)) data.life.sessions.push({ id: t.id, mode: t.mode, seconds: t.seconds, finishedAt: t.endAt });
  data.life.sessions = data.life.sessions.slice(-5000); data.life.timer = null;
  try { await write(data); return t.mode; }
  catch(error){
    if(error.code==='CONFLICT'){await sync.getDefault().pull({force:true});if(read().life.sessions.some(s=>s.id===t.id))return null;}
    throw error;
  }
}
async function cancelTimer() { const data = read(); data.life.timer = null; await write(data); }
async function saveLibraryRecord(kind, input) {
  const fields = journal.normalize(kind,input), before = read(), old = input.id ? before.library[kind].find(r=>r.id===input.id) : null;
  if (input.id && !old) throw new Error('记录已不存在');
  const existing = old ? old.images : [], prepared = await media.persist(input.images === undefined ? existing : input.images,existing,'note');
  try {
    const data = read(), list = data.library[kind], index = input.id ? list.findIndex(r=>r.id===input.id) : -1;
    if (input.id && index < 0) throw new Error('记录已不存在');
    const original = index >= 0 ? list[index] : null;
    const record = Object.assign({},fields,{ id: original ? original.id : id(), images:validateImages(prepared.paths), createdAt:original ? original.createdAt : Date.now(), updatedAt:Date.now() });
    if (kind === 'loans') record.returnedAt = original ? original.returnedAt : null;
    if (index >= 0) list[index] = record; else list.push(record);
    await write(data); cleanImages(existing,data); return record.id;
  } catch (error) { await media.remove(prepared.created); throw error; }
}
async function removeLibraryRecord(kind, recordId) {
  if (!['loans','recipes'].includes(kind)) throw new Error('记录类型无效');
  const data=read(), old=data.library[kind].find(r=>r.id===recordId);
  data.library[kind]=data.library[kind].filter(r=>r.id!==recordId); await write(data);
  if(old) cleanImages(old.images,data);
}
async function toggleReturn(recordId) {
  const data=read(), record=data.library.loans.find(r=>r.id===recordId);
  if(!record) throw new Error('借还记录已不存在');
  record.returnedAt = record.returnedAt === null ? Date.now() : null; record.updatedAt=Date.now(); await write(data);
}
async function saveMeal(input) {
  const data=read(); journal.date(input.date);
  if(!journal.SLOTS.includes(input.slot)) throw new Error('请选择餐次');
  const recipe=input.recipeId ? data.library.recipes.find(r=>r.id===input.recipeId) : null;
  if(input.recipeId && !recipe) throw new Error('菜谱已删除，请重新选择或填写餐食名称');
  const original=input.id?data.library.meals.find(m=>m.id===input.id):null;
  if(input.id&&!original)throw new Error('这餐安排已不存在');
  const target=data.library.meals.find(m=>m.date===input.date && m.slot===input.slot);
  const meal={id:original?original.id:target?target.id:id(),date:input.date,slot:input.slot,recipeId:recipe?recipe.id:'',title:recipe?recipe.title:String(input.title||'').trim(),note:String(input.note||'').trim(),updatedAt:Date.now()};
  data.library.meals=data.library.meals.filter(m=>m.id!==meal.id && !(m.date===input.date&&m.slot===input.slot));
  data.library.meals.push(meal);await write(data);
}
async function removeMeal(mealId) { const data=read();data.library.meals=data.library.meals.filter(m=>m.id!==mealId);await write(data); }
async function recipeToShopping(recipeId) {
  const data=read(), recipe=data.library.recipes.find(r=>r.id===recipeId);
  if(!recipe)throw new Error('菜谱已不存在');
  let count=0;
  recipe.ingredients.forEach(i=>{
    if(data.life.records.some(r=>r.type==='shopping' && !r.done && r.sourceRecipeId===recipeId && r.title===i.name))return;
    const fields=life.normalize({type:'shopping',title:i.name,note:'菜谱：'+recipe.title+(i.quantity?' · 用量：'+i.quantity:''),sourceRecipeId:recipeId});
    data.life.records.push(Object.assign(fields,{id:id(),images:[],done:false,checkins:[],createdAt:Date.now(),updatedAt:Date.now()}));count++;
  });
  await write(data);return count;
}
async function savePreferences(input) { const data=read();data.preferences=journal.validatePreferences(Object.assign({},data.preferences,input));await write(data); }
async function createBackup() { return backup.build(read()); }
async function exportBackupFile() { return backup.saveExport(await createBackup()); }
function previewBackup(text) {
  const plan = backup.inspect(text, validate);
  return { counts: plan.counts, images: plan.images, missing: plan.missing };
}
async function restoreBackup(text) {
  const plan = backup.inspect(text, validate);
  const target = read();
  let oldPaths = [];
  try { oldPaths = backup.paths(read()); } catch (error) { /* 损坏原数据仍允许通过明确确认恢复。 */ }
  const prepared = await backup.materialize(plan);
  try {
    await media.uploadData(prepared.data);
    // 不让旧设备运行中的计时器在本机意外完成；仅恢复已完成记录。
    prepared.data.life.timer = null;
    Object.assign(target, prepared.data); await write(target, {replace:true}); cleanImages(oldPaths, prepared.data);
  } catch (error) { await media.remove(prepared.created); throw error; }
}

module.exports = { read, checkInToday, saveTodo, saveTodoWithImages, toggleTodo, removeTodo, addExpense, updateExpense, removeExpense,
  monthExpenses, stats, exportJSON, clear, dateText, timeText, money, parseMoney,
  saveTerm, saveCourse, removeCourse, importCourses, saveExam, removeExam, saveNoteWithImages, removeNote,
  saveLifeRecord, removeLifeRecord, toggleLifeRecord, toggleCheckin, noteToShopping, saveBudget, removeBudget,
  startTimer, pauseTimer, resumeTimer, settleTimer, cancelTimer, createBackup, previewBackup, restoreBackup, exportBackupFile,
  saveLibraryRecord, removeLibraryRecord, toggleReturn, saveMeal, removeMeal, recipeToShopping, savePreferences };

// 待确认提交属于原表单。恢复后同一表单的重试完成原操作，不能再生成新记录。
const pendingForms=new Map();
function signature(value){
  if(Array.isArray(value))return '['+value.map(signature).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+signature(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const mutationNames=['saveTodo','saveTodoWithImages','toggleTodo','removeTodo','addExpense','updateExpense','removeExpense','clear','saveTerm','saveCourse','removeCourse','importCourses','saveExam','removeExam','saveNoteWithImages','removeNote','saveLifeRecord','removeLifeRecord','toggleLifeRecord','toggleCheckin','noteToShopping','saveBudget','removeBudget','startTimer','pauseTimer','resumeTimer','settleTimer','cancelTimer','restoreBackup','saveLibraryRecord','removeLibraryRecord','toggleReturn','saveMeal','removeMeal','recipeToShopping','savePreferences'];
mutationNames.forEach(name=>{
  const operation=module.exports[name];
  module.exports[name]=async function(...args){
    const service=sync.getDefault(),owner=service.owner(),key=owner+':'+name+':'+signature(args),receipt=pendingForms.get(key);
    if(service.hasPending()||receipt){
      await service.pull({force:true});
      if(service.owner()!==owner)throw Error('微信账号已变化，请重新打开表单');
      if(receipt){pendingForms.delete(key);return receipt.result;}
    }
    if(name==='toggleTodo'&&typeof args[1]==='boolean'){
      // 用户已明确发出相反意图，旧勾选回执不能再拦截后续同值操作。
      for(const [previousKey,previous] of pendingForms){if(previous.owner===owner&&previous.method===name&&previous.recordId===args[0])pendingForms.delete(previousKey);}
    }
    try{return await operation(...args);}
    catch(error){
      if(error.code==='PENDING_CONFIRMATION'){
        const changes=service.pendingChanges(),created=changes.filter(c=>c.expectedVersion===0&&c.value!==null);let result;
        if(['saveLifeRecord','saveLibraryRecord','noteToShopping'].includes(name)){const kind=name==='saveLibraryRecord'?args[0]:'lifeRecords',record=changes.find(c=>c.kind===kind&&c.value);result=record?record.id:name==='saveLibraryRecord'?args[1]&&args[1].id:args[0]&&args[0].id;}
        if(name==='recipeToShopping')result=created.filter(c=>c.kind==='lifeRecords').length;
        if(name==='settleTimer')result=null;
        pendingForms.set(key,{result,owner,method:name,recordId:name==='toggleTodo'?args[0]:undefined});
      }
      throw error;
    }
  };
});
