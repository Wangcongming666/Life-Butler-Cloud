const store = require('../../utils/storage'), checkin = require('../../utils/checkin');
const {attempt} = require('../../utils/ui');
require('../../utils/page-sync').definePage({
  data: {today: '', month: '', monthLabel: '', stats: {}, days: [], monthCount: 0, busy: false, weekdays: ['一','二','三','四','五','六','日']},
  onShow() { this.refresh(); },
  refresh() {
    return attempt(() => {
      const records = store.read().signins || [], stats = checkin.stats(records), currentMonth = stats.today.slice(0, 7);
      const month = this.data.month || currentMonth, days = checkin.calendar(month, records);
      this.setData({stats, today: stats.today, month, monthLabel: month.slice(0, 4) + ' 年 ' + Number(month.slice(5)) + ' 月', days, monthCount: days.filter(day => day.checked).length, canNext: month < currentMonth});
    });
  },
  onMonth(e) {
    const value = e.detail.value.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value > this.data.today.slice(0, 7) || value < '1970-01') return;
    this.setData({month: value}); this.refresh();
  },
  changeMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (delta !== -1 && delta !== 1) return;
    const parts = this.data.month.split('-').map(Number), shifted = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1)).toISOString().slice(0, 7);
    this.onMonth({detail: {value: shifted}});
  },
  async signIn() {
    if (this.data.busy || this.data.stats.signedToday) return;
    this.setData({busy: true});
    try { await attempt(async () => {
      await store.checkInToday(); this.refresh(); wx.showToast({title: '今日已签到', icon: 'success'});
    }); } finally { this.setData({busy: false}); }
  }
});