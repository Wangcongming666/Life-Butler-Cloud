const journal = require('./journal'), life = require('./life');
const DAY = 86400000;
// 《道德经》第六十四章：https://ctext.org/dao-de-jing/zh
const quote = { text: '千里之行，始于足下。', source: '《道德经》' };
function stats(records, now) {
  const today = journal.dayText(now === undefined ? Date.now() : now);
  const dates = Array.from(new Set((records || []).map(r => r.date).filter(date => date <= today))).sort();
  const signed = new Set(dates), todayTime = journal.date(today);
  let streak = 0, cursor = signed.has(today) ? todayTime : todayTime - DAY;
  while (signed.has(new Date(cursor).toISOString().slice(0, 10))) { streak++; cursor -= DAY; }
  let longest = 0, run = 0, previous = null;
  dates.forEach(date => { const time = journal.date(date); run = previous !== null && time - previous === DAY ? run + 1 : 1; longest = Math.max(longest, run); previous = time; });
  return { today, signedToday: signed.has(today), streak, longest, total: dates.length, firstDate: dates[0] || '', quote };
}
function calendar(month, records, now) {
  const dates = (records || []).map(r => r.date);
  return life.calendar(month, dates, now).map(day => Object.assign({}, day, {today: Boolean(day.isToday)}));
}
module.exports = { stats, calendar, quote };