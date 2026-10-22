const test = require('node:test'), assert = require('node:assert/strict');
const {Database} = require('./helpers/database.cjs');
const {createReminderQueue} = require('../cloudfunctions/lifeButler/reminders');
const {createService} = require('../cloudfunctions/lifeButler/service');
const {MemoryRepository} = require('./helpers/memory-cloud.cjs');
const {createClient} = require('./helpers/client.cjs');
const missing = () => Object.assign(Error('document.get:fail -502005 database collection not exists. [ResourceNotFound] Db or Table not exist: life_todo_reminders'), {errCode: -502005});
class FreshDatabase extends Database {
  constructor() { super(); this.ready = false; this.creates = 0; }
  collectionFor(data, name) { if (name === 'life_todo_reminders' && !this.ready) throw missing(); return super.collectionFor(data, name); }
  async createCollection(name) { assert.equal(name, 'life_todo_reminders'); this.creates++; await new Promise(resolve => setImmediate(resolve)); this.ready = true; }
}
test('first reminder read initializes a missing collection once and concurrent reads return off', async () => {
  const db = new FreshDatabase(), queue = createReminderQueue(db);
  assert.deepEqual(await Promise.all([queue.get('a'), queue.get('b')]), [null, null]);
  assert.equal(db.creates, 1);
  await queue.put('a', {status: 'pending', remindAt: 10}); assert.equal((await queue.list(10)).length, 1);
});
test('first registration and timer scan also recover a missing collection', async () => {
  const db = new FreshDatabase(), queue = createReminderQueue(db);
  await queue.put('a', {status: 'pending', remindAt: 10}); assert.equal(db.creates, 1);
  const empty = new FreshDatabase(); assert.deepEqual(await createReminderQueue(empty).list(10), []); assert.equal(empty.creates, 1);
});
test('permission failures are not mistaken for a missing collection and creation failures remain visible', async () => {
  const db = new FreshDatabase(); db.collectionFor = () => { throw Error('DATABASE_PERMISSION_DENIED'); };
  await assert.rejects(createReminderQueue(db).get('a'), /PERMISSION_DENIED/); assert.equal(db.creates, 0);
  const fresh = new FreshDatabase(); fresh.createCollection = async () => { throw Error('creation denied'); };
  await assert.rejects(createReminderQueue(fresh).get('a'), /creation denied/);
});
test('a missing reminder collection never exposes a database stack or blocks normal todo editing', async () => {
  const service = createService(new MemoryRepository());
  const c = createClient(async (owner, e) => e.action === 'reminderStatus' ? {ok: false, message: missing().message} : service(owner, e));
  await c.sync.start(); await c.store.saveTodo({title: '正常待办', dueAt: Date.now() + 3600000});
  const p = c.page('todo'); p.onLoad({}); await p.onShow();
  assert.equal(p.data.todos.length, 1); assert.equal(p.data.cloudReady, true);
  assert.ok(p.data.notificationStateError.length < 35);
  assert.doesNotMatch(p.data.notificationStateError, /database|document\.get|ResourceNotFound|life_todo_reminders/i);
  p.openEdit({currentTarget: {dataset: {id: p.data.todos[0].id}}}); assert.equal(p.data.formVisible, true); p.onUnload();
});
