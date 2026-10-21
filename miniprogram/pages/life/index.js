const cloudMedia=require('../../utils/media');
const store = require('../../utils/storage');
const life = require('../../utils/life');
const media = require('../../utils/media');
const { attempt } = require('../../utils/ui');
const appearance = require('../../utils/appearance');
const INFO = {
  homework: { subtitle: '把课程要求和截止时间放在一起', dateLabel: '截止日期', doneText: '已完成', action: '完成作业' },
  assets: { subtitle: '购买凭证、保修时间和存放位置', dateLabel: '保修结束日期（可选）', doneText: '已归档', action: '归档' },
  shopping: { subtitle: '先列清单，再慢慢挑选', doneText: '已购买', action: '标记已买' },
  habits: { subtitle: '每天一点点，记录自己的坚持', doneText: '已停用', action: '停用习惯' },
  countdown: { subtitle: '重要的日子，记得留个位置', dateLabel: '目标日期', doneText: '已归档', action: '归档' },
  expiry: { subtitle: '先用临期的，让物品物尽其用', dateLabel: '到期日期', doneText: '已用完', action: '标记用完' },
  budget: { subtitle: '每月花多少，心里有个数' }
};
function ds(e) { return e.currentTarget.dataset; }
function draft(type) { return { id: '', type, title: '', note: '', date: ['homework', 'countdown', 'expiry'].includes(type) ? life.today() : '', time: '23:59', purchaseDate: '', place: '', amount: '', quantity: '1', courseId: '', courseTitle: '', sourceNoteId: '', images: [] }; }
require('../../utils/page-sync').definePage({
  data: { type: 'homework', title: '', info: {}, records: [], courses: [], courseNames: ['不关联课程'], courseIndex: 0,
    formVisible: false, formError: '', detailRecord: null, draft: {}, busy: false, query: '', filter: 'all', filters: [{ id: 'all', title: '全部' }, { id: 'pending', title: '未完成' }, { id: 'done', title: '已完成' }],
    month: life.today().slice(0, 7), monthDate: life.today().slice(0, 7) + '-01', budgetTotal: '', budgetLines: '', budgetView: {}, budgetFormVisible: false, budgetBusy: false,
    habitId: '', habitTitle: '', calendar: [], weekdays: ['一', '二', '三', '四', '五', '六', '日'], summary: '', scrollTarget: '' },
  onLoad(options) {
    const type = options && options.type || 'homework';
    if (!INFO[type]) return;
    this.setData({ type, title: life.TITLES[type], info: INFO[type] });
    if (type === 'budget' && /^\d{4}-(0[1-9]|1[0-2])$/.test(options.month || '') && options.month >= '1970-01' && options.month <= '2100-12') this.setData({ month: options.month, monthDate: options.month + '-01' });
    this.refresh();
    if (options.id) this.edit({ currentTarget: { dataset: { id: options.id } } });
    if (options.courseId) {
      const course = this.data.courses.find(c => c.id === options.courseId);
      this.add();
      if (course) this.setData({ draft: Object.assign({}, this.data.draft, { courseId: course.id, courseTitle: course.title }), courseIndex: this.data.courses.indexOf(course) + 1 });
    }
  },
  onShow() { appearance.apply(this); this.refresh(); },
  refresh() {
    return attempt(async () => {
      const data = store.read(), type = this.data.type, q = this.data.query.trim().toLowerCase();
      const records = data.life.records.filter(r => r.type === type && (!q || (r.title + r.note + r.place + r.courseTitle).toLowerCase().includes(q)) &&
        (this.data.filter === 'all' || (this.data.filter === 'done' ? r.done : !r.done))).sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          return a.date && b.date ? (a.date + a.time).localeCompare(b.date + b.time) : b.updatedAt - a.updatedAt;
        }).map(r => {
          const delta = r.date ? life.daysUntil(r.date) : null;
          return Object.assign({}, r, { amountText: r.amountCents === null ? '' : store.money(r.amountCents),
            dateHint: delta === null ? '' : delta < 0 ? '已过 ' + -delta + ' 天' : delta === 0 ? '今天' : '还有 ' + delta + ' 天',
            urgent: !r.done && delta !== null && delta <= 7,
            checkedToday: r.checkins.includes(life.today()), streak: life.streak(r.checkins), checkinCount: r.checkins.length,
            updatedText: store.dateText(r.updatedAt) + ' ' + store.timeText(r.updatedAt) });
        });
      this.setData({ records, courses: data.schedule.courses, courseNames: ['不关联课程'].concat(data.schedule.courses.map(c => c.title)),
        summary: type === 'shopping' ? '待购预算 ¥ ' + store.money(data.life.records.filter(r => r.type === 'shopping' && !r.done).reduce((sum, r) => sum + (r.amountCents || 0) * r.quantity, 0)) : records.length + ' 条记录' });
      if (this.data.detailRecord) this.setData({ detailRecord: records.find(r => r.id === this.data.detailRecord.id) || null });
      if (type === 'budget') this.refreshBudget(data);
      if (this.data.habitId) this.showCalendar(this.data.habitId, data);
    });
  },
  refreshBudget(data) {
    const view = life.budget(data, this.data.month), record = data.life.budgets.find(b => b.month === this.data.month);
    this.setData({ budgetView: Object.assign({}, view, { spentText: store.money(view.spent), totalText: view.total === null ? '未设置' : store.money(view.total),
      remainingText: view.remaining === null ? '—' : store.money(Math.abs(view.remaining)), over: view.remaining !== null && view.remaining < 0,
      categories: view.categories.map(c => Object.assign({}, c, { spentText: store.money(c.spent), limitText: c.limit === null ? '未设上限' : '预算 ¥' + store.money(c.limit) })) }),
      budgetTotal: this._budgetDirty ? this.data.budgetTotal : record ? store.money(record.totalCents) : '', budgetLines: this._budgetDirty ? this.data.budgetLines : record ? record.categories.map(c => c.name + ' ' + store.money(c.cents)).join('\n') : '' });
  },
  onSearch(e) { this.setData({ query: e.detail.value }); this.refresh(); },
  onFilter(e) { this.setData({ filter: ds(e).id }); this.refresh(); },
  add() { if (!this.data.busy) this.setData({ draft: draft(this.data.type), courseIndex: 0, formVisible: true, formError: '', detailRecord: null, habitId: '', scrollTarget: '' }); },
  edit(e) {
    if (this.data.busy) return;
    attempt(async () => {
      const r = store.read().life.records.find(r => r.id === ds(e).id && r.type === this.data.type);
      if (!r) throw new Error('记录已不存在');
      const index = this.data.courses.findIndex(c => c.id === r.courseId);
      this.setData({ draft: Object.assign({}, r, { images: r.images.slice(), amount: r.amountCents === null ? '' : store.money(r.amountCents) }), courseIndex: index + 1, formVisible: true, formError: '', detailRecord: null, habitId: '', scrollTarget: '' });
    });
  },
  stopDialogTap() {},
  openDetail(e) {
    if (this.data.busy || this.data.formVisible) return;
    const record = this.data.records.find(r => r.id === ds(e).id);
    if (record) this.setData({ detailRecord: record, habitId: '', scrollTarget: '' });
  },
  closeDetail() { if (!this.data.busy) this.setData({ detailRecord: null }); },
  onField(e) {
    if (this.data.busy) return;
    const key = ds(e).key;
    if (['title', 'note', 'date', 'time', 'purchaseDate', 'place', 'amount', 'quantity'].includes(key)) this.setData({ draft: Object.assign({}, this.data.draft, { [key]: e.detail.value }) });
  },
  clearDate() { if (!this.data.busy) this.setData({ draft: Object.assign({}, this.data.draft, { date: '' }) }); },
  onCourse(e) {
    if (this.data.busy) return;
    const index = Number(e.detail.value), course = this.data.courses[index - 1];
    this.setData({ courseIndex: index, draft: Object.assign({}, this.data.draft, { courseId: course ? course.id : '', courseTitle: course ? course.title : '' }) });
  },
  closeForm() {
    if (this.data.busy) return;
    wx.showModal({ title: '放弃本次编辑？', content: '未保存的修改将丢失。', success: async r => { if (r.confirm && !this.data.busy) this.setData({ formVisible: false, scrollTarget: '' }); } });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, formError: '' });
    try { await store.saveLifeRecord(this.data.draft); this.setData({ formVisible: false, scrollTarget: '' }); this.refresh(); wx.showToast({ title: '已保存', icon: 'success' }); }
    catch (e) { this.setData({ formError: e.message || '请重试' }); this.error(e); } finally { this.setData({ busy: false }); }
  },
  error(e) { wx.showModal({ title: '操作未完成', content: e.message || '请重试', showCancel: false }); },
  async remove(e) {
    if (this.data.busy) return;
    wx.showModal({ title: '删除这条记录？', content: '记录及不再引用的附件将被删除。', confirmColor: '#aa5849', success: async r => {
      if (r.confirm && !this.data.busy) attempt(async () => { await store.removeLifeRecord(ds(e).id); this.refresh(); });
    } });
  },
  async toggle(e) { if (!this.data.busy) attempt(async () => { await store.toggleLifeRecord(ds(e).id); this.refresh(); }); },
  async chooseImage(e) {
    if (this.data.busy || this.data.draft.images.length >= 6) return;
    this.setData({ busy: true });
    try {
      const source = ds(e).source, paths = await media.choose(source === 'camera' ? 1 : 6 - this.data.draft.images.length, source);
      this.setData({ draft: Object.assign({}, this.data.draft, { images: this.data.draft.images.concat(paths) }) });
    } catch (e) { this.error(e); } finally { this.setData({ busy: false }); }
  },
  removeImage(e) { if (!this.data.busy) this.setData({ draft: Object.assign({}, this.data.draft, { images: this.data.draft.images.filter((p, i) => i !== Number(ds(e).index)) }) }); },
  preview(e) {
    const record = ds(e).id ? this.data.records.find(r => r.id === ds(e).id) : this.data.draft;
    if (record && record.images.length) cloudMedia.preview({ urls: record.images, current: record.images[Number(ds(e).index) || 0] });
  },
  onMonth(e) {
    if (this.data.budgetBusy || this.data.budgetFormVisible) return;
    this._budgetDirty=false;require('../../utils/sync').getDefault().endEdit(this._cloudEditTokens);this._cloudEditTokens={};
    this.setData({ month: e.detail.value.slice(0, 7), monthDate: e.detail.value.slice(0, 7) + '-01' }); this.refresh();
  },
  openBudgetForm() {
    if (this.data.budgetBusy || this.data.budgetFormVisible) return;
    this._budgetDirty = false;
    this.refreshBudget(store.read());
    const service = require('../../utils/sync').getDefault();
    this._cloudEditTokens = this._cloudEditTokens || {};
    this._cloudEditTokens['budgets:' + this.data.month] = service.beginEdit('budgets', this.data.month);
    this._budgetDirty = true;
    this.setData({ budgetFormVisible: true });
  },
  finishBudgetEdit() {
    this._budgetDirty = false;
    require('../../utils/sync').getDefault().endEdit(this._cloudEditTokens);
    this._cloudEditTokens = {};
    this.setData({ budgetFormVisible: false });
  },
  closeBudgetForm() { if (!this.data.budgetBusy) { this.finishBudgetEdit(); this.refresh(); } },
  stopBudgetTap() {},
  onBudget(e) { if (this.data.budgetBusy) return; const key = ds(e).key; if (['budgetTotal', 'budgetLines'].includes(key)) this.setData({ [key]: e.detail.value }); },
  async saveBudget() {
    if (this.data.budgetBusy) return;
    this.setData({ budgetBusy: true });
    try { return await attempt(async () => {
      const lines = this.data.budgetLines.trim().split('\n').filter(s => s.trim());
      const categories = lines.map(line => {
        const match = line.trim().match(/^(.+?)\s+(\d+(?:\.\d{1,2})?)$/);
        if (!match) throw new Error('分类格式：餐饮 800，每行一项');
        return { name: match[1], amount: match[2] };
      });
      await store.saveBudget({ month: this.data.month, total: this.data.budgetTotal, categories }); this.finishBudgetEdit();this.refresh(); wx.showToast({ title: '预算已保存', icon: 'success' });
    }); } finally { this.setData({ budgetBusy: false }); }
  },
  async removeBudget() {
    if (this.data.budgetBusy) return;
    const month = this.data.month;
    this.setData({ budgetBusy: true });
    wx.showModal({ title: '删除 ' + month + ' 预算？', content: '已有账目会保留。', success: async r => {
      try {
        if (r.confirm) await attempt(async () => {
          await store.removeBudget(month);
          this.finishBudgetEdit();
          this.refresh();
        });
      } finally { this.setData({ budgetBusy: false }); }
    }, fail: () => this.setData({ budgetBusy: false }) });
  },
  async checkin(e) { return attempt(async () => { await store.toggleCheckin(ds(e).id, life.today()); this.refresh(); }); },
  openCalendar(e) { if (this.data.busy || this.data.formVisible) return; this.showCalendar(ds(e).id, store.read()); this.setData({ detailRecord: null, scrollTarget: '' }); },
  closeCalendar() { if (!this.data.busy) this.setData({ habitId: '', habitTitle: '', calendar: [] }); },
  showCalendar(id, data) {
    const r = data.life.records.find(r => r.id === id);
    this.setData({ habitId: r ? id : '', habitTitle: r ? r.title : '', calendar: r ? life.calendar(this.data.month, r.checkins) : [] });
  },
  async calendarCheck(e) {
    const date = ds(e).date;
    if (!date || !this.data.habitId || this.data.busy) return;
    this.setData({ busy: true });
    try { await attempt(async () => { await store.toggleCheckin(this.data.habitId, date); this.refresh(); }); }
    finally { this.setData({ busy: false }); }
  }
});
