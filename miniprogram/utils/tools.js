/** 纯前端计算函数，不读写存储，也不调用任何微信或网络接口。 */
function numeric(value, label) {
  const text = String(value).trim();
  if (!text || !/^\d+(\.\d+)?$/.test(text)) throw new Error('请输入有效的' + label);
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(label + '过大');
  return number;
}

// 与账本一样按整数分处理金额；此处允许输入 0（已存金额、优惠金额等）。
function cents(value, label) {
  const text = String(value).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error(label + '需为非负金额，最多两位小数、七位整数');
  const parts = text.split('.');
  return Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
}

function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期');
  const parts = value.split('-').map(Number);
  if (parts[0] < 1000 || parts[0] > 9999) throw new Error('日期年份需在 1000～9999 之间');
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    throw new Error('日期不存在，请重新选择');
  }
  // 使用日历日序号，避开夏令时引起的 23/25 小时日误差。
  return date.getTime() / 86400000;
}
function dateDiff(start, end) { return dayNumber(end) - dayNumber(start); }

function bmi(height, weight) {
  const cm = numeric(height, '身高');
  const kg = numeric(weight, '体重');
  if (cm < 30 || cm > 300 || kg <= 0 || kg > 1000) throw new Error('身高范围为 30～300 厘米，体重应大于 0 且不超过 1000 千克');
  return (kg / Math.pow(cm / 100, 2)).toFixed(1);
}

function savings(target, current, monthly) {
  const targetCents = cents(target, '目标金额');
  const currentCents = cents(current, '已存金额');
  const monthlyCents = cents(monthly, '每月存入');
  if (targetCents <= 0 || monthlyCents <= 0) throw new Error('目标金额和每月存入均需大于 0');
  const remaining = Math.max(0, targetCents - currentCents);
  return { remaining: (remaining / 100).toFixed(2), months: Math.ceil(remaining / monthlyCents) };
}

function discount(original, fold, coupon) {
  const originalCents = cents(original, '原价');
  const discountFold = numeric(fold, '折扣');
  const couponCents = cents(coupon, '优惠金额');
  if (originalCents <= 0 || discountFold > 10) throw new Error('原价需大于 0，折扣范围为 0～10 折');
  const finalCents = Math.max(0, Math.round(originalCents * discountFold / 10) - couponCents);
  return { final: (finalCents / 100).toFixed(2), saved: ((originalCents - finalCents) / 100).toFixed(2) };
}

function randomChoice(text, random) {
  const items = Array.from(new Set(String(text).split(/\r\n|\r|\n/).map(item => item.trim()).filter(Boolean)));
  if (items.length < 2) throw new Error('请至少填写两个不同选项，每行一个');
  return items[Math.floor((random || Math.random)() * items.length)];
}

function textStats(text) {
  return {
    characters: Array.from(text).length,
    nonWhitespace: Array.from(text.replace(/\s/g, '')).length,
    chinese: (text.match(/[\u3400-\u9fff]/g) || []).length,
    englishWords: (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0
  };
}

module.exports = { dateDiff, bmi, savings, discount, randomChoice, textStats };
