const { attempt } = require('../../utils/ui');
const calc = require('../../utils/tools');
const { syncTab } = require('../../utils/navigation');
const extra = require('../../utils/extra-tools');
const life = require('../../utils/life');
const store = require('../../utils/storage');
const journal = require('../../utils/journal');

// 工具目录只管理入口。所有计算均在本机进行，返回列表不会清除已填内容。
const TOOLS = [
  { id: 'mortgage', title: '房贷计算', description: '月供、总利息一目了然', category: '理财计算', icon: '房', tone: 'mint' },
  { id: 'unit', title: '单位换算', description: '长度、重量、温度转换', category: '日常生活', icon: '⇄', tone: 'sky' },
  { id: 'date', title: '日期间隔', description: '两天之间，相隔多久', category: '日常生活', icon: '日', tone: 'sand' },
  { id: 'bmi', title: 'BMI 计算', description: '根据身高体重计算指数', category: '健康记录', icon: '健', tone: 'rose' },
  { id: 'savings', title: '储蓄目标', description: '算算还要存几个月', category: '理财计算', icon: '存', tone: 'mint' },
  { id: 'discount', title: '折扣计算', description: '折后减优惠，算到手价', category: '理财计算', icon: '折', tone: 'sand' },
  { id: 'random', title: '随机选择', description: '纠结的时候，帮你选一个', category: '日常生活', icon: '选', tone: 'sky' },
  { id: 'text', title: '文本统计', description: '字数、行数与英文词数', category: '文本工具', icon: '文', tone: 'rose' }
].concat(extra.catalog).map(tool => Object.assign({}, tool, { background: tool.background || '/assets/tools/' + tool.id + '.svg' }));
const now = new Date();
const TODAY = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

// 系数均相对于同类基础单位；温度使用独立的线性转换。
const UNITS = [
  { names: ['米', '千米', '厘米', '毫米', '英寸', '英尺'], factors: [1, 1000, 0.01, 0.001, 0.0254, 0.3048] },
  { names: ['千克', '克', '斤', '磅'], factors: [1, 0.001, 0.5, 0.45359237] },
  { names: ['摄氏度 ℃', '华氏度 ℉', '开尔文 K'] }
];

function numberInput(text, label) {
  if (String(text).trim() === '') throw new Error('请输入' + label);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(label + '必须是有效数字');
  return value;
}
function amount(value) { return Math.max(0, value).toFixed(2); }

require('../../utils/page-sync').definePage({
  data: {
    managers: [
      { type: 'checkin', title: '每日签到', icon: '签', background: 'date' },
      { type: 'homework', title: '课程作业', icon: '作', background: 'text' },
      { type: 'assets', title: '物品保修', icon: '物', background: 'mortgage' },
      { type: 'shopping', title: '购物清单', icon: '购', background: 'discount' },
      { type: 'budget', title: '月度预算', icon: '预', background: 'savings' },
      { type: 'habits', title: '习惯打卡', icon: '习', background: 'bmi' },
      { type: 'focus', title: '番茄钟', icon: '钟', background: 'date' },
      { type: 'countdown', title: '纪念倒数', icon: '日', background: 'date' },
      { type: 'expiry', title: '保质期', icon: '期', background: 'text' },
      { type: 'search', title: '全局搜索', icon: '搜', background: 'unit' },
      { type: 'backup', title: '备份恢复', icon: '备', background: 'savings' },
      { type: 'loans', title: '借还管理', icon: '借', background: 'text' },
      { type: 'food', title: '饮食菜谱', icon: '食', background: 'bmi' },
      { type: 'review', title: '生活回顾', icon: '回', background: 'savings' },
      { type: 'timeline', title: '时间轴', icon: '忆', background: 'date' },
      { type: 'settings', title: '个性设置', icon: '设', background: 'unit' }
    ], alerts: [],
    tools: TOOLS, filteredTools: TOOLS, activeTool: '', activeTitle: '', activeDescription: '',
    extraSpec: null, extraForm: [], extraValues: {}, extraResult: null,
    toolQuery: '', toolCategory: '全部', toolCategories: ['全部', '理财计算', '日常生活', '健康记录', '文本工具'],
    dateStart: TODAY, dateEnd: TODAY, dateResult: null,
    bmiHeight: '', bmiWeight: '', bmiResult: '',
    savingsTarget: '', savingsCurrent: '0', savingsMonthly: '', savingsResult: null,
    discountOriginal: '', discountFold: '8.5', discountCoupon: '0', discountResult: null,
    randomOptions: '', randomResult: '', textValue: '', textResult: calc.textStats(''),
    principal: '', annualRate: '3.1', years: '30', method: 0,
    methods: ['等额本息', '等额本金'], mortgage: null,
    types: ['长度', '重量', '温度'], type: 0, units: UNITS[0].names,
    from: 0, to: 1, unitValue: '', unitResult: '', unitError: ''
  },
  filterTools() {
    const query = this.data.toolQuery.trim().toLowerCase();
    this.setData({ filteredTools: TOOLS.filter(tool =>
      (this.data.toolCategory === '全部' || tool.category === this.data.toolCategory) &&
      (!query || (tool.title + tool.description + tool.category).toLowerCase().includes(query))
    ) });
  },
  onShow() { syncTab(this, 2); this.refresh(); },
  refresh() { return attempt(async () => {
    const data=store.read(), favorites=data.preferences.favorites;
    const rank=id=>favorites.includes(id)?favorites.indexOf(id):favorites.length+journal.MANAGERS.indexOf(id);
    this.setData({alerts:data.preferences.showReminders?life.alerts(data).slice(0,6):[],managers:this.data.managers.slice().sort((a,b)=>rank(a.type)-rank(b.type))});
  }); },
  openManager(e) {
    const type = e.currentTarget.dataset.type;
    if (!this.data.managers.some(m => m.type === type)) return;
    wx.navigateTo({ url: ['checkin','focus','search','backup','loans','food','review','timeline','settings'].includes(type) ? '/pages/' + type + '/index' : '/pages/life/index?type=' + type });
  },
  openAlert(e) { wx.navigateTo({ url: '/pages/life/index?type=' + e.currentTarget.dataset.type + '&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  openSchedule() { wx.navigateTo({ url: '/pages/schedule/index' }); },
  openNotes() { wx.navigateTo({ url: '/pages/notes/index' }); },
  onToolSearch(e) { this.setData({ toolQuery: e.detail.value }); this.filterTools(); },
  onToolCategory(e) { this.setData({ toolCategory: e.currentTarget.dataset.category }); this.filterTools(); },
  resetToolFilters() { this.setData({ toolQuery: '', toolCategory: '全部' }); this.filterTools(); },
  openTool(e) {
    const tool = TOOLS.find(item => item.id === e.currentTarget.dataset.id);
    if (!tool) return;
    const spec = extra.definitions[tool.id];
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    this.setData({ activeTool: tool.id, activeTitle: tool.title, activeDescription: tool.description,
      extraSpec: spec ? { title: spec.title, hint: spec.hint, button: spec.button } : null,
      extraForm: extra.form(tool.id, today, this.data.extraValues[tool.id]), extraResult: null });
  },
  onCalculatorInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.extraForm.some(field => field.key === key)) return;
    const form = this.data.extraForm.map(field => Object.assign({}, field, field.key === key ? { value: e.detail.value } : {}));
    const values = {};
    form.forEach(field => { values[field.key] = field.value; });
    this.setData({ extraForm: form, extraValues: Object.assign({}, this.data.extraValues, { [this.data.activeTool]: values }), extraResult: null });
  },
  calculateExtra() {
    return attempt(async () => {
      const values = {};
      this.data.extraForm.forEach(field => { values[field.key] = field.value; });
      this.setData({ extraResult: extra.calculate(this.data.activeTool, values) });
    });
  },
  preventToolTouch() {},
  backToTools() { this.setData({ activeTool: '', activeTitle: '', activeDescription: '' }); },
  // 字段白名单防止无意修改其他页面状态；输入变化时立即清除旧结果。
  onExtraInput(e) {
    const field = e.currentTarget.dataset.field;
    const resultFields = {
      dateStart: 'dateResult', dateEnd: 'dateResult', bmiHeight: 'bmiResult', bmiWeight: 'bmiResult',
      savingsTarget: 'savingsResult', savingsCurrent: 'savingsResult', savingsMonthly: 'savingsResult',
      discountOriginal: 'discountResult', discountFold: 'discountResult', discountCoupon: 'discountResult',
      randomOptions: 'randomResult'
    };
    if (!Object.prototype.hasOwnProperty.call(resultFields, field)) return;
    this.setData({ [field]: e.detail.value, [resultFields[field]]: null });
  },
  calculateDate() {
    return attempt(async () => {
      const days = calc.dateDiff(this.data.dateStart, this.data.dateEnd);
      this.setData({ dateResult: { days: Math.abs(days), weeks: Math.floor(Math.abs(days) / 7),
        remainder: Math.abs(days) % 7, direction: days === 0 ? '开始与结束是同一天' : (days > 0 ? '结束日期晚于开始日期' : '结束日期早于开始日期') } });
    });
  },
  calculateBMI() { return attempt(async () => { this.setData({ bmiResult: calc.bmi(this.data.bmiHeight, this.data.bmiWeight) }); }); },
  calculateSavings() {
    return attempt(async () => { this.setData({ savingsResult: calc.savings(this.data.savingsTarget, this.data.savingsCurrent, this.data.savingsMonthly) }); });
  },
  calculateDiscount() {
    return attempt(async () => { this.setData({ discountResult: calc.discount(this.data.discountOriginal, this.data.discountFold, this.data.discountCoupon) }); });
  },
  chooseRandom() { return attempt(async () => { this.setData({ randomResult: calc.randomChoice(this.data.randomOptions) }); }); },
  onTextInput(e) { this.setData({ textValue: e.detail.value, textResult: calc.textStats(e.detail.value) }); },
  clearText() { this.setData({ textValue: '', textResult: calc.textStats('') }); },
  onPrincipal(e) { this.setData({ principal: e.detail.value, mortgage: null }); },
  onRate(e) { this.setData({ annualRate: e.detail.value, mortgage: null }); },
  onYears(e) { this.setData({ years: e.detail.value, mortgage: null }); },
  onMethod(e) { this.setData({ method: Number(e.detail.value), mortgage: null }); },
  calculateMortgage() {
    return attempt(async () => {
      const principalWan = numberInput(this.data.principal, '贷款金额');
      const rate = numberInput(this.data.annualRate, '年利率');
      const years = numberInput(this.data.years, '贷款年限');
      if (principalWan <= 0 || principalWan > 10000) throw new Error('贷款金额应大于 0，且不超过 10000 万元');
      if (rate < 0 || rate > 30) throw new Error('年利率范围为 0～30%');
      if (!Number.isInteger(years) || years < 1 || years > 50) throw new Error('贷款年限应为 1～50 的整数');
      const principal = principalWan * 10000;
      const months = years * 12;
      const monthlyRate = rate / 100 / 12;
      let first, last, interest;
      if (this.data.method === 0) {
        // 以折现因子求和计算月供，兼容零利率与极小利率。
        let factor = 1;
        let sum = 0;
        for (let i = 0; i < months; i += 1) {
          factor /= 1 + monthlyRate;
          sum += factor;
        }
        first = principal / sum;
        last = first;
        interest = Math.max(0, first * months - principal);
      } else {
        const monthlyPrincipal = principal / months;
        first = monthlyPrincipal + principal * monthlyRate;
        last = monthlyPrincipal + monthlyPrincipal * monthlyRate;
        interest = principal * monthlyRate * (months + 1) / 2;
      }
      this.setData({ mortgage: {
        methodText: this.data.methods[this.data.method],
        monthlyLabel: this.data.method === 0 ? '每月还款（元）' : '首月还款（元）',
        first: amount(first), last: amount(last), interest: amount(interest),
        total: amount(principal + interest), months, decreasing: this.data.method === 1
      } });
    });
  },
  onType(e) {
    const type = Number(e.detail.value);
    this.setData({ type, units: UNITS[type].names, from: 0, to: 1, unitResult: '', unitError: '' });
  },
  onFrom(e) { this.setData({ from: Number(e.detail.value), unitResult: '', unitError: '' }); },
  onTo(e) { this.setData({ to: Number(e.detail.value), unitResult: '', unitError: '' }); },
  onUnitValue(e) { this.setData({ unitValue: e.detail.value, unitResult: '', unitError: '' }); },
  swapUnits() {
    this.setData({ from: this.data.to, to: this.data.from, unitResult: '', unitError: '' });
  },
  calculateUnit() {
    return attempt(async () => {
      const input = numberInput(this.data.unitValue, '待换算数值');
      const type = this.data.type;
      const from = this.data.from;
      const to = this.data.to;
      let result;
      if (type === 2) {
        const celsius = from === 0 ? input : (from === 1 ? (input - 32) * 5 / 9 : input - 273.15);
        if (celsius < -273.15 - 1e-9) throw new Error('温度不能低于绝对零度（−273.15 ℃）');
        result = to === 0 ? celsius : (to === 1 ? celsius * 9 / 5 + 32 : celsius + 273.15);
      } else {
        if (input < 0) throw new Error('长度和重量不能为负数');
        result = input * UNITS[type].factors[from] / UNITS[type].factors[to];
      }
      if (!Number.isFinite(result)) throw new Error('数值过大，请缩小后重试');
      // 保留约 10 位有效数字，极大或极小数使用科学计数法，避免显示为零。
      const formatted = Number(result.toPrecision(10)).toString();
      this.setData({ unitResult: formatted + ' ' + this.data.units[to] });
    });
  }
});
