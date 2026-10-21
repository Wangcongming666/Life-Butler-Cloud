/** 扩展工具：表单描述与纯计算逻辑。无网络、无持久化副作用。 */
const DAY = 86400000;
const BASES = [2, 8, 10, 16];
const field = (key, label, type, value, placeholder, options) => ({ key, label, type,
  value: value === undefined ? '' : value, placeholder: placeholder || '', options: options || [] });

const definitions = {
  split: {
    title: '聚餐、出游，公平分摊', button: '计算分账', hint: '按分精确分摊；除不尽的零头分给部分人，确保总额一致。',
    fields: [field('total', '总金额（元）', 'digit', '', '例如：100'), field('people', '分摊人数', 'number', '2')]
  },
  age: {
    title: '算算已经走过的日子', button: '计算年龄', hint: '按生日计算周岁。2 月 29 日出生者，非闰年按 3 月 1 日递增年龄。',
    fields: [field('birth', '出生日期', 'date', '@today'), field('asOf', '计算至哪一天', 'date', '@today')]
  },
  shift: {
    title: '向前或向后推算日期', button: '推算日期', hint: '正数向后推，负数向前推；不跳过周末或节假日。',
    fields: [field('base', '基准日期', 'date', '@today'), field('days', '推移天数（支持负数）', 'text', '7')]
  },
  duration: {
    title: '一段时间，有多长', button: '计算时长', hint: '跨夜请将结束日期选为“次日”。相同时间且选“次日”表示 24 小时。',
    fields: [field('start', '开始时间', 'time', '09:00'), field('end', '结束时间', 'time', '18:00'),
      field('nextDay', '结束日期', 'picker', '0', '', ['当天', '次日'])]
  },
  fuel: {
    title: '这次行程，花了多少油钱', button: '计算油耗', hint: '按实际消耗的油量估算；仅加油量不一定等于本次消耗量。',
    fields: [field('distance', '行驶里程（公里）', 'digit', '', '例如：500'), field('liters', '消耗油量（升）', 'digit', '', '例如：40'), field('price', '油价（元/升）', 'digit', '', '填写实际单价')]
  },
  utilities: {
    title: '水电开销，随手算清', button: '估算水电费', hint: '单价由你填写。按单一费率估算，不含阶梯价格及附加费用。',
    fields: [field('power', '用电量（度）', 'digit', '0'), field('powerPrice', '电价（元/度）', 'digit', '0'),
      field('water', '用水量（立方米）', 'digit', '0'), field('waterPrice', '水价（元/立方米）', 'digit', '0')]
  },
  percent: {
    title: '百分比，不用心算', button: '计算结果', hint: '百分比数值：A × B%；占比：A ÷ B；增减幅度：(B − A) ÷ A。',
    fields: [field('mode', '计算方式', 'picker', '0', '', ['求百分比数值', '求占比', '求增减幅度']),
      field('a', '数值 A（增减幅度中为原值）', 'text', '', '支持负数'), field('b', '数值 B（增减幅度中为新值）', 'text', '', '支持负数')]
  },
  radix: {
    title: '常用进制，一键转换', button: '转换进制', hint: '支持正负整数，不需要输入 0x 等前缀；数值绝对值不超过 9007199254740991。',
    fields: [field('number', '待转换整数', 'text', '', '例如：255 或 FF'),
      field('from', '原始进制', 'picker', '2', '', ['二进制', '八进制', '十进制', '十六进制']),
      field('to', '目标进制', 'picker', '0', '', ['二进制', '八进制', '十进制', '十六进制'])]
  }
};

const catalog = [
  ['split', 'AA 分账', '总额分摊到分，零头也算清', '理财计算', '分', 'mint', 'savings'],
  ['age', '年龄计算', '周岁与已经度过的天数', '日常生活', '岁', 'rose', 'bmi'],
  ['shift', '日期推算', '几天前、几天后是哪天', '日常生活', '历', 'sand', 'date'],
  ['duration', '时长计算', '工作、学习时段与跨夜计算', '日常生活', '时', 'sky', 'unit'],
  ['fuel', '油耗费用', '百公里油耗与每公里费用', '日常生活', '油', 'mint', 'mortgage'],
  ['utilities', '水电估算', '用量乘单价，估算水电费', '日常生活', '电', 'sky', 'unit'],
  ['percent', '百分比算', '占比、百分数与增减幅度', '理财计算', '%', 'sand', 'discount'],
  ['radix', '进制转换', '二、八、十、十六进制互转', '文本工具', '进', 'rose', 'text']
].map(row => ({ id: row[0], title: row[1], description: row[2], category: row[3], icon: row[4], tone: row[5], background: '/assets/tools/' + row[6] + '.svg' }));

function form(id, today, values) {
  const spec = definitions[id];
  if (!spec) return [];
  return spec.fields.map(item => Object.assign({}, item, {
    value: Object.prototype.hasOwnProperty.call(values || {}, item.key) ? values[item.key] : (item.value === '@today' ? today : item.value)
  }));
}
function number(value, label, signed) {
  const text = String(value).trim();
  if (!(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(text)) throw new Error('请输入有效的' + label);
  const result = Number(text);
  if (!Number.isFinite(result) || Math.abs(result) > 1000000000) throw new Error(label + '过大，请缩小数值');
  return result;
}
function integer(value, label, min, max) {
  const result = number(value, label, true);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(label + '需为 ' + min + '～' + max + ' 的整数');
  return result;
}
function moneyCents(value) {
  const text = String(value).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error('金额最多七位整数、两位小数');
  const parts = text.split('.');
  return Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期');
  const parts = value.split('-').map(Number);
  const result = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parts[0] < 1000 || result.getUTCFullYear() !== parts[0] || result.getUTCMonth() !== parts[1] - 1 || result.getUTCDate() !== parts[2]) throw new Error('日期不存在');
  return result;
}
function time(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('请选择有效时间');
  const parts = value.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}
const row = (label, value) => ({ label, value: String(value) });
const result = (label, value, rows) => ({ label, value: String(value), rows: rows || [] });
const compact = value => String(Number(value.toPrecision(12)));
const yuan = cents => '¥ ' + (cents / 100).toFixed(2);

function calculate(id, input) {
  if (id === 'split') {
    const total = moneyCents(input.total);
    const people = integer(input.people, '人数', 1, 10000);
    if (total <= 0) throw new Error('总金额需大于 0');
    const perPerson = Math.floor(total / people);
    const remainder = total % people;
    return result('每人基础分摊', yuan(perPerson), [row('零头分配', remainder ? remainder + ' 人各付 ' + yuan(perPerson + 1) : '无需补零头'),
      row('基础金额人数', (people - remainder) + ' 人各付 ' + yuan(perPerson)), row('分摊总额', yuan(total))]);
  }
  if (id === 'age') {
    const birth = date(input.birth), asOf = date(input.asOf);
    if (birth > asOf) throw new Error('出生日期不能晚于计算日期');
    let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
    if (asOf.getUTCMonth() < birth.getUTCMonth() || (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate())) age -= 1;
    return result('截至所选日期的周岁', age + ' 岁', [row('已度过', Math.floor((asOf - birth) / DAY) + ' 天')]);
  }
  if (id === 'shift') {
    const base = date(input.base), days = integer(input.days, '推移天数', -365000, 365000);
    const target = new Date(base.getTime() + days * DAY);
    if (target.getUTCFullYear() < 1000 || target.getUTCFullYear() > 9999) throw new Error('结果日期需在 1000～9999 年之间');
    return result('推算后的日期', target.toISOString().slice(0, 10), [row('星期', ['日', '一', '二', '三', '四', '五', '六'][target.getUTCDay()]), row('推移天数', days + ' 天')]);
  }
  if (id === 'duration') {
    const minutes = time(input.end) - time(input.start) + integer(input.nextDay, '结束日期', 0, 1) * 1440;
    if (minutes < 0) throw new Error('结束早于开始；跨夜时请选择“次日”');
    return result('这段时间共计', Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟', [row('总分钟数', minutes + ' 分钟'), row('小时数', compact(minutes / 60) + ' 小时')]);
  }
  if (id === 'fuel') {
    const distance = number(input.distance, '里程'), liters = number(input.liters, '油量'), price = number(input.price, '油价');
    if (distance <= 0 || liters <= 0) throw new Error('里程和消耗油量需大于 0');
    return result('百公里油耗', (liters / distance * 100).toFixed(2) + ' L/100km', [row('油费合计', '¥ ' + (liters * price).toFixed(2)), row('每公里费用', '¥ ' + (liters * price / distance).toFixed(3))]);
  }
  if (id === 'utilities') {
    const power = number(input.power, '用电量'), powerPrice = number(input.powerPrice, '电价');
    const water = number(input.water, '用水量'), waterPrice = number(input.waterPrice, '水价');
    const powerCents = Math.round(power * powerPrice * 100), waterCents = Math.round(water * waterPrice * 100);
    if (!Number.isSafeInteger(powerCents + waterCents)) throw new Error('估算金额过大，请缩小数值');
    return result('预计合计', yuan(powerCents + waterCents), [row('电费', yuan(powerCents)), row('水费', yuan(waterCents))]);
  }
  if (id === 'percent') {
    const mode = integer(input.mode, '计算方式', 0, 2), a = number(input.a, '数值 A', true), b = number(input.b, '数值 B', true);
    if (mode === 0) return result('A 的 B%', compact(a * b / 100));
    if (mode === 1) {
      if (b === 0) throw new Error('求占比时，数值 B 不能为 0');
      return result('A 占 B 的比例', compact(a / b * 100) + '%');
    }
    if (a === 0) throw new Error('求增减幅度时，原值 A 不能为 0');
    return result('从 A 到 B 的增减幅度', compact((b - a) / a * 100) + '%');
  }
  if (id === 'radix') {
    const from = BASES[integer(input.from, '原始进制', 0, 3)], to = BASES[integer(input.to, '目标进制', 0, 3)];
    const text = String(input.number).trim().toUpperCase();
    if (!/^-?[0-9A-F]{1,64}$/.test(text)) throw new Error('请输入有效整数，不要添加进制前缀');
    const digits = text.replace(/^-/, '');
    let value = 0;
    for (let i = 0; i < digits.length; i += 1) {
      const digit = '0123456789ABCDEF'.indexOf(digits[i]);
      if (digit >= from) throw new Error('输入包含不属于 ' + from + ' 进制的数字');
      value = value * from + digit;
      if (!Number.isSafeInteger(value)) throw new Error('数值超出安全整数范围');
    }
    if (text[0] === '-') value = -value;
    return result(to + ' 进制结果', value.toString(to).toUpperCase(), [row('原始进制', from), row('目标进制', to)]);
  }
  throw new Error('未找到该工具，请返回工具箱重试');
}

module.exports = { catalog, definitions, form, calculate };
