const {digest} = require('./service');
const LEAD = 30 * 60 * 1000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const fail = message => { throw Error(message); };
const keyFor = (owner, generation, id, dueAt) => digest(['todo-reminder', owner, generation, id, dueAt]);
function timeText(value) {
  const d = new Date(value + 8 * 3600000), two = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '年' + two(d.getUTCMonth() + 1) + '月' + two(d.getUTCDate()) + '日 ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}
function createReminders({records, queue, send, config, now = Date.now}) {
  function configured() {
    const things = [config.titleKey, config.remainingKey, config.noteKey];
    if (!config.templateId || things.some(key => !/^thing\d+$/.test(key)) || !/^time\d+$/.test(config.timeKey) || new Set([...things, config.timeKey]).size !== 4) fail('到期提醒尚未配置，请检查订阅消息模板及字段');
  }
  async function register(owner, input, at = now()) {
    if (!validId(owner)) fail('请从已登录的小程序开启提醒');
    configured();
    if (!input || !validId(input.id) || !Number.isSafeInteger(input.dueAt) || input.dueAt <= at) fail('请选择未到期的待办');
    if (input.templateId && input.templateId !== config.templateId) fail('提醒模板已更新，请更新小程序后重试');
    const state = await records.load(owner);
    const task = state.records.find(r => r.kind === 'todos' && r.id === input.id && !r.deleted);
    if (!task || task.value.done || task.value.dueAt !== input.dueAt) fail('待办已更新或完成，请刷新后重新开启提醒');
    const key = keyFor(owner, state.meta.generation, input.id, input.dueAt);
    const value = await queue.put(key, {owner, generation: state.meta.generation, todoId: input.id, dueAt: input.dueAt,
      templateId: config.templateId, reminderEpoch: task.reminderEpoch || 0, remindAt: Math.max(at, input.dueAt - LEAD), status: 'pending', createdAt: at});
    return {ok: true, status: value.status};
  }
  async function status(owner, input) {
    if (!validId(owner)) fail('请从已登录的小程序读取通知设置');
    if (!input || !Array.isArray(input.ids) || input.ids.length > 40 || input.ids.some(id => !validId(id))) fail('通知状态请求无效');
    const state = await records.load(owner), at = now();
    const result = await Promise.all(state.records.filter(r => r.kind === 'todos' && !r.deleted && input.ids.includes(r.id)).map(async row => {
      const todo = row.value;
      const reminder = await queue.get(keyFor(owner, state.meta.generation, row.id, todo.dueAt));
      const active = reminder && reminder.templateId === config.templateId && (reminder.reminderEpoch || 0) === (row.reminderEpoch || 0) && !todo.done && todo.dueAt > at;
      const current = active ? reminder.status : 'off';
      return {id: row.id, dueAt: todo.dueAt, status: current, enabled: current === 'pending' || current === 'sending'};
    }));
    return {ok: true, reminders: result};
  }
  async function disable(owner, input) {
    if (!validId(owner)) fail('请从已登录的小程序关闭提醒');
    if (!input || !validId(input.id) || !Number.isSafeInteger(input.dueAt)) fail('通知设置请求无效');
    const state = await records.load(owner);
    const row = state.records.find(r => r.kind === 'todos' && r.id === input.id && !r.deleted);
    if (!row || row.value.dueAt !== input.dueAt) fail('待办已更新，请刷新后重试');
    const value = await queue.disable(keyFor(owner, state.meta.generation, input.id, input.dueAt), {
      owner, generation: state.meta.generation, todoId: input.id, dueAt: input.dueAt, reminderEpoch: row.reminderEpoch || 0
    });
    if (value.status === 'sending') fail('提醒正在发送，已无法撤回，请稍后刷新状态');
    return {ok: true, status: value.status};
  }
  async function run(at = now()) {
    configured();
    const report = {sent: 0, cancelled: 0, failed: 0};
    for (const reminder of await queue.list(at)) {
      // 先读取最新业务记录，读失败时保留 pending，供下次定时器重试。
      let state;
      try { state = await records.load(reminder.owner); }
      catch (error) { console.error('reminder load failed', reminder.key, error.message); report.failed++; continue; }
      const row = state.records.find(r => r.kind === 'todos' && r.id === reminder.todoId && !r.deleted);
      const task = row && row.value;
      const valid = state.meta.generation === reminder.generation && task && !task.done && task.dueAt === reminder.dueAt && task.dueAt > at && reminder.templateId === config.templateId && (row.reminderEpoch || 0) === (reminder.reminderEpoch || 0);
      // 原子认领；发送中、成功、失败或结果不明的记录都不会被重新发送。
      if (!await queue.claim(reminder.key, reminder.reminderEpoch || 0, reminder.subscriptionVersion || 0)) continue;
      const sendAt = Math.max(at, now());
      if (!valid || task.dueAt <= sendAt) { await queue.finish(reminder.key, {status: 'cancelled', finishedAt: sendAt}); report.cancelled++; continue; }
      let result;
      try {
        result = await send({touser: reminder.owner, templateId: config.templateId,
          page: 'pages/todo/index?todoId=' + encodeURIComponent(task.id),
          miniprogramState: config.miniprogramState || 'formal', lang: 'zh_CN',
          data: {
            [config.titleKey]: {value: Array.from(task.title).slice(0, 20).join('')},
            [config.timeKey]: {value: timeText(task.dueAt)},
            [config.remainingKey]: {value: '剩余' + Math.max(1, Math.ceil((task.dueAt - sendAt) / 60000)) + '分钟'},
            [config.noteKey]: {value: '待办即将到期，请及时完成'}
          }});
      } catch (error) {
        const code = error.errCode === undefined ? error.errcode : error.errCode;
        // 微信业务错误（如 43101 拒绝接收）可确认未发送；SDK/网络错误保留 unknown。
        await queue.finish(reminder.key, {status: Number.isInteger(code) && code > 0 ? 'failed' : 'unknown', finishedAt: at,
          errorCode: Number.isInteger(code) ? code : null, error: String(error.errMsg || error.message || error).slice(0, 300)});
        report.failed++; continue;
      }
      const code = result && (result.errCode === undefined ? result.errcode : result.errCode);
      const success = code === 0;
      await queue.finish(reminder.key, {status: success ? 'sent' : code === undefined ? 'unknown' : 'failed', finishedAt: at,
        error: success ? '' : String(result && (result.errMsg || result.errmsg) || '发送结果未确认').slice(0, 300)});
      if (success) report.sent++; else report.failed++;
    }
    return {ok: true, ...report};
  }
  return {register, disable, status, run};
}

function createReminderQueue(db) {
  const collection = 'life_todo_reminders';
  const read = async (source, key) => (await source.collection(collection).doc(key).get()).data;
  return {
    async get(key) { return read(db, key); },
    async put(key, value) {
      return db.runTransaction(async tx => {
        const existing = await read(tx, key);
        // 仅新授权可更新尚未尝试发送的旧提醒；已发出或结果不明的截止时间不能重发。
        if (existing) {
          const oldEpoch = existing.reminderEpoch || 0, nextEpoch = value.reminderEpoch || 0;
          if (!['pending', 'cancelled', 'disabled'].includes(existing.status) || oldEpoch > nextEpoch || (oldEpoch === nextEpoch && existing.status !== 'disabled')) return existing;
        }
        const next = {...value, subscriptionVersion: (existing && existing.subscriptionVersion || 0) + 1};
        await tx.collection(collection).doc(key).set({data: next}); return next;
      });
    },
    async disable(key, value) {
      return db.runTransaction(async tx => {
        const existing = await read(tx, key);
        if (existing && ['sending', 'sent', 'failed', 'unknown'].includes(existing.status)) return existing;
        const next = {...existing, ...value, status: 'disabled', subscriptionVersion: (existing && existing.subscriptionVersion || 0) + 1};
        await tx.collection(collection).doc(key).set({data: next}); return next;
      });
    },
    async list(at) {
      // 每轮限制 40 条，防止扫描/发送超出 60 秒函数超时；余下任务由下一轮处理。
      const result = await db.collection(collection).where({status: 'pending', remindAt: db.command.lte(at)}).orderBy('remindAt', 'asc').limit(40).get();
      return result.data.map(row => ({...row, key: row._id}));
    },
    async claim(key, expectedEpoch = 0, expectedSubscriptionVersion) {
      return db.runTransaction(async tx => {
        const row = await read(tx, key); if (!row || row.status !== 'pending' || (row.reminderEpoch || 0) !== expectedEpoch || (expectedSubscriptionVersion !== undefined && (row.subscriptionVersion || 0) !== expectedSubscriptionVersion)) return false;
        await tx.collection(collection).doc(key).update({data: {status: 'sending', claimedAt: Date.now()}}); return true;
      });
    },
    async finish(key, patch) { await db.collection(collection).doc(key).update({data: patch}); }
  };
}
module.exports = {createReminders, createReminderQueue};
