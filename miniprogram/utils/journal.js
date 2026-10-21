/** 个人生活内容模型、设置以及基于真实本地记录的回顾。 */
const DAY = 86400000;
const MANAGERS = ['checkin','homework','assets','shopping','budget','habits','focus','countdown','expiry','search','backup','loans','food','review','timeline','settings'];
const SLOTS = ['breakfast','lunch','dinner'];
const SLOT_NAMES = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
function empty() { return { loans: [], recipes: [], meals: [] }; }
function preferences() { return { theme: 'mint', dark: false, font: 'normal', favorites: [], showReminders: true }; }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('请选择有效日期');
  const [y,m,d] = value.split('-').map(Number), t = new Date(Date.UTC(y,m-1,d));
  if (y < 1000 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m-1 || t.getUTCDate() !== d) throw Error('日期不存在');
  return t.getTime();
}
function dayText(now) { const d = new Date(now === undefined ? Date.now() : now); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function text(v, max, label, required) { if (typeof v !== 'string' || v.length > max || required && !v.trim()) throw Error(label + '格式错误，最多' + max + '字'); return v.trim(); }
function time(t) { return Number.isSafeInteger(t) && t >= 0 && t <= 8640000000000000; }
function normalize(kind, input) {
  const title = text(input.title || '', 80, '名称', true), note = text(input.note || '', 2000, '备注');
  if (kind === 'loans') {
    if (!['in','out'].includes(input.direction)) throw Error('请选择借入或借出');
    date(input.borrowDate); if (input.dueDate) date(input.dueDate);
    if (input.dueDate && input.dueDate < input.borrowDate) throw Error('归还日期不能早于借用日期');
    return { title, note, direction: input.direction, person: text(input.person || '',80,'对方姓名',true), borrowDate: input.borrowDate, dueDate: input.dueDate || '' };
  }
  if (kind !== 'recipes') throw Error('记录类型无效');
  if (!Array.isArray(input.ingredients) || !input.ingredients.length || input.ingredients.length > 80) throw Error('请填写1～80种食材');
  const ingredients = input.ingredients.map(i => ({ name: text(i.name,80,'食材名称',true), quantity: text(i.quantity || '',40,'食材用量') }));
  const servings = Number(input.servings || 1);
  if (!Number.isInteger(servings) || servings < 1 || servings > 30) throw Error('份数范围为1～30');
  return { title, note, ingredients, servings, category: text(input.category || '家常菜',20,'菜谱分类',true), steps: text(input.steps || '',5000,'做法',true) };
}
function validatePreferences(input) {
  if (!input || !['mint','blue','rose'].includes(input.theme) || typeof input.dark !== 'boolean' || !['normal','large'].includes(input.font) || typeof input.showReminders !== 'boolean' || !Array.isArray(input.favorites) || input.favorites.length > MANAGERS.length || new Set(input.favorites).size !== input.favorites.length || input.favorites.some(v => !MANAGERS.includes(v))) throw Error('个性化设置格式异常');
  return input;
}
function validate(value, imageCheck) {
  if (!value || !Array.isArray(value.loans) || !Array.isArray(value.recipes) || !Array.isArray(value.meals) || value.loans.length > 1000 || value.recipes.length > 500 || value.meals.length > 2000) throw Error('个人生活数据格式异常');
  const ids = new Set();
  for (const kind of ['loans','recipes']) value[kind].forEach(r => {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !time(r.createdAt) || !time(r.updatedAt)) throw Error('个人记录编号或时间异常');
    normalize(kind,r); imageCheck(r.images); ids.add(r.id);
    if (kind === 'loans' && r.returnedAt !== null && !time(r.returnedAt)) throw Error('归还时间异常');
  });
  const slots = new Set();
  value.meals.forEach(m => {
    if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id) || !SLOTS.includes(m.slot) || !time(m.updatedAt)) throw Error('饮食安排格式异常');
    date(m.date); text(m.title,80,'餐食',true); text(m.recipeId,100,'菜谱编号'); text(m.note,500,'饮食备注');
    const key = m.date + m.slot; if (slots.has(key)) throw Error('同一天同一餐次不能重复安排');
    slots.add(key); ids.add(m.id);
  });
  return value;
}
function parseIngredients(textValue) {
  return String(textValue || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(.+?)\s+([^\s]+)$/); return match ? { name: match[1], quantity: match[2] } : { name: line, quantity: '' };
  });
}
function period(mode, anchor) {
  const t = date(anchor), d = new Date(t);
  if (mode === 'week') { const start = t - ((d.getUTCDay()+6)%7)*DAY; return { start: new Date(start).toISOString().slice(0,10), end: new Date(start+6*DAY).toISOString().slice(0,10) }; }
  if (mode !== 'month') throw Error('请选择周回顾或月回顾');
  return { start: anchor.slice(0,7)+'-01', end: new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10) };
}
function timeline(data, options) {
  const events = [], add = (id, kind, title, detail, at, images, route, dateOnly) => {
    if (!time(at)) return;
    events.push({ id, kind, title, detail: detail || '', at, date: dayText(at), images: images || [], route, dateOnly: !!dateOnly });
  };
  data.todos.forEach(r => { add('todo'+r.id,'待办',r.title,'创建待办',r.createdAt,r.images,'/pages/todo/index'); if (r.done && time(r.doneAt)) add('done'+r.id,'待办',r.title,'完成待办',r.doneAt,r.images,'/pages/todo/index'); });
  data.notes.forEach(r => add('note'+r.id,'随记',r.title,r.comment,r.createdAt,r.images,'/pages/notes/index?id='+encodeURIComponent(r.id)));
  data.expenses.forEach(r => add('expense'+r.id,'记账',r.category,'支出 ¥'+(r.amountCents/100).toFixed(2)+' '+r.note,r.createdAt,[],'/pages/account/index'));
  const names = {homework:'作业',assets:'物品',shopping:'购物',habits:'习惯',countdown:'纪念日',expiry:'保质期'};
  data.life.records.forEach(r => {
    add('life'+r.id,'生活',r.title,(names[r.type]||'')+' · '+r.note,r.createdAt,r.images,'/pages/life/index?type='+r.type+'&id='+encodeURIComponent(r.id));
    r.checkins.forEach(dateText => {
      const [y,m,d] = dateText.split('-').map(Number);
      add('checkin'+r.id+dateText,'打卡',r.title,'习惯打卡',new Date(y,m-1,d,12).getTime(),[],'/pages/life/index?type=habits&id='+encodeURIComponent(r.id),true);
    });
  });
  data.life.sessions.filter(s => s.mode === 'focus').forEach(s => add('focus'+s.id,'专注','完成一段专注',s.seconds/60+' 分钟',s.finishedAt,[],'/pages/focus/index'));
  data.library.recipes.forEach(r => add('recipe'+r.id,'菜谱',r.title,r.category+' · '+r.note,r.createdAt,r.images,'/pages/food/index?id='+encodeURIComponent(r.id)));
  data.library.loans.forEach(r => { const detail = (r.direction === 'out' ? '借给 ' : '向对方借入 · ')+r.person; add('loan'+r.id,'借还',r.title,detail,r.createdAt,r.images,'/pages/loans/index?id='+encodeURIComponent(r.id)); if (r.returnedAt !== null) add('return'+r.id,'借还',r.title,'已归还 · '+r.person,r.returnedAt,r.images,'/pages/loans/index?id='+encodeURIComponent(r.id)); });
  const opts = options || {}, q = String(opts.query || '').trim().toLowerCase();
  if (opts.date) date(opts.date);
  const anchor = opts.date || dayText();
  return events.filter(e => (!opts.kind || opts.kind === '全部' || e.kind === opts.kind) && (!q || (e.title+' '+e.detail).toLowerCase().includes(q)) &&
    (opts.mode !== 'anniversary' || e.date.slice(5) === anchor.slice(5) && e.date.slice(0,4) < anchor.slice(0,4)))
    .sort((a,b) => b.at-a.at || a.id.localeCompare(b.id));
}
function review(data, mode, anchor) {
  const range = period(mode,anchor), withinDate = s => s >= range.start && s <= range.end, within = t => time(t) && withinDate(dayText(t));
  const expenses = data.expenses.filter(r => within(r.createdAt)), completed = data.todos.filter(r => r.done && within(r.doneAt));
  const focuses = data.life.sessions.filter(s => s.mode === 'focus' && within(s.finishedAt));
  const checkins = data.life.records.reduce((n,r) => n+r.checkins.filter(withinDate).length,0), categories = {};
  expenses.forEach(e => { categories[e.category] = (categories[e.category]||0)+e.amountCents; });
  const days = [];
  for (let t = date(range.start); t <= date(range.end); t += DAY) {
    const day = new Date(t).toISOString().slice(0,10);
    days.push({ date: day, label: day.slice(5), amountCents: expenses.filter(e => dayText(e.createdAt) === day).reduce((s,e)=>s+e.amountCents,0), focusMinutes: focuses.filter(s=>dayText(s.finishedAt)===day).reduce((s,e)=>s+e.seconds/60,0) });
  }
  const events = timeline(data).filter(e => within(e.at));
  return { range, expenseCents: expenses.reduce((sum,e)=>sum+e.amountCents,0), expenseCount: expenses.length,
    createdTodos: data.todos.filter(r=>within(r.createdAt)).length, completedTodos: completed.length, lateCompletedTodos: completed.filter(r=>r.doneAt>r.dueAt).length, onTimeCompletedTodos: completed.filter(r=>r.doneAt<=r.dueAt).length,
    unknownCompleted: data.todos.filter(r=>r.done && !time(r.doneAt)).length,
    focusMinutes: focuses.reduce((sum,s)=>sum+s.seconds/60,0), checkins, notes: data.notes.filter(r=>within(r.createdAt)).length,
    recipes: data.library.recipes.filter(r=>within(r.createdAt)).length, events: events.length,
    photos: Array.from(new Set(events.reduce((a,e)=>a.concat(e.images),[]))).slice(0,12), days,
    categories: Object.keys(categories).map(name=>({name,cents:categories[name]})).sort((a,b)=>b.cents-a.cents) };
}
module.exports = { MANAGERS, SLOTS, SLOT_NAMES, empty, preferences, normalize, validate, validatePreferences, dayText, date, parseIngredients, period, timeline, review };
