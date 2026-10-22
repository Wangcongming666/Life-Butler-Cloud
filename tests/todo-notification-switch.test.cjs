const test = require('node:test'), assert = require('node:assert/strict');
const {Database} = require('./helpers/database.cjs');
const {createRepository} = require('../cloudfunctions/lifeButler/repository');
const {createService} = require('../cloudfunctions/lifeButler/service');
const {createReminders, createReminderQueue} = require('../cloudfunctions/lifeButler/reminders');
const {createClient} = require('./helpers/client.cjs');
const config = require('../miniprogram/utils/reminder-config');
async function setup() {
  const db = new Database(), records = createRepository(db), queue = createReminderQueue(db), service = createService(records), sent = [];
  let clock = Date.now(); const dueAt = clock + 3600000;
  const api = createReminders({records, queue, config, now: () => clock, send: async p => {sent.push(p); return {errCode: 0};}});
  const call = (owner, e) => e.action === 'reminderRegister' ? api.register(owner, e) : e.action === 'reminderDisable' ? api.disable(owner, e) : e.action === 'reminderStatus' ? api.status(owner, e) : service(owner, e);
  const c = createClient(call); await c.sync.start(); await c.store.saveTodo({title: '开关测试', dueAt});
  const todo = c.store.read().todos[0];
  return {api, queue, c, todo, sent, call, setTime: n => clock = n};
}
test('switch defaults off, cloud state is shared by devices, disabling prevents sending', async () => {
  const {api, todo, sent, setTime} = await setup();
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, false);
  await api.register('user', todo);
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, true);
  await api.disable('user', todo);
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, false);
  setTime(todo.dueAt - 60000); await api.run(); assert.equal(sent.length, 0);
  await api.register('user', todo); await api.run(); assert.equal(sent.length, 1);
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].status, 'sent');
  await api.register('user', todo); await api.run(); assert.equal(sent.length, 1);
});
test('a timer snapshot from before off/on cannot consume the newly enabled subscription', async () => {
  const {api, queue, todo, setTime, sent} = await setup();
  await api.register('user', todo);
  setTime(todo.dueAt - 60000); const [old] = await queue.list(todo.dueAt - 60000);
  await api.disable('user', todo); await api.register('user', todo);
  assert.equal(await queue.claim(old.key, old.reminderEpoch || 0, old.subscriptionVersion || 0), false);
  await api.run(); assert.equal(sent.length, 1);
});
test('notification status and cancellation are scoped to the authenticated owner', async () => {
  const {api, todo} = await setup(); await api.register('user', todo);
  assert.deepEqual((await api.status('other', {ids: [todo.id]})).reminders, []);
  await assert.rejects(api.disable('other', todo));
  await assert.rejects(api.status('', {ids: [todo.id]}));
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, true);
});
test('page switch stays off on rejection, enables after consent, synchronizes to another device and can cancel', async () => {
  const {c, call, todo, api} = await setup();
  const p = c.page('todo'); p.onLoad({}); await p.onShow();
  assert.equal(p.data.todos[0].notificationEnabled, false);
  c.wx.requestSubscribeMessage = o => o.success({[config.templateId]: 'reject'});
  const event = value => ({currentTarget: {dataset: {id: todo.id}}, detail: {value}});
  await p.onNotificationChange(event(true)); assert.equal(p.data.todos[0].notificationEnabled, false);
  c.wx.requestSubscribeMessage = o => o.success({[config.templateId]: 'accept'});
  await p.onNotificationChange(event(true)); assert.equal(p.data.todos[0].notificationEnabled, true);
  const other = createClient(call); await other.sync.start(); const q = other.page('todo'); q.onLoad({}); await q.onShow();
  assert.equal(q.data.todos[0].notificationEnabled, true);
  await p.onNotificationChange(event(false)); assert.equal(p.data.todos[0].notificationEnabled, false);
  await q.refreshReminderStates(); assert.equal(q.data.todos[0].notificationEnabled, false);
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, false);
  p.onUnload(); q.onUnload();
});
test('failed cancellation restores the confirmed on state and reports failure', async () => {
  const {c, todo, api} = await setup(); await api.register('user', todo);
  const p = c.page('todo'); p.onLoad({}); await p.onShow(); assert.equal(p.data.todos[0].notificationEnabled, true);
  c.offline(); await p.onNotificationChange({currentTarget: {dataset: {id: todo.id}}, detail: {value: false}});
  assert.equal(p.data.todos[0].notificationEnabled, true);
  assert.ok(c.notices.some(n => n.title === '通知设置未保存')); p.onUnload();
});

test('cloud cancellation errors retain a traceable request ID without exposing database internals', async () => {
  const {c, todo, api} = await setup(); await api.register('user', todo);
  const p = c.page('todo'); p.onLoad({}); await p.onShow();
  const original = c.wx.cloud.callFunction;
  c.wx.cloud.callFunction = async options => options.data.action === 'reminderDisable'
    ? {requestID: 'trace-disable-123', result: {ok: false, code: 'REMINDER_ERROR', message: 'document.update:fail database internal details'}}
    : original(options);
  await p.onNotificationChange({currentTarget: {dataset: {id: todo.id}}, detail: {value: false}});
  const notice = c.notices.find(n => n.title === '通知设置未保存');
  assert.match(notice.content, /trace-disable-123/);
  assert.doesNotMatch(notice.content, /database|document.update/);
  assert.equal(p.data.todos[0].notificationEnabled, true);
  p.onUnload();
});

test('ordinary subscription cancellation stays off without an error modal and the next tap can authorize', async () => {
  const {c, todo, api} = await setup(), p = c.page('todo'); p.onLoad({}); await p.onShow();
  let requests = 0;
  c.wx.getSetting = options => options.success({subscriptionsSetting: {mainSwitch: true, itemSettings: {}}});
  c.wx.requestSubscribeMessage = options => { requests++; options.success({[config.templateId]: requests === 1 ? 'reject' : 'accept'}); };
  const event = {currentTarget: {dataset: {id: todo.id}}, detail: {value: true}};
  await p.onNotificationChange(event);
  assert.equal(p.data.todos[0].notificationEnabled, false); assert.equal(p.data.todos[0].notificationLocked, false); assert.equal(p.data.remindingId, '');
  assert.equal(c.notices.some(notice => notice.title === '通知设置未保存'), false);
  assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, false);
  await p.onNotificationChange(event); assert.equal(requests, 2); assert.equal(p.data.todos[0].notificationEnabled, true); p.onUnload();
});

test('a remembered rejection or disabled WeChat master switch offers settings without treating them as new consent', async () => {
  for (const masterOff of [false, true]) {
    const {c, todo, api} = await setup(), p = c.page('todo'); p.onLoad({}); await p.onShow();
    let requests = 0, opened = 0, allowed = false;
    c.wx.requestSubscribeMessage = options => {
      requests++;
      if (allowed) options.success({[config.templateId]: 'accept'});
      else if (masterOff) options.fail({errCode: 20004, errMsg: 'The main switch is switched off'});
      else options.success({[config.templateId]: 'reject'});
    };
    c.wx.getSetting = options => { assert.equal(options.withSubscriptions, true); options.success({subscriptionsSetting: {mainSwitch: !masterOff, itemSettings: {[config.templateId]: 'reject'}}}); };
    c.wx.openSetting = options => { opened++; assert.equal(options.withSubscriptions, true); allowed = true; options.success({subscriptionsSetting: {mainSwitch: true, itemSettings: {[config.templateId]: 'accept'}}}); };
    const event = {currentTarget: {dataset: {id: todo.id}}, detail: {value: true}};
    await p.onNotificationChange(event);
    const recovery = c.notices.find(notice => notice.confirmText === '去设置'); assert.ok(recovery);
    assert.equal(p.data.todos[0].notificationEnabled, false); assert.equal(p.data.todos[0].notificationLocked, false);
    await recovery.success({confirm: true});
    assert.equal(opened, 1); assert.equal(requests, 1);
    assert.equal((await api.status('user', {ids: [todo.id]})).reminders[0].enabled, false, 'changing settings does not authorize a one-time notification');
    await p.onNotificationChange(event);
    assert.equal(requests, 2); assert.equal(p.data.todos[0].notificationEnabled, true); p.onUnload();
  }
});

test('settings lookup failure and a transient authorization error never leave the switch locked', async () => {
  for (const temporaryFailure of [false, true]) {
    const {c, todo} = await setup(), p = c.page('todo'); p.onLoad({}); await p.onShow();
    let requests = 0;
    c.wx.getSetting = options => options.fail({errMsg: 'temporary failure'});
    c.wx.requestSubscribeMessage = options => {
      requests++;
      if (requests > 1) options.success({[config.templateId]: 'accept'});
      else if (temporaryFailure) options.fail({errCode: 10005, errMsg: 'Cannot show subscribe message UI'});
      else options.success({[config.templateId]: 'reject'});
    };
    const event = {currentTarget: {dataset: {id: todo.id}}, detail: {value: true}};
    await p.onNotificationChange(event);
    assert.equal(p.data.todos[0].notificationEnabled, false); assert.equal(p.data.todos[0].notificationLocked, false); assert.equal(p.data.remindingId, '');
    await p.onNotificationChange(event); assert.equal(p.data.todos[0].notificationEnabled, true); p.onUnload();
  }
});
