const store = require('./storage'), checkin = require('./checkin');
let pending = null, welcome = null;
const listeners = new Set();
function emit() { listeners.forEach(listener => listener(welcome)); }
function subscribe(listener) {
  listeners.add(listener);
  listener(welcome);
  return () => listeners.delete(listener);
}
function dismiss() { welcome = null; emit(); }
function run() {
  if (pending) return pending;
  pending = (async () => {
    const result = await store.checkInToday();
    if (result.created) {
      welcome = Object.assign({}, result, {quote: checkin.quote});
      emit();
    }
    return result;
  })().finally(() => { pending = null; });
  return pending;
}
module.exports = {run, subscribe, dismiss};