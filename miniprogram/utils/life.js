/** 本地生活记录的纯验证和计算，不执行存储或网络操作。 */
const DAY = 86400000;
const TYPES = ['homework', 'assets', 'shopping', 'habits', 'countdown', 'expiry'];
const TITLES = { homework: '课程作业', assets: '物品与保修', shopping: '购物清单', habits: '习惯打卡', countdown: '纪念日与倒数日', expiry: '保质期管理', budget: '月度预算' };
function empty() { return { records: [], budgets: [], sessions: [], timer: null }; }
function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期');
  const [y, m, d] = value.split('-').map(Number), time = new Date(Date.UTC(y, m - 1, d));
  if (y < 1000 || time.getUTCFullYear() !== y || time.getUTCMonth() !== m - 1 || time.getUTCDate() !== d) throw new Error('日期不存在');
  return time.getTime();
}
function today(now) {
  const d = new Date(now === undefined ? Date.now() : now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function text(value, limit, label, required) {
  const result = String(value || '').trim();
  if ((required && !result) || result.length > limit) throw new Error(label + (required ? '不能为空，且' : '') + '最多' + limit + '字');
  return result;
}
function cents(value) {
  const s = String(value === undefined ? '' : value).trim();
  if (!s) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw new Error('金额应为非负数，最多两位小数');
  const parts = s.split('.');
  return Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
}
function normalize(input) {
  if (!TYPES.includes(input.type)) throw new Error('记录类型无效');
  const date = input.date || '', purchaseDate = input.purchaseDate || '';
  if (date) day(date);
  if (purchaseDate) day(purchaseDate);
  if (['homework', 'countdown', 'expiry'].includes(input.type) && !date) throw new Error('请选择日期');
  if (input.type === 'assets' && date && purchaseDate && date < purchaseDate) throw new Error('保修结束日期不能早于购买日期');
  const quantity = input.quantity === undefined || input.quantity === '' ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('数量范围为1～9999');
  const time = input.time || '23:59';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效时间');
  return { type: input.type, title: text(input.title, 80, '名称', true), note: text(input.note, 2000, '备注'),
    date, time, purchaseDate, place: text(input.place, 100, '存放位置'), amountCents: cents(input.amount), quantity,
    courseId: text(input.courseId, 100, '课程编号'), courseTitle: text(input.courseTitle, 80, '课程名称'),
    sourceNoteId: text(input.sourceNoteId, 100, '随记编号'), sourceRecipeId: text(input.sourceRecipeId,100,'菜谱编号') };
}
function validate(value, imageCheck) {
  if (!value || !Array.isArray(value.records) || value.records.length > 2000 || !Array.isArray(value.budgets) || value.budgets.length > 120 || !Array.isArray(value.sessions) || value.sessions.length > 5000) throw new Error('生活记录数据格式异常');
  const ids = new Set();
  value.records.forEach(r => {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.done !== 'boolean' || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || !Array.isArray(r.checkins) || r.checkins.length > 36600 || new Set(r.checkins).size !== r.checkins.length) throw new Error('生活记录格式异常');
    normalize(Object.assign({}, r, { amount: r.amountCents === null ? '' : (r.amountCents / 100).toFixed(2) }));
    if (!(r.amountCents === null || Number.isSafeInteger(r.amountCents) && r.amountCents >= 0 && r.amountCents <= 999999999)) throw new Error('记录金额异常');
    r.checkins.forEach(day);
    imageCheck(r.images); ids.add(r.id);
  });
  const months = new Set();
  value.budgets.forEach(b => {
    if (!b || !/^\d{4}-\d{2}$/.test(b.month) || months.has(b.month) || !Number.isSafeInteger(b.totalCents) || b.totalCents < 0 || b.totalCents > 999999999 || !Array.isArray(b.categories) || b.categories.length > 30) throw new Error('预算数据异常');
    day(b.month + '-01'); months.add(b.month);
    const names = new Set();
    b.categories.forEach(c => {
      if (!c || !text(c.name, 20, '分类', true) || names.has(c.name) || !Number.isSafeInteger(c.cents) || c.cents < 0 || c.cents > 999999999) throw new Error('分类预算异常');
      names.add(c.name);
    });
  });
  const sessionIds = new Set();
  value.sessions.forEach(s => {
    if (!s || typeof s.id !== 'string' || sessionIds.has(s.id) || !['focus', 'break'].includes(s.mode) || !Number.isInteger(s.seconds) || s.seconds < 60 || s.seconds > 10800 || !Number.isSafeInteger(s.finishedAt) || s.finishedAt < 0) throw new Error('专注记录异常');
    sessionIds.add(s.id);
  });
  const t = value.timer;
  if (t !== null && (!t || typeof t.id !== 'string' || !['focus', 'break'].includes(t.mode) || !['running', 'paused'].includes(t.status) || !Number.isInteger(t.seconds) || t.seconds < 60 || t.seconds > 10800 || !Number.isInteger(t.remaining) || t.remaining < 0 || t.remaining > t.seconds || !Number.isSafeInteger(t.endAt) || t.endAt < 0)) throw new Error('计时数据异常');
  return value;
}
// Keep snapshot validation compatible with old records; enforce allocations on new writes.
function validateBudget(entry) {
  validate({records: [], budgets: [entry], sessions: [], timer: null}, () => {});
  const allocated = entry.categories.reduce((sum, category) => sum + category.cents, 0);
  if (allocated > entry.totalCents) {
    throw new Error('分类预算合计 ¥' + (allocated / 100).toFixed(2) + '，不能超过总预算 ¥' + (entry.totalCents / 100).toFixed(2));
  }
  return entry;
}
function daysUntil(date, now) { return Math.round((day(date) - day(today(now))) / DAY); }
function streak(checkins, now) {
  const set = new Set(checkins), base = day(today(now));
  let time = set.has(today(now)) ? base : base - DAY, total = 0;
  while (set.has(new Date(time).toISOString().slice(0, 10))) { total++; time -= DAY; }
  return total;
}
function calendar(month, checkins, now) {
  const start = day(month + '-01'), d = new Date(start), offset = (d.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(), cells = [];
  for (let n = 0; n < offset; n++) cells.push({ key: 'blank' + n, blank: true });
  for (let n = 1; n <= count; n++) {
    const date = month + '-' + String(n).padStart(2, '0');
    cells.push({ key: date, date, label: n, checked: checkins.includes(date), future: date > today(now), isToday: date === today(now) });
  }
  return cells;
}
function budget(data, month) {
  day(month + '-01');
  const record = data.life.budgets.find(b => b.month === month), expenses = data.expenses.filter(e => today(e.createdAt).slice(0, 7) === month);
  const spent = expenses.reduce((sum, e) => sum + e.amountCents, 0), total = record ? record.totalCents : null;
  const names = new Set(expenses.map(e => e.category));
  if (record) record.categories.forEach(c => names.add(c.name));
  return { spent, total, remaining: total === null ? null : total - spent,
    percent: total ? Math.min(100, Math.round(spent / total * 100)) : spent ? 100 : 0,
    categories: Array.from(names).map(name => {
      const limit = record && record.categories.find(c => c.name === name);
      const used = expenses.filter(e => e.category === name).reduce((sum, e) => sum + e.amountCents, 0);
      return { name, spent: used, limit: limit ? limit.cents : null, over: limit ? used > limit.cents : false };
    }).sort((a, b) => b.spent - a.spent) };
}
function alerts(data, now) {
  return data.life.records.filter(r => !r.done && r.date && ['homework', 'countdown', 'expiry', 'assets'].includes(r.type)).map(r => {
    const delta = daysUntil(r.date, now);
    return { id: r.id, type: r.type, title: r.title, delta, message: TITLES[r.type] + ' · ' + (delta < 0 ? '已过 ' + -delta + ' 天' : delta === 0 ? '就是今天' : '还有 ' + delta + ' 天') };
  }).filter(r => r.delta <= 7 && (r.type === 'countdown' ? r.delta >= 0 : true)).sort((a, b) => a.delta - b.delta);
}
function search(data, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const results = [], add = (items, kind, route, description) => items.forEach(item => {
    const detail = description(item), title = item.title || item.category;
    if ((title + ' ' + detail).toLowerCase().includes(q)) results.push({ key: kind + item.id, id: item.id, kind, title, detail, route: route(item) });
  });
  add(data.todos, '待办', () => '/pages/todo/index', r => r.done ? '已完成' : '未完成');
  add(data.notes, '随记', () => '/pages/notes/index', r => r.comment);
  add(data.expenses, '记账', () => '/pages/account/index', r => r.note + ' ¥' + (r.amountCents / 100).toFixed(2));
  add(data.schedule.courses, '课程', () => '/pages/schedule/index', r => r.teacher + ' ' + r.location);
  add(data.schedule.exams, '考试', () => '/pages/schedule/index?section=exams', r => r.date + ' ' + r.location + ' ' + (r.note || ''));
  add(data.life.records, '生活', r => '/pages/life/index?type=' + r.type, r => TITLES[r.type] + ' ' + r.note + ' ' + r.place + ' ' + r.courseTitle + ' ' + r.date);
  add(data.library.loans,'借还',()=>'/pages/loans/index',r=>r.person+' '+r.note+' '+r.borrowDate);
  add(data.library.recipes,'菜谱',()=>'/pages/food/index',r=>r.category+' '+r.note+' '+r.ingredients.map(i=>i.name).join(' '));
  add(data.library.meals,'饮食',r=>'/pages/food/index?date='+r.date,r=>r.date+' '+r.note);
  return results;
}
module.exports = { TYPES, TITLES, empty, day, today, cents, normalize, validate, validateBudget, daysUntil, streak, calendar, budget, alerts, search };
