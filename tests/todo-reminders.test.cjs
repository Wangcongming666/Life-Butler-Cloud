const test = require('node:test');
const assert = require('node:assert/strict');
const {createClient} = require('./helpers/client.cjs');
const {MemoryRepository} = require('./helpers/memory-cloud.cjs');
const {createService} = require('../cloudfunctions/lifeButler/service');
const templateConfig = require('../miniprogram/utils/reminder-config');

// External storage and delivery are in memory; scheduling/validation use production code.
function setup(clock = () => 1000000) {
  const rows = new Map(), sent = [];
  const state = {meta: {generation: 'g0'}, records: [{kind: 'todos', id: 'a', value: {id: 'a', title: '交作业', dueAt: 3600000, done: false}}]};
  const queue = {
    async put(key, value) { if (!rows.has(key)) rows.set(key, value); return rows.get(key); },
    async list(now) { return [...rows].filter(([, r]) => r.status === 'pending' && r.remindAt <= now).map(([key, r]) => ({...r, key})); },
    async claim(key) { const r = rows.get(key); if (!r || r.status !== 'pending') return false; r.status = 'sending'; return true; },
    async finish(key, patch) { Object.assign(rows.get(key), patch); },
    async get(key) { return rows.get(key); }
  };
  const {createReminders} = require('../cloudfunctions/lifeButler/reminders');
  const api = createReminders({records: {load: async () => structuredClone(state)}, queue,
    send: async value => { sent.push(value); return {errCode: 0}; },
    config: templateConfig, now: clock});
  return {api, rows, state, sent, queue};
}

test('notification is sent only inside the 30 minute window, once even with concurrent timer runs', async () => {
  const {api, sent} = setup();
  assert.equal((await api.register('owner', {id: 'a', dueAt: 3600000})).ok, true);
  await api.run(1799999); assert.equal(sent.length, 0);
  await Promise.all([api.run(1800000), api.run(1800000)]);
  await api.run(1900000); assert.equal(sent.length, 1);
  assert.equal(sent[0].touser, 'owner');
  assert.equal(sent[0].data.thing1.value, '交作业');
  assert.equal(sent[0].data.time3.value, '1970年01月01日 09:00');
  assert.equal(sent[0].page, 'pages/todo/index?todoId=a');
});

test('the selected template receives all four fields with remaining time calculated at delivery', async () => {
  let clock = 1000000;
  const {api, sent} = setup(() => clock);
  await api.register('owner', {id: 'a', dueAt: 3600000});
  clock = 3300000; await api.run(1800000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateId, '-aoXoECaHTnZ-41yWU47RekHdc295XkLN6cvNa8WgpM');
  assert.deepEqual(sent[0].data, {
    thing1: {value: '交作业'}, time3: {value: '1970年01月01日 09:00'},
    thing4: {value: '剩余5分钟'}, thing5: {value: '待办即将到期，请及时完成'}
  });
});

test('completed, deleted, rescheduled, expired and replaced tasks do not send stale reminders', async () => {
  for (const change of [s => s.records[0].value.done = true, s => s.records[0].deleted = true,
    s => s.records[0].value.dueAt = 4000000, s => s.records = [], s => s.meta.generation = 'g1']) {
    const {api, state, sent} = setup(); await api.register('owner', {id: 'a', dueAt: 3600000});
    change(state); await api.run(1800000); assert.equal(sent.length, 0);
  }
  const {api, sent} = setup(); await api.register('owner', {id: 'a', dueAt: 3600000});
  await api.run(3600000); assert.equal(sent.length, 0);
});

test('registration is owner scoped, rejects stale task snapshots and never re-arms a sent reminder', async () => {
  const {api, rows, sent} = setup();
  await assert.rejects(api.register('', {id: 'a', dueAt: 3600000}));
  await assert.rejects(api.register('owner', {id: 'a', dueAt: 4000000}));
  await assert.rejects(api.register('owner', {id: 'missing', dueAt: 3600000}));
  await api.register('owner', {id: 'a', dueAt: 3600000});
  await api.register('other', {id: 'a', dueAt: 3600000}); assert.equal(rows.size, 2);
  await api.run(1800000); await api.register('owner', {id: 'a', dueAt: 3600000});
  await api.run(1800000); assert.equal(sent.length, 2);
});

test('delivery exceptions are recorded without blindly retrying an uncertain send', async () => {
  const {createReminders} = require('../cloudfunctions/lifeButler/reminders');
  const other = setup(); let attempts = 0;
  const runner = createReminders({records: {load: async () => other.state}, queue: other.queue,
    send: async () => { attempts++; throw Error('timeout'); },
    config: {...templateConfig, templateId: 'template'}, now: () => 1000000});
  await runner.register('owner', {id: 'a', dueAt: 3600000}, 1000000);
  await runner.run(1800000); await runner.run(1800000);
  assert.equal(attempts, 1); assert.equal([...other.rows.values()][0].status, 'unknown');
});

test('an explicit WeChat rejection is marked failed rather than an uncertain delivery', async () => {
  const {createReminders} = require('../cloudfunctions/lifeButler/reminders');
  const {queue, state, rows} = setup();
  const runner = createReminders({records: {load: async () => state}, queue,
    send: async () => { throw Object.assign(Error('user refuse'), {errCode: 43101}); },
    config: {...templateConfig, templateId: 'template'}, now: () => 1000000});
  await runner.register('owner', {id: 'a', dueAt: 3600000}); await runner.run(1800000);
  assert.equal([...rows.values()][0].status, 'failed');
});

test('missing or invalid cloud API tickets leave the reminder pending for a valid scheduled invocation', async () => {
  const {createReminders} = require('../cloudfunctions/lifeButler/reminders');
  for (const message of ['subscribeMessage.send:fail Invalid wxCloudApiToken', 'subscribeMessage.send:fail missing wxCloudApiToken']) {
    const {queue, state, rows} = setup(); let attempts = 0;
    const runner = createReminders({records: {load: async () => state}, queue, config: templateConfig, now: () => 1000000,
      send: async () => { if (++attempts === 1) throw Object.assign(Error(message), {errCode: -501007}); return {errCode: 0}; }});
    await runner.register('owner', {id: 'a', dueAt: 3600000});
    assert.equal((await runner.run(1800000)).failed, 1);
    assert.equal([...rows.values()][0].status, 'pending');
    assert.equal((await runner.status('owner', {ids: ['a']})).reminders[0].retrying, true);
    assert.equal((await runner.run(1860000)).sent, 1); await runner.run(1920000);
    assert.equal(attempts, 2); assert.equal([...rows.values()][0].status, 'sent');
  }
});

test('other SDK parameter errors remain uncertain and are not blindly retried', async () => {
  const {createReminders} = require('../cloudfunctions/lifeButler/reminders');
  const {queue, state, rows} = setup(); let attempts = 0;
  const runner = createReminders({records: {load: async () => state}, queue, config: templateConfig, now: () => 1000000,
    send: async () => { attempts++; throw Object.assign(Error('invalid parameters'), {errCode: -501007}); }});
  await runner.register('owner', {id: 'a', dueAt: 3600000}); await runner.run(1800000); await runner.run(1860000);
  assert.equal(attempts, 1); assert.equal([...rows.values()][0].status, 'unknown');
});

test('production queue transactions persist a single registration and claim, and query due pending reminders only', async () => {
  const {Database} = require('./helpers/database.cjs');
  const {createReminderQueue} = require('../cloudfunctions/lifeButler/reminders');
  const db = new Database(), queue = createReminderQueue(db);
  await Promise.all([queue.put('a', {status: 'pending', remindAt: 10}), queue.put('a', {status: 'pending', remindAt: 20})]);
  await queue.put('b', {status: 'pending', remindAt: 100});
  await queue.put('c', {status: 'sent', remindAt: 0});
  assert.deepEqual((await queue.list(10)).map(r => r.key), ['a']);
  const claims = await Promise.all([queue.claim('a'), queue.claim('a')]);
  assert.equal(claims.filter(Boolean).length, 1);
  await queue.finish('a', {status: 'sent'});
  assert.equal((await queue.put('a', {status: 'pending', remindAt: 0})).status, 'sent');
  assert.deepEqual(await queue.list(10), []);
  assert.deepEqual((await queue.list(100)).map(r => r.key), ['b']);
});

test('round-trip rescheduling or completion invalidates old consent; explicit new consent can re-arm an unsent deadline', async () => {
  const {Database} = require('./helpers/database.cjs');
  const {createRepository} = require('../cloudfunctions/lifeButler/repository');
  const {createReminders, createReminderQueue} = require('../cloudfunctions/lifeButler/reminders');
  for (const field of ['dueAt', 'done', 'title']) {
    const sent = [];
    let version = 0;
    const todo = {id: 'a', title: '原任务', dueAt: 3600000, done: false, createdAt: 0, images: []};
    // Share the actual database with the notification queue.
    const db = new Database(), records = createRepository(db), realService = createService(records);
    version = 0;
    async function commit(value) {
      const result = await realService('owner', {action: 'commit', generation: 'g0', operationId: 'edit' + version,
        changes: [{kind: 'todos', id: 'a', expectedVersion: version++, value: {...todo, ...value}}]}); assert.equal(result.ok, true);
    }
    const api = createReminders({records, queue: createReminderQueue(db), send: async p => {sent.push(p); return {errCode: 0};},
      config: {...templateConfig, templateId: 'template'}, now: () => 1000000});
    await commit({}); await api.register('owner', {id: 'a', dueAt: 3600000});
    await commit({[field]: field === 'dueAt' ? 4000000 : field === 'done' ? true : '改名'}); await commit({});
    await api.run(1800000);
    assert.equal(sent.length, field === 'title' ? 1 : 0, field + ' round trip');
    await api.register('owner', {id: 'a', dueAt: 3600000}); await api.run(1800000);
    assert.equal(sent.length, 1, 'new consent or duplicate registration');
  }
});

test('an old timer snapshot cannot claim or cancel a newly authorized reminder epoch', async () => {
  const {Database} = require('./helpers/database.cjs');
  const {createReminderQueue} = require('../cloudfunctions/lifeButler/reminders');
  const queue = createReminderQueue(new Database());
  await queue.put('a', {status: 'pending', remindAt: 10, reminderEpoch: 0});
  const [old] = await queue.list(10);
  await queue.put('a', {status: 'pending', remindAt: 10, reminderEpoch: 2});
  assert.equal(await queue.claim('a', old.reminderEpoch), false);
  assert.equal((await queue.list(10))[0].reminderEpoch, 2);
  assert.equal(await queue.claim('a', 2), true);
});

test('cloud entry scopes identity-bearing tests to their owner and recognizes trusted timers with a residual OPENID', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const {createRequire} = require('node:module');
  const {Database} = require('./helpers/database.cjs');
  const db = new Database(), sent = [], at = Date.now(), dueAt = at + 120000;
  let owner = 'owner', source = 'wx_devtools';
  const realRequire = createRequire(path.resolve(__dirname, '../cloudfunctions/lifeButler/index.js'));
  const module = {exports: {}};
  const sdk = {init() {}, database: () => db, getWXContext: () => ({OPENID: owner, SOURCE: source}), openapi: {subscribeMessage: {send: async data => {sent.push(data); return {errCode: 0};}}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../cloudfunctions/lifeButler/index.js'), 'utf8'), {module, exports: module.exports,
    require: name => name === 'wx-server-sdk' ? sdk : name === './shared/reminder-config' ? {...templateConfig, templateId: 'template'} : realRequire(name)});
  const service = createService(require('../cloudfunctions/lifeButler/repository').createRepository(db));
  assert.equal((await service('owner', {action: 'commit', operationId: 'initial', generation: 'g0', changes: [{kind: 'todos', id: 'a', expectedVersion: 0,
    value: {id: 'a', title: '交作业', dueAt, done: false, createdAt: at, images: []}}]})).ok, true);
  const main = module.exports.main;
  owner = 'intruder'; assert.equal((await main({action: 'reminderRegister', id: 'a', dueAt})).ok, false);
  owner = 'owner'; assert.equal((await main({action: 'reminderRegister', id: 'a', dueAt})).ok, true);
  assert.equal((await service('other', {action: 'commit', operationId: 'initial', generation: 'g0', changes: [{kind: 'todos', id: 'b', expectedVersion: 0,
    value: {id: 'b', title: '其他用户', dueAt, done: false, createdAt: at, images: []}}]})).ok, true);
  owner = 'other'; assert.equal((await main({action: 'reminderRegister', id: 'b', dueAt})).ok, true);
  owner = 'owner';
  const manual = await main({Type: 'Timer', TriggerName: 'todoDueReminders'});
  assert.equal(manual.ok, false); assert.equal(manual.code, 'WECHAT_TRIGGER_REQUIRED');
  assert.equal(sent.length, 0, 'console tests must not claim reminders without a WeChat cloud API ticket');
  source = 'wx_client';
  assert.equal((await main({Type: 'Timer', TriggerName: 'todoDueReminders', SOURCE: 'wx_trigger'})).sent, 1);
  assert.equal(sent[0].touser, 'owner');
  assert.equal(sent.length, 1, 'a client cannot process another owner by spoofing an event source');
  // A real timer must run even if instance reuse left an OPENID in the SDK context.
  source = 'wx_trigger';
  assert.equal((await main({Type: 'Timer', TriggerName: 'todoDueReminders'})).sent, 1);
  assert.equal(sent[1].touser, 'other');
  owner = undefined; source = undefined;
  assert.equal((await main({action: 'reminderRegister', id: 'a', dueAt})).ok, false);
  assert.equal((await main({Type: 'Timer', TriggerName: 'unrecognized'})).ok, false);
  assert.equal((await main({Type: 'Timer', TriggerName: 'todoDueReminders'})).sent, 0);
  await main({Type: 'Timer', TriggerName: 'todoDueReminders'}); assert.equal(sent.length, 2);
});

test('client requests subscription from a tap and registers only acceptance; rejection does not save a reminder', async () => {
  const c = createClient(async (owner, event) => event.action === 'reminderRegister' ? {ok: true, status: 'pending'} : {ok: true});
  const reminders = c.load('utils/todo-reminders.js');
  const config = c.load('utils/reminder-config.js'); config.templateId = 'template';
  let requests = 0, payload;
  c.wx.requestSubscribeMessage = options => { requests++; options.success({template: 'reject'}); };
  c.wx.cloud.callFunction = async options => { payload = options.data; return {result: {ok: true, status: 'pending'}}; };
  await assert.rejects(reminders.subscribe({id: 'a', dueAt: Date.now() + 60000}), /未开启/);
  assert.equal(payload, undefined);
  c.wx.requestSubscribeMessage = options => { requests++; options.success({template: 'accept'}); };
  await reminders.subscribe({id: 'a', dueAt: Date.now() + 60000});
  assert.equal(requests, 2); assert.equal(payload.action, 'reminderRegister'); assert.equal(payload.id, 'a');
});

test('notification link opens a task even when it is filtered out, after cloud data is ready', async () => {
  const c = createClient(createService(new MemoryRepository())); await c.sync.start();
  await c.store.saveTodo({title: '通知目标', dueAt: 0});
  const id = c.store.read().todos[0].id, p = c.page('todo'); p.onLoad({todoId: id}); await p.onShow();
  assert.equal(p.data.formVisible, true); assert.equal(p.data.editingId, id); p.onUnload();
});

test('notification warm launch opens the task in an already loaded tab and does not replay on ordinary foreground', async () => {
  const c = createClient(createService(new MemoryRepository())); await c.sync.start(); c.load('app.js');
  await c.store.saveTodo({title: '热启动通知', dueAt: 0}); const id = c.store.read().todos[0].id;
  const p = c.page('todo'); p.onLoad({}); await p.onShow(); assert.equal(p.data.formVisible, false);
  p.onHide(); c.app().onHide();
  c.app().onShow({path: 'pages/todo/index', query: {todoId: id}}); await p.onShow();
  assert.equal(p.data.formVisible, true); assert.equal(p.data.editingId, id);
  p.closeForm(); p.onHide(); c.app().onHide();
  c.app().onShow({path: 'pages/todo/index', query: {}}); await p.onShow();
  assert.equal(p.data.formVisible, false); p.onUnload(); c.app().onHide();
});
