const store = require('../../utils/storage');
const { attempt } = require('../../utils/ui');
const { syncTab, takeSearch } = require('../../utils/navigation');
const PAGE_SIZE = 20;
function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '1970-01' && value <= '2100-12'; }
const CATEGORY_STYLE = {
  餐饮: ['食', 'mint'], 交通: ['行', 'blue'], 购物: ['购', 'rose'], 居家: ['家', 'sand'],
  娱乐: ['乐', 'blue'], 健康: ['健', 'mint'], 学习: ['学', 'sand'], 其他: ['记', 'gray']
};

require('../../utils/page-sync').definePage({
  data: {
    monthLabel: '', monthTotal: '0.00', monthCount: 0, expenses: [],
    categories: ['餐饮', '交通', '购物', '居家', '娱乐', '健康', '学习', '其他'],
    categoryIndex: 0, amount: '', note: '', showAll: true, selectedMonth: '', visibleLimit: PAGE_SIZE,
    hasMore: false, categoryStats: [], editingId: '', originalTime: 0, formVisible: false, saving: false,
    date: '', time: '', scrollTarget: ''
  },
  onShow() {
    syncTab(this, 1);
    if (!this.data.date) this.setData({ date: store.dateText(Date.now()), time: store.timeText(Date.now()) });
    this.refresh();
    const pending = takeSearch('记账');
    if (pending) { this.setData({ showAll: true }); this.refresh(); this.openEdit({ currentTarget: { dataset: { id: pending.id } } }); }
  },
  openBudget() { wx.navigateTo({ url: '/pages/life/index?type=budget' + (this.data.showAll ? '' : '&month=' + this.data.selectedMonth) }); },
  openMonthlyReview() { wx.navigateTo({ url: '/pages/review/index?month=' + (this.data.showAll ? store.dateText(Date.now()).slice(0, 7) : this.data.selectedMonth) }); },
  refresh() {
    return attempt(async () => {
      const data = store.read();
      const month = validMonth(this.data.selectedMonth) ? this.data.selectedMonth : store.dateText(Date.now()).slice(0, 7);
      const [year, monthNumber] = month.split('-').map(Number);
      const list = (this.data.showAll ? data.expenses : store.monthExpenses(data, new Date(year, monthNumber - 1, 1).getTime()))
        .slice().sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      // 汇总完整筛选结果，再分页展示，避免未加载的账目漏算。
      const totals = new Map();
      list.forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + item.amountCents));
      this.setData({ selectedMonth: month, monthLabel: this.data.showAll ? '全部月份' : year + ' 年 ' + monthNumber + ' 月',
        monthTotal: store.money(list.reduce((sum, item) => sum + item.amountCents, 0)), monthCount: list.length,
        categoryStats: Array.from(totals, ([name, cents]) => ({ name, cents, amount: store.money(cents) })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
        hasMore: list.length > this.data.visibleLimit,
        expenses: list.slice(0, this.data.visibleLimit).map((item, index, sorted) => {
          const style = CATEGORY_STYLE[item.category] || CATEGORY_STYLE.其他;
          const date = store.dateText(item.createdAt);
          return Object.assign({}, item, {
            amountText: store.money(item.amountCents), dateText: date + ' ' + store.timeText(item.createdAt),
            updatedText: item.updatedAt === undefined ? '暂无记录' : store.dateText(item.updatedAt) + ' ' + store.timeText(item.updatedAt) + ':' + String(new Date(item.updatedAt).getSeconds()).padStart(2, '0'),
            icon: style[0], tone: style[1], dayLabel: date === store.dateText(Date.now()) ? '今天' : date.replace(/-/g, '.'),
            showDay: index === 0 || store.dateText(sorted[index - 1].createdAt) !== date
          });
        })
      });
    });
  },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onCategory(e) { this.setData({ categoryIndex: Number(e.detail.value) }); },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onTime(e) { this.setData({ time: e.detail.value }); },
  onScope(e) { this.setData({ showAll: Boolean(e.detail.value), visibleLimit: PAGE_SIZE }); return this.refresh(); },
  onMonth(e) {
    if (!validMonth(e.detail.value)) return;
    this.setData({ selectedMonth: e.detail.value, showAll: false, visibleLimit: PAGE_SIZE });
    return this.refresh();
  },
  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ visibleLimit: this.data.visibleLimit + PAGE_SIZE });
    return this.refresh();
  },
  openAdd() {
    if (this.data.saving) return;
    this.resetForm();
    this.setData({ formVisible: true, categoryIndex: 0 });
  },
  closeForm() { if (!this.data.saving) this.resetForm(); },
  stopFormTap() {},
  openEdit(e) {
    if (this.data.saving) return;
    return attempt(async () => {
      const item = store.read().expenses.find(entry => entry.id === e.currentTarget.dataset.id);
      if (!item) throw new Error('该账目已不存在，请刷新后重试');
      const categories = this.data.categories.slice();
      if (!categories.includes(item.category)) categories.push(item.category);
      this.setData({ formVisible: true, editingId: item.id, originalTime: item.createdAt, amount: store.money(item.amountCents),
        categories, categoryIndex: categories.indexOf(item.category), note: item.note,
        date: store.dateText(item.createdAt), time: store.timeText(item.createdAt),
        scrollTarget: '' });
    });
  },
  resetForm() {
    this.setData({ formVisible: false, editingId: '', originalTime: 0, amount: '', note: '',
      date: store.dateText(Date.now()), time: store.timeText(Date.now()) });
  },
  cancelEdit() { this.closeForm(); },
  entryTime() {
    if (!this.data.date && !this.data.time) return Date.now();
    // 未调整日期/分钟时保留原来的秒和毫秒，避免只改金额就影响排序。
    if (this.data.editingId && this.data.date === store.dateText(this.data.originalTime) && this.data.time === store.timeText(this.data.originalTime)) return this.data.originalTime;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(this.data.time)) throw new Error('请选择记账日期和时间');
    const day = this.data.date.split('-').map(Number), time = this.data.time.split(':').map(Number);
    const value = new Date(day[0], day[1] - 1, day[2], time[0], time[1]).getTime();
    if (store.dateText(value) !== this.data.date || store.timeText(value) !== this.data.time) throw new Error('记账日期或时间无效');
    return value;
  },
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try { return await attempt(async () => {
      const editing = Boolean(this.data.editingId);
      const input = { amount: this.data.amount, category: this.data.categories[this.data.categoryIndex], note: this.data.note, createdAt: this.entryTime() };
      if (editing) await store.updateExpense(this.data.editingId, input);
      else await store.addExpense(input);
      this.resetForm();
      this.refresh();
      wx.showToast({ title: editing ? '修改已保存' : '已记一笔', icon: 'success' });
    }); } finally { this.setData({ saving: false }); }
  },
  async remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除账目', content: '删除后无法撤销，账单统计会同步更新。', confirmColor: '#aa5849',
      success: async result => { if (result.confirm) attempt(async () => { await store.removeExpense(id); if (id === this.data.editingId) this.resetForm(); this.refresh(); }); }
    });
  }
});
