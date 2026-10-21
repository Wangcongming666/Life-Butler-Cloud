/** 考试数据与本地时间计算。不调用网络、通知或学校接口。 */
const METHODS = ['笔试', '机考', '口试', '其他'];
function normalize(input) {
  if (!input || typeof input !== 'object') throw new Error('考试信息格式有误');
  const title = String(input.title || '').trim(), location = String(input.location || '').trim();
  const seat = String(input.seat || '').trim(), note = String(input.note || '').trim();
  if (!title || title.length > 80 || location.length > 100 || seat.length > 20 || note.length > 200) throw new Error('考试名称必填，或填写内容过长');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('请选择考试日期');
  const parts = input.date.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (parts[0] < 1000 || date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) throw new Error('考试日期不存在');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(input.start) || !time.test(input.end) || input.end <= input.start) throw new Error('请选择有效时间，结束须晚于开始（同一天）');
  const method = input.method || METHODS[0];
  if (!METHODS.includes(method)) throw new Error('请选择考试方式');
  return { id: typeof input.id === 'string' ? input.id : '', title, date: input.date, start: input.start, end: input.end, location, seat, method, note };
}
function describe(exam, now) {
  const date = exam.date.split('-').map(Number), start = exam.start.split(':').map(Number), end = exam.end.split(':').map(Number);
  const startAt = new Date(date[0], date[1] - 1, date[2], start[0], start[1]).getTime();
  const endAt = new Date(date[0], date[1] - 1, date[2], end[0], end[1]).getTime();
  const current = new Date(now);
  const days = Math.round((Date.UTC(date[0], date[1] - 1, date[2]) - Date.UTC(current.getFullYear(), current.getMonth(), current.getDate())) / 86400000);
  const status = now >= endAt ? 'finished' : now >= startAt ? 'ongoing' : 'upcoming';
  let countdown;
  if (status === 'finished') countdown = '已结束';
  else if (status === 'ongoing') countdown = '正在考试';
  else if (days > 1) countdown = '还有 ' + days + ' 天';
  else if (days === 1) countdown = '明天';
  else {
    const minutes = Math.max(1, Math.ceil((startAt - now) / 60000));
    countdown = minutes >= 60 ? Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟后' : minutes + ' 分钟后';
  }
  const weekday = '日一二三四五六'[new Date(date[0], date[1] - 1, date[2]).getDay()];
  return Object.assign({}, exam, { startAt, endAt, status, countdown,
    statusText: status === 'finished' ? '已结束' : status === 'ongoing' ? '进行中' : '待考试',
    dateText: date[1] + '月' + date[2] + '日 周' + weekday, shortDate: date[1] + '/' + date[2], timeText: exam.start + ' — ' + exam.end });
}
module.exports = { METHODS, normalize, describe };
