/** 课表的纯数据处理。仅解析本地文本，绝不执行导入内容中的脚本。 */
const SCHOOL = '长春理工大学';
const DAY = 86400000;
const exams = require('./exams');
const COLORS = ['#e0eee5', '#e1edf5', '#f1e8d7', '#eee1e6', '#e7e4f2', '#e7eedb'];
function empty() { return { school: SCHOOL, termName: '', termStart: '', totalWeeks: 20, periodTimes: [], courses: [], exams: [] }; }
function validatePeriodTimes(value) {
  if (!Array.isArray(value) || value.length > 14) throw new Error('作息时间格式有误');
  let previous = '';
  return value.map(item => {
    const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!item || !pattern.test(item.start) || !pattern.test(item.end) || item.end <= item.start || (previous && item.start < previous)) throw new Error('作息时间需按先后顺序填写，结束时间应晚于开始时间');
    previous = item.end;
    return { start: item.start, end: item.end };
  });
}
function integer(value, min, max, label) {
  if (typeof value !== 'number' && !/^\d+$/.test(String(value))) throw new Error(label + '应为整数');
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(label + '范围为 ' + min + '～' + max);
  return number;
}
function dayDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('请选择有效日期');
  const parts = text.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parts[0] < 1000 || d.getUTCFullYear() !== parts[0] || d.getUTCMonth() !== parts[1] - 1 || d.getUTCDate() !== parts[2]) throw new Error('日期不存在');
  return d;
}
function parseWeeks(input, maxWeeks) {
  const limit = integer(maxWeeks, 1, 30, '学期周数');
  const text = String(input).replace(/[第周\s()（）]/g, '').replace(/[，、；;]/g, ',').replace(/[~～—–至]/g, '-');
  if (!text) throw new Error('请输入周次，例如 1-16 或 1-16单');
  const weeks = new Set();
  text.split(',').forEach(token => {
    const match = token.match(/^(\d+)(?:-(\d+))?([单双])?$/);
    if (!match) throw new Error('无法识别周次：' + token);
    const start = integer(match[1], 1, limit, '周次'), end = integer(match[2] || match[1], 1, limit, '周次');
    if (end < start) throw new Error('周次范围顺序有误');
    for (let week = start; week <= end; week += 1) {
      if (!match[3] || (match[3] === '单' ? week % 2 === 1 : week % 2 === 0)) weeks.add(week);
    }
  });
  if (!weeks.size) throw new Error('周次条件没有匹配到任何一周');
  return Array.from(weeks).sort((a, b) => a - b);
}
function weekDay(value) {
  const text = String(value).trim().replace(/^(星期|周|礼拜)/, '');
  const index = '一二三四五六日天'.indexOf(text);
  return index >= 0 && text.length === 1 ? Math.min(index + 1, 7) : integer(text, 1, 7, '星期');
}
function normalize(input, maxWeeks) {
  if (!input || typeof input !== 'object') throw new Error('课程记录格式不正确');
  const title = String(input.title || '').trim();
  const teacher = String(input.teacher || '').trim(), location = String(input.location || '').trim();
  if (!title || title.length > 80 || teacher.length > 80 || location.length > 100) throw new Error('课程名必填（最多80字），教师或教室文字过长');
  const start = integer(input.start, 1, 14, '开始节次'), end = integer(input.end, 1, 14, '结束节次');
  if (end < start) throw new Error('结束节次不能早于开始节次');
  const weeks = Array.isArray(input.weeks) ? Array.from(new Set(input.weeks.map(w => integer(w, 1, maxWeeks, '周次')))).sort((a, b) => a - b) : parseWeeks(input.weeks, maxWeeks);
  if (!weeks.length) throw new Error('课程至少需要一个上课周次');
  return { id: typeof input.id === 'string' ? input.id : '', title, teacher, location, day: weekDay(input.day), start, end, weeks };
}
function validate(input) {
  if (!input || typeof input !== 'object' || input.school !== SCHOOL || typeof input.termName !== 'string' || input.termName.length > 40 || !Array.isArray(input.courses) || input.courses.length > 300) throw new Error('课表数据异常，请先导出备份');
  const totalWeeks = integer(input.totalWeeks, 1, 30, '学期周数');
  if (input.termStart !== '') {
    const start = dayDate(input.termStart);
    if (start.getUTCDay() !== 1) throw new Error('第一周起始日应为周一');
  }
  const ids = new Set();
  const courses = input.courses.map(course => {
    const normalized = normalize(course, totalWeeks);
    if (!normalized.id || ids.has(normalized.id)) throw new Error('课程编号缺失或重复');
    ids.add(normalized.id);
    return normalized;
  });
  const periodTimes = validatePeriodTimes(input.periodTimes === undefined ? [] : input.periodTimes);
  const examList = input.exams === undefined ? [] : input.exams;
  if (!Array.isArray(examList) || examList.length > 200) throw new Error('考试安排应为不超过 200 条的列表');
  const examIds = new Set();
  const normalizedExams = examList.map(item => {
    const exam = exams.normalize(item);
    if (!exam.id || examIds.has(exam.id)) throw new Error('考试编号缺失或重复');
    examIds.add(exam.id);
    return exam;
  });
  return { school: SCHOOL, termName: input.termName, termStart: input.termStart, totalWeeks, periodTimes, courses, exams: normalizedExams };
}
function currentWeek(start, today) { return Math.floor((dayDate(today) - dayDate(start)) / DAY / 7) + 1; }
function termStartForWeek(today, current, totalWeeks) {
  const date = dayDate(today);
  const week = integer(current, 1, integer(totalWeeks, 1, 30, '学期周数'), '当前教学周');
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday - (week - 1) * 7 * DAY).toISOString().slice(0, 10);
}
/** 用日历日计算日期，跨月/跨年及夏令时不会导致星期偏移。 */
function weekDates(start, week, today) {
  if (!start) return [];
  const first = dayDate(start).getTime() + (integer(week, 1, 30, '周次') - 1) * 7 * DAY;
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first + index * DAY);
    const fullDate = date.toISOString().slice(0, 10);
    return { fullDate, month: date.getUTCMonth() + 1, dateText: (date.getUTCMonth() + 1) + '/' + date.getUTCDate(), isToday: fullDate === today };
  });
}
function fingerprint(course) { return JSON.stringify([course.title, course.teacher, course.location, course.day, course.start, course.end, course.weeks]); }

/** RFC4180 风格文本解析，支持引号内的逗号、换行和双引号。 */
function csvRows(text, delimiter) {
  const rows = [], row = [];
  let value = '', quoted = false, closed = false;
  function cell() { row.push(value.trim()); value = ''; closed = false; }
  function line() { cell(); if (row.some(Boolean)) rows.push(row.slice()); row.length = 0; }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === '"') {
      if (value) throw new Error('CSV 引号位置不正确');
      quoted = true;
    } else if (ch === delimiter) cell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; line(); }
    else if (closed && ch.trim()) throw new Error('CSV 引号后包含多余字符');
    else value += ch;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (value || row.length || closed) line();
  return rows;
}
function parseImport(raw, totalWeeks) {
  const text = String(raw).replace(/^\uFEFF/, '').trim();
  if (!text || text.length > 200000) throw new Error('请提供不超过 20 万字符的课表文本');
  if (/<html\b|^MIME-Version:/i.test(text)) return parseSchoolDocument(text, totalWeeks).courses;
  let items;
  if (/^[\[{]/.test(text)) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { throw new Error('JSON 格式有误，请检查文件内容'); }
    items = Array.isArray(parsed) ? parsed : parsed.courses || (parsed.schedule && parsed.schedule.courses) || (parsed.data && parsed.data.schedule && parsed.data.schedule.courses);
  } else {
    if (text[0] === '<') throw new Error('网页课表需要按实际页面格式适配，请提供原始文件；当前可导入列表式 CSV/JSON');
    const rows = csvRows(text, text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',');
    if (rows.length < 2) throw new Error('未识别到课程列表，请使用列表式 CSV 或 JSON');
    const aliases = { '课程名称': 'title', '课程名': 'title', title: 'title', '星期': 'day', day: 'day', '开始节次': 'start', start: 'start', '结束节次': 'end', end: 'end', '周次': 'weeks', weeks: 'weeks', '教师': 'teacher', '任课教师': 'teacher', teacher: 'teacher', '教室': 'location', '上课地点': 'location', location: 'location' };
    const headers = rows.shift().map(name => aliases[name]);
    if (!['title', 'day', 'start', 'end', 'weeks'].every(key => headers.includes(key))) throw new Error('需要课程名称、星期、开始节次、结束节次、周次这五列表头');
    if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) throw new Error('课表中存在重复表头');
    items = rows.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error('第 ' + (index + 2) + ' 行列数与表头不一致');
      const item = {};
      headers.forEach((key, col) => { if (key) item[key] = cells[col]; });
      return item;
    });
  }
  if (!Array.isArray(items) || !items.length || items.length > 300) throw new Error('导入课程应为 1～300 条列表');
  const unique = new Map();
  items.forEach((item, index) => {
    try { const course = normalize(item, totalWeeks); unique.set(fingerprint(course), course); }
    catch (error) { throw new Error('第 ' + (index + 1) + ' 条课程：' + error.message); }
  });
  return Array.from(unique.values());
}
/** 仅提取文字和已知属性，不构造网页、不加载资源、不执行脚本。 */
function plainText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, name) => {
      if (name[0] !== '#') return entities[name.toLowerCase()] || all;
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }).replace(/\s+/g, ' ').trim();
}
function attributes(text) {
  const result = {};
  const regex = /([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let match;
  while ((match = regex.exec(text))) result[match[1].toLowerCase()] = match[2] === undefined ? (match[3] === undefined ? match[4] : match[3]) : match[2];
  return result;
}
function arrangements(html) {
  const stack = [], found = [];
  const tags = /<\/?div\b[^>]*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<\//.test(match[0])) {
      const node = stack.pop();
      if (!node) throw new Error('课程单元格的 DIV 结构不完整');
      node.inner = html.slice(node.begin, match.index);
      if (/(^|\s)arrage(\s|$)/.test(attributes(node.attrs).class || '')) found.push(node);
    } else {
      const node = { attrs: match[0], begin: tags.lastIndex, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
  }
  if (stack.length) throw new Error('课程单元格存在未闭合 DIV');
  return found;
}
function mergeSchoolCourses(courses, totalWeeks) {
  const sameSlot = new Map();
  courses.forEach(course => {
    const key = JSON.stringify([course.title, course.teacher, course.location, course.day, course.start, course.end]);
    const previous = sameSlot.get(key);
    if (previous) previous.weeks = Array.from(new Set(previous.weeks.concat(course.weeks))).sort((a, b) => a - b);
    else sameSlot.set(key, Object.assign({}, course));
  });
  const sameCourse = new Map();
  sameSlot.forEach(course => {
    const key = JSON.stringify([course.title, course.teacher, course.location, course.day, course.weeks]);
    if (!sameCourse.has(key)) sameCourse.set(key, []);
    sameCourse.get(key).push(course);
  });
  const result = [];
  sameCourse.forEach(group => {
    const merged = [];
    group.sort((a, b) => a.start - b.start || a.end - b.end).forEach(course => {
      const last = merged[merged.length - 1];
      if (last && course.start <= last.end + 1) last.end = Math.max(last.end, course.end);
      else merged.push(Object.assign({}, course));
    });
    result.push.apply(result, merged);
  });
  return result.map(course => normalize(course, totalWeeks)).sort((a, b) => a.day - b.day || a.start - b.start || a.weeks[0] - b.weeks[0]);
}
function parseSchoolDocument(raw, totalWeeks) {
  const htmlMatch = raw.match(/<html\b[^>]*>[\s\S]*?<\/html\s*>/i);
  if (!htmlMatch || !/长春理工大学/.test(plainText(htmlMatch[0]))) throw new Error('未识别到长春理工大学网页型课表，请使用学校导出的原始 DOC 文件');
  const html = htmlMatch[0].replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->/gi, '');
  const termMatch = plainText(html).match(/长春理工大学\s*(\d{4}\s*[-—]\s*\d{4}学年\s*第[一二三123]学期)/);
  const courses = [];
  const cells = /<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi;
  let match;
  while ((match = cells.exec(html))) {
    const attrs = attributes(match[1]), inner = match[2];
    if (!/(?:class\s*=\s*["'][^"']*\barrage\b)/i.test(inner)) continue;
    const start = integer(attrs.jc, 1, 14, '开始节次'), day = integer(attrs.xq, 1, 7, '星期');
    const span = attrs.rowspan === undefined ? 1 : integer(attrs.rowspan, 1, 14, '合并节次');
    const blocks = arrangements(inner);
    if (!blocks.length) throw new Error('有课程内容无法解析，请勿继续导入');
    blocks.forEach(block => {
      const values = block.children.map(child => plainText(child.inner));
      if (values.length !== 3) throw new Error('学校课表课程字段数量变化，请提供新样本适配');
      courses.push(normalize({ title: values[1], weeks: values[0], location: values[2], teacher: '', day, start, end: start + span - 1 }, totalWeeks));
      if (courses.length > 300) throw new Error('课表条目超过 300，请检查文件');
    });
  }
  if (!courses.length) throw new Error('课表中未找到可识别的课程安排');
  const times = [], rows = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  const chinese = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];
  while ((match = rows.exec(html))) {
    const rowCells = Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi));
    if (rowCells.length < 2) continue;
    const label = plainText(rowCells[0][1]).match(/^第([一二三四五六七八九十\d]+)节$/);
    if (!label) continue;
    const number = /^\d+$/.test(label[1]) ? Number(label[1]) : chinese.indexOf(label[1]) + 1;
    const time = plainText(rowCells[1][1]).match(/^(\d{2}:\d{2})\s*[~～—-]\s*(\d{2}:\d{2})$/);
    if (number < 1 || number > 14 || !time) throw new Error('课表作息时间无法识别');
    times[number - 1] = { start: time[1], end: time[2] };
  }
  for (let i = 0; i < times.length; i += 1) if (!times[i]) throw new Error('课表作息时间不完整');
  return { format: 'cust-doc', source: '长春理工大学导出课表', termName: termMatch ? termMatch[1].replace(/\s+/g, ' ') : '',
    periodTimes: validatePeriodTimes(times), courses: mergeSchoolCourses(courses, totalWeeks) };
}
function parseDocument(raw, totalWeeks) {
  const text = String(raw).replace(/^\uFEFF/, '').trim();
  if (!text || text.length > 200000) throw new Error('请提供不超过 20 万字符的课表文件');
  if (/<html\b|^MIME-Version:/i.test(text)) return parseSchoolDocument(text, totalWeeks);
  return { format: 'text', source: '课程列表', termName: '', periodTimes: [], courses: parseImport(text, totalWeeks) };
}
/** 同日有节次重叠时合并为可点选分组，避免遮住另一门课。 */
function board(courses, week) {
  return Array.from({ length: 7 }, (_, index) => {
    const blocks = [];
    courses.filter(c => c.day === index + 1 && c.weeks.includes(week)).sort((a, b) => a.start - b.start || a.end - b.end).forEach(course => {
      const last = blocks[blocks.length - 1];
      if (last && course.start <= last.end) { last.end = Math.max(last.end, course.end); last.courses.push(course); }
      else blocks.push({ start: course.start, end: course.end, courses: [course] });
    });
    blocks.forEach((block, n) => {
      block.key = index + '_' + n;
      block.top = (block.start - 1) * 96 + 4;
      block.height = (block.end - block.start + 1) * 96 - 8;
      block.title = block.courses.map(c => c.title).join(' / ');
      block.subtitle = block.courses.length > 1 ? block.courses.length + ' 门重叠·点击查看' : block.courses[0].location || '未填教室';
      block.color = COLORS[(index + n) % COLORS.length];
    });
    return { day: index + 1, name: '一二三四五六日'[index], blocks };
  });
}
module.exports = { empty, validate, normalize, parseWeeks, parseImport, parseDocument, currentWeek, termStartForWeek, weekDates, board, fingerprint };
