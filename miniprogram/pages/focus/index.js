const store = require('../../utils/storage');
const life = require('../../utils/life');
const { attempt } = require('../../utils/ui');
const appearance = require('../../utils/appearance');
require('../../utils/page-sync').definePage({
  data: { timer: null, display: '25:00', mode: 'focus', minutes: '25', todayMinutes: 0, todayCount: 0, history: [], timerFormVisible: false, timerBusy: false, timerError: '' },
  onShow() { appearance.apply(this); this.stopTick(); this.refresh(); this._interval = setInterval(() => this.refresh(), 1000); },
  onHide() { this.stopTick(); },
  onUnload() { this.stopTick(); },
  stopTick() { if (this._interval) clearInterval(this._interval); this._interval = null; },
  async refresh() {
    if(this._refreshing)return;this._refreshing=true;
    try { return await attempt(async () => {
      const completed = await store.settleTimer(), data = store.read(), t = data.life.timer;
      const configured = Number(this.data.minutes), idleSeconds = Number.isInteger(configured) && configured >= 1 && configured <= 180 ? configured * 60 : 0;
      const seconds = t ? t.status === 'paused' ? t.remaining : Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : idleSeconds;
      const today = data.life.sessions.filter(s => s.mode === 'focus' && life.today(s.finishedAt) === life.today());
      this.setData({ timer: t, display: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'),
        todayMinutes: Math.round(today.reduce((n, s) => n + s.seconds, 0) / 60), todayCount: today.length,
        history: data.life.sessions.slice().reverse().slice(0, 20).map(s => ({ id: s.id, title: s.mode === 'focus' ? '专注完成' : '休息结束', minutes: s.seconds / 60, time: store.dateText(s.finishedAt) + ' ' + store.timeText(s.finishedAt) })) });
      if (completed) {
        wx.showModal({ title: completed === 'focus' ? '专注完成' : '休息结束', content: completed === 'focus' ? '辛苦了，给自己一点休息时间。' : '准备好开始下一段专注了吗？', showCancel: false });
        if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
      }
    }); } finally {this._refreshing=false;}
  },
  preventTimerTouch() {},
  openTimerSettings() { if (this.data.timer || this.data.timerBusy) return; this._minutesBeforeEdit = this.data.minutes; this.setData({ timerFormVisible: true, timerError: '' }); },
  closeTimerSettings() { if (this.data.timerBusy) return; this.setData({ timerFormVisible: false, timerError: '', minutes: this._minutesBeforeEdit || this.data.minutes }); this.refresh(); },
  onMinutes(e) { if (this.data.timerBusy) return; if (!this.data.timer) { this.setData({ minutes: e.detail.value }); } },
  setMode(e) {
    if (this.data.timer || this.data.timerBusy) return;
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode, minutes: mode === 'focus' ? '25' : '5' }); this.refresh();
  },
  async start() {
    if (this.data.timerBusy || this.data.timer) return;
    this.setData({ timerBusy: true, timerError: '' });
    try {
      const minutes = Number(this.data.minutes);
      if (!/^\d+$/.test(this.data.minutes) || minutes < 1 || minutes > 180) throw new Error('计时范围为1～180分钟');
      await store.startTimer(this.data.mode, minutes); this.setData({ timerFormVisible: false }); await this.refresh();
    } catch (error) { this.setData({ timerError: error.message || '计时未能开始，请重试' }); }
    finally { this.setData({ timerBusy: false }); }
  },
  async pause() { return attempt(async () => { await store.pauseTimer(); this.refresh(); }); },
  async resume() { return attempt(async () => { await store.resumeTimer(); this.refresh(); }); },
  async cancel() {
    wx.showModal({ title: '放弃本次计时？', content: '本次不会计入已完成记录。', success: async r => { if (r.confirm) attempt(async () => { await store.cancelTimer(); this.refresh(); }); } });
  }
});
