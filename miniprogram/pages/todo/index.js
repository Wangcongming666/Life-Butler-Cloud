const cloudMedia=require('../../utils/media');
const store = require('../../utils/storage');
const { attempt } = require('../../utils/ui');
const { syncTab, takeSearch } = require('../../utils/navigation');
const media = require('../../utils/media');
const life = require('../../utils/life');
const reminders = require('../../utils/todo-reminders');
function rangeTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('请选择完整的日期和时间');
  const [y, m, d] = date.split('-').map(Number), [h, minute] = time.split(':').map(Number);
  const value = new Date(y, m - 1, d, h, minute).getTime();
  if (store.dateText(value) !== date || store.timeText(value) !== time) throw Error('日期或时间无效，请重新选择');
  return value;
}

require('../../utils/page-sync').definePage({
  data: {
    todos: [], pending: 0, completed: 0, overdueCount: 0, alerts: [], scrollTarget: '', filter: 1, remindingId: '',
    notificationStates: {}, notificationStatesLoaded: false, notificationStateError: '',
    query: '', sort: 0, rangeVisible: false, imageIndexes: {}, galleryMounted: false, galleryOpen: false, galleryImages: [], galleryStates: [], galleryCurrent: 0, galleryId: '', galleryTitle: '', galleryScrollTarget: '', zoomMounted: false, zoomOpen: false, zoomSource: '', zoomImageStyle: '', zoomTransform: '', zoomError: false,
    rangeActive: false, rangeStart: null, rangeEnd: null, rangeStartDate: '', rangeStartTime: '',
    rangeEndDate: '', rangeEndTime: '', rangeError: '', rangeLabel: '不限时间',
    formVisible: false, editingId: '', title: '', startDate: '', startTime: '', formError: '', date: '', time: '', images: [], saving: false, choosing: false, togglingId: ''
  },
  onLoad(options) { this._reminderTodoId = options && options.todoId; },
  async onShow() {
    syncTab(this, 0);
    const pending = takeSearch('待办') || (this._reminderTodoId ? {id: this._reminderTodoId} : null);
    this._reminderTodoId = '';
    if (pending) this.setData({ query: '', filter: 0, rangeActive: false, rangeLabel: '不限时间', scrollTarget: '' });
    await this.refresh();
    await this.refreshReminderStates();
    clearInterval(this._reminderInterval);
    if (this._cloudVisible) this._reminderInterval = setInterval(() => this.refreshReminderStates(), 30000);
    if (pending) {
      if (this.data.todos.some(item => item.id === pending.id)) this.openEdit({ currentTarget: { dataset: { id: pending.id } } });
      else wx.showToast({title: '该待办已不存在', icon: 'none'});
    }
  },
  openAlert(e) { wx.navigateTo({ url: '/pages/life/index?type=' + e.currentTarget.dataset.type + '&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  async refreshReminderStates() {
    if (this.data.remindingId) return;
    const token = (this._reminderStateToken || 0) + 1; this._reminderStateToken = token;
    try {
      const rows = await reminders.status(store.read().todos.map(item => item.id));
      if (token !== this._reminderStateToken) return;
      const states = {}; rows.forEach(row => { states[row.id] = row; });
      this.setData({notificationStates: states, notificationStatesLoaded: true, notificationStateError: ''});
    } catch (error) {
      if (token !== this._reminderStateToken) return;
      this.setData({notificationStatesLoaded: false, notificationStateError: error.message || '通知状态读取失败'});
    }
    await this.refresh();
  },
  async onNotificationChange(e) {
    if (this.data.remindingId || this.data.togglingId) return;
    const todo = store.read().todos.find(item => item.id === e.currentTarget.dataset.id);
    if (!todo) return;
    const enabled = !!e.detail.value;
    this._reminderStateToken = (this._reminderStateToken || 0) + 1;
    this.setData({remindingId: todo.id});
    try {
      const result = await (enabled ? reminders.subscribe(todo) : reminders.disable(todo));
      const state = {id: todo.id, dueAt: todo.dueAt, status: result.status, enabled: result.status === 'pending' || result.status === 'sending'};
      this.setData({notificationStates: Object.assign({}, this.data.notificationStates, {[todo.id]: state})});
      wx.showToast({title: state.enabled ? '已开启到期通知' : result.status === 'sent' ? '该任务已发送过通知' : '已关闭到期通知', icon: 'none'});
    } catch (error) { wx.showModal({title: '通知设置未保存', content: error.message, showCancel: false}); }
    finally {
      this.setData({remindingId: ''});
      await this.refresh();
      await this.refreshReminderStates();
    }
  },
  refresh() {
    return attempt(async () => {
      const data = store.read();
      const optimistic = this._optimisticTodo;
      const displayed = data.todos.map(item => optimistic && optimistic.id === item.id ? Object.assign({}, item, { done: optimistic.done, doneAt: optimistic.done ? optimistic.doneAt : undefined }) : item);
      const imageIndexes = {};
      displayed.forEach(item => {
        const saved = this.data.imageIndexes[item.id] || 0, last = Math.max(0, (item.images || []).length - 1);
        imageIndexes[item.id] = Math.min(Math.max(0, saved), last);
      });
      const query = this.data.query.trim().toLowerCase();
      const now = Date.now();
      const todos = displayed.filter(item =>
        (!query || item.title.toLowerCase().includes(query)) &&
        (!this.data.rangeActive || (item.dueAt >= this.data.rangeStart && item.dueAt <= this.data.rangeEnd)) &&
        ((optimistic && optimistic.id === item.id) || this.data.filter === 0 || (this.data.filter === 1 ? !item.done && item.dueAt >= now : this.data.filter === 3 ? !item.done && item.dueAt < now : item.done))
      ).sort((a, b) => {
        const delta = a.dueAt - b.dueAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
        return this.data.sort === 0 ? delta : -delta;
      }).map(item => {
        const saved = this.data.notificationStates[item.id];
        const notification = saved && saved.dueAt === item.dueAt ? saved : {status: 'off', enabled: false};
        const labels = {pending: '到期前30分钟提醒一次', sending: '正在发送', sent: '已发送', failed: '发送失败', unknown: '发送结果待确认'};
        return Object.assign({}, item, {
        notificationEnabled: !item.done && item.dueAt > now && notification.enabled,
        notificationLocked: !this.data.notificationStatesLoaded || ['sending', 'sent', 'failed', 'unknown'].includes(notification.status),
        notificationText: !this.data.notificationStatesLoaded ? (this.data.notificationStateError ? '通知设置暂不可用' : '正在读取通知设置') : labels[notification.status] || '关闭',
        images: item.images || [],
        startText: item.startAt === undefined ? '' : store.dateText(item.startAt) + ' ' + store.timeText(item.startAt),
        notStarted: !item.done && item.startAt !== undefined && item.startAt > now,
        dueText: store.dateText(item.dueAt) + ' ' + store.timeText(item.dueAt),
        completedLate: item.done && Number.isFinite(item.doneAt) && item.doneAt > item.dueAt,
        completedText: item.done && Number.isFinite(item.doneAt) ? store.dateText(item.doneAt) + ' ' + store.timeText(item.doneAt) : '',
        overdue: !item.done && item.dueAt < now
      });
      });
      this.setData({ todos, imageIndexes, overdueCount: displayed.filter(item => !item.done && item.dueAt < now).length, pending: displayed.filter(item => !item.done).length, completed: displayed.filter(item => item.done).length, alerts: data.preferences.showReminders ? life.alerts(data).slice(0,4) : [] });
    });
  },
  setDefaultRange() {
    const now = Date.now(), today = new Date(now), end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const date = store.dateText(now), time = store.timeText(now), endDate = store.dateText(end);
    this.setData({ rangeStartDate: date, rangeStartTime: time, rangeEndDate: endDate, rangeEndTime: '00:00', rangeError: '' });
  },
  onRangeChange(e) {
    const field = e.currentTarget.dataset.field;
    if (['rangeStartDate', 'rangeStartTime', 'rangeEndDate', 'rangeEndTime'].includes(field)) this.setData({ [field]: e.detail.value, rangeError: '' });
  },
  openRange() {
    const patch = { rangeVisible: true, rangeError: '' };
    if (this.data.rangeActive) Object.assign(patch, {
      rangeStartDate: store.dateText(this.data.rangeStart), rangeStartTime: store.timeText(this.data.rangeStart),
      rangeEndDate: store.dateText(this.data.rangeEnd), rangeEndTime: store.timeText(this.data.rangeEnd)
    });
    else this.setDefaultRange();
    this.setData(patch);
  },
  closeRange() { this.setData({ rangeVisible: false, rangeError: '' }); },
  stopRangeTap() {},
  toggleSort() { return this.onSort({ detail: { value: this.data.sort === 0 ? 1 : 0 } }); },
  applyRange() {
    try {
      const start = rangeTime(this.data.rangeStartDate, this.data.rangeStartTime), end = rangeTime(this.data.rangeEndDate, this.data.rangeEndTime);
      if (end < start) throw Error('结束时间不能早于开始时间');
      this.setData({ rangeActive: true, rangeStart: start, rangeEnd: end, rangeError: '', rangeVisible: false,
        rangeLabel: this.data.rangeStartDate + ' ' + this.data.rangeStartTime + ' — ' + this.data.rangeEndDate + ' ' + this.data.rangeEndTime });
      return this.refresh();
    } catch (error) { this.setData({ rangeError: error.message }); }
  },
  resetRange() { this.setDefaultRange(); },
  toggleRangeFilter() { return this.onRangeEnabled({ detail: { value: this.data.rangeActive ? [] : ['time-range'] } }); },
  onRangeEnabled(e) {
    const enabled = e.detail.value.includes('time-range');
    if (!enabled) return this.clearRange();
    if (Number.isFinite(this.data.rangeStart) && Number.isFinite(this.data.rangeEnd)) {
      this.setData({ rangeActive: true, rangeLabel: store.dateText(this.data.rangeStart) + ' ' + store.timeText(this.data.rangeStart) + ' — ' + store.dateText(this.data.rangeEnd) + ' ' + store.timeText(this.data.rangeEnd) });
      return this.refresh();
    }
    this.setDefaultRange();
    return this.applyRange();
  },
  clearRange() { this.setData({ rangeActive: false, rangeVisible: false, rangeError: '', rangeLabel: '不限时间' }); return this.refresh(); },
  onQuery(e) { this.setData({ query: e.detail.value }); this.refresh(); },
  onFilter(e) { this.setData({ filter: Number(e.detail.value) }); return this.refresh(); },
  onStatus(e) { const filter = Number(e.currentTarget.dataset.filter); if (filter === 1 || filter === 2 || filter === 3) return this.onFilter({ detail: { value: filter } }); },
  onSort(e) { this.setData({ sort: Number(e.detail.value) }); return this.refresh(); },
  onTitle(e) { this.setData({ title: e.detail.value }); },
  onDate(e) { this.setData({ date: e.detail.value, formError: '' }); },
  onTime(e) { this.setData({ time: e.detail.value, formError: '' }); },
  onStartDate(e) { this.setData({ startDate: e.detail.value, formError: '' }); },
  onStartTime(e) { this.setData({ startTime: e.detail.value, formError: '' }); },
  openAdd() {
    if (this.data.saving || this.data.choosing) return;
    const now = Date.now();
    this.setData({ formVisible: true, editingId: '', title: '', startDate: store.dateText(now), startTime: store.timeText(now), formError: '', date: store.dateText(now + 3600000), time: store.timeText(now + 3600000), images: [] });
  },
  openEdit(e) {
    if (this.data.saving || this.data.choosing) return;
    const item = this.data.todos.find(todo => todo.id === e.currentTarget.dataset.id);
    if (!item) return;
    const startAt = item.startAt === undefined ? Math.min(item.createdAt, item.dueAt) : item.startAt;
    this.setData({ formVisible: true, editingId: item.id, title: item.title, startDate: store.dateText(startAt), startTime: store.timeText(startAt), formError: '',
      date: store.dateText(item.dueAt), time: store.timeText(item.dueAt), images: (item.images || []).slice() });
  },
  closeForm() { if (!this.data.saving && !this.data.choosing) this.setData({ formVisible: false, images: [] }); },
  async chooseImages() {
    if (this.data.saving || this.data.choosing || this.data.images.length >= media.MAX_IMAGES) return;
    this.setData({ choosing: true });
    try {
      const paths = await media.choose(media.MAX_IMAGES - this.data.images.length);
      this.setData({ images: Array.from(new Set(this.data.images.concat(paths))) });
    } catch (error) { wx.showModal({ title: '选图未完成', content: error.message, showCancel: false }); }
    finally { this.setData({ choosing: false }); }
  },
  removeDraftImage(e) {
    if (this.data.saving || this.data.choosing) return;
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ images: this.data.images.filter((path, i) => i !== index) });
  },
  previewDraftImage(e) {
    const path = this.data.images[Number(e.currentTarget.dataset.index)];
    if (path) cloudMedia.preview({ current: path, urls: this.data.images });
  },
  onTodoImageChange(e) {
    const id = e.currentTarget.dataset.id, current = Number(e.detail.current);
    const item = this.data.todos.find(todo => todo.id === id);
    if (!item || !Number.isInteger(current) || current < 0 || current >= item.images.length) return;
    this.setData({imageIndexes: Object.assign({}, this.data.imageIndexes, {[id]: current})});
  },
  previewTodoImage(e) {
    const todo = this.data.todos.find(item => item.id === e.currentTarget.dataset.id);
    if (!todo || !todo.images || !todo.images.length) return;
    const selected = e.currentTarget.dataset.index === undefined ? this.data.imageIndexes[todo.id] || 0 : Number(e.currentTarget.dataset.index);
    const current = Number.isInteger(selected) && selected >= 0 && selected < todo.images.length ? selected : 0;
    const sameAlbum = this.data.galleryMounted && this.data.galleryId === todo.id && todo.images.length === this.data.galleryImages.length && todo.images.every((source, index) => source === this.data.galleryImages[index]);
    const states = sameAlbum ? this.data.galleryStates.slice() : todo.images.map(() => 'loading');
    clearTimeout(this._galleryOpenTimer); clearTimeout(this._galleryCloseTimer);
    this.setData({galleryMounted: true, galleryOpen: false, galleryImages: todo.images.slice(), galleryStates: states, galleryCurrent: current, galleryId: todo.id, galleryTitle: todo.title, galleryScrollTarget: ''}, () => {
      this._galleryOpenTimer = setTimeout(() => this.setData({galleryOpen: true, galleryScrollTarget: 'gallery-photo-' + current}), 32);
    });
  },
  closeGallery() {
    if (this.data.zoomMounted) { this.closeImageZoom(); return; }
    clearTimeout(this._galleryOpenTimer); clearTimeout(this._galleryCloseTimer);
    this.setData({galleryOpen: false});
    this._galleryCloseTimer = setTimeout(() => this.setData({galleryMounted: false, galleryImages: [], galleryStates: []}), 300);
  },
  resetGallery() {
    this.resetImageZoom();
    clearTimeout(this._galleryOpenTimer); clearTimeout(this._galleryCloseTimer);
    this.setData({galleryOpen: false, galleryMounted: false, galleryImages: [], galleryStates: []});
  },
  onHide() {
    clearInterval(this._reminderInterval); this._reminderInterval = null;
    this._reminderStateToken = (this._reminderStateToken || 0) + 1;
    clearTimeout(this._galleryOpenTimer); clearTimeout(this._galleryCloseTimer);
    // Native image preview temporarily hides this page. Keep the open list mounted
    // so dismissing the preview restores its images, loading state and scroll position.
    if (!this.data.galleryMounted || !this.data.galleryOpen) this.resetGallery();
  },
  onUnload() { clearInterval(this._reminderInterval); this._reminderInterval = null; this._reminderStateToken = (this._reminderStateToken || 0) + 1; this.resetGallery(); },
  onGalleryChange(e) {
    const current = Number(e.detail.current);
    if (!Number.isInteger(current) || current < 0 || current >= this.data.galleryImages.length) return;
    this.setData({galleryCurrent: current, imageIndexes: Object.assign({}, this.data.imageIndexes, {[this.data.galleryId]: current})});
  },
  onGalleryImageLoad(e) {
    const index = Number(e.currentTarget.dataset.index), info = e.detail || {};
    this.setGalleryImageState(index, 'loaded');
    if (info.width > 0 && info.height > 0 && this.data.galleryImages[index]) {
      this._gallerySizes = this._gallerySizes || {};
      this._gallerySizes[this.data.galleryImages[index]] = {width: info.width, height: info.height};
    }
  },
  onGalleryImageError(e) { this.setGalleryImageState(Number(e.currentTarget.dataset.index), 'error'); },
  setGalleryImageState(index, state) {
    if (!this.data.galleryMounted || !Number.isInteger(index) || index < 0 || index >= this.data.galleryImages.length) return;
    const states = this.data.galleryStates.slice(); states[index] = state; this.setData({galleryStates: states});
  },
  retryGalleryImage(e) {
    const selected = e && e.currentTarget ? Number(e.currentTarget.dataset.index) : this.data.galleryCurrent;
    const index = Number.isInteger(selected) ? selected : this.data.galleryCurrent, images = this.data.galleryImages.slice(), source = images[index];
    if (!source) return;
    images[index] = ''; this.setGalleryImageState(index, 'loading');
    this.setData({galleryImages: images}, () => {
      if (!this.data.galleryMounted) return;
      images[index] = source; this.setData({galleryImages: images});
    });
  },
  viewGalleryPhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.galleryImages[index]) return;
    this.onGalleryChange({detail: {current: index}});
    this.viewGalleryOriginal();
  },
  viewGalleryOriginal() {
    const index = this.data.galleryCurrent, source = this.data.galleryImages[index];
    if (!source || this.data.zoomMounted) return;
    const token = (this._zoomToken || 0) + 1; this._zoomToken = token;
    const open = rect => {
      if (token !== this._zoomToken || !this.data.galleryMounted || !this.data.galleryOpen) return;
      const viewport = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {windowWidth: 375, windowHeight: 667};
      const width = viewport.windowWidth, height = viewport.windowHeight;
      const size = this._gallerySizes && this._gallerySizes[source] || (rect && rect.width > 0 && rect.height > 0 ? rect : {width, height: Math.max(80, height - 128)});
      const ratio = size.width / Math.max(1, size.height), availableWidth = width - 24, availableHeight = Math.max(80, height - 128);
      const targetWidth = Math.min(availableWidth, availableHeight * ratio), targetHeight = targetWidth / ratio;
      const left = (width - targetWidth) / 2, top = (height - targetHeight) / 2;
      const origin = rect && rect.width > 0 && rect.height > 0 ? rect : {left, top, width: targetWidth, height: targetHeight};
      this._zoomOriginTransform = 'translate3d(' + (origin.left - left) + 'px,' + (origin.top - top) + 'px,0) scale(' + origin.width / targetWidth + ',' + origin.height / targetHeight + ')';
      clearTimeout(this._zoomOpenTimer); clearTimeout(this._zoomCloseTimer);
      this.setData({zoomMounted: true, zoomOpen: false, zoomSource: source, zoomError: false, zoomImageStyle: 'left:' + left + 'px;top:' + top + 'px;width:' + targetWidth + 'px;height:' + targetHeight + 'px;', zoomTransform: this._zoomOriginTransform}, () => {
        this._zoomOpenTimer = setTimeout(() => {
          if (token === this._zoomToken && this.data.zoomMounted) this.setData({zoomOpen: true, zoomTransform: 'translate3d(0,0,0) scale(1,1)'});
        }, 32);
      });
    };
    if (typeof wx.createSelectorQuery === 'function') wx.createSelectorQuery().select('#gallery-photo-' + index + ' .todo-gallery-image').boundingClientRect(open).exec();
    else open(null);
  },
  closeImageZoom() {
    this._zoomToken = (this._zoomToken || 0) + 1;
    clearTimeout(this._zoomOpenTimer); clearTimeout(this._zoomCloseTimer);
    this.setData({zoomOpen: false, zoomTransform: this._zoomOriginTransform || 'translate3d(0,0,0) scale(1,1)'});
    this._zoomCloseTimer = setTimeout(() => this.setData({zoomMounted: false, zoomSource: ''}), 300);
  },
  resetImageZoom() {
    this._zoomToken = (this._zoomToken || 0) + 1;
    clearTimeout(this._zoomOpenTimer); clearTimeout(this._zoomCloseTimer);
    this.setData({zoomMounted: false, zoomOpen: false, zoomSource: ''});
  },
  onZoomImageError() { this.setData({zoomError: true}); },
  onGalleryDragStart(e) { if (e.touches && e.touches[0]) this._galleryDrag = e.touches[0]; },
  onGalleryDragEnd(e) {
    const end = e.changedTouches && e.changedTouches[0], start = this._galleryDrag; this._galleryDrag = null;
    if (start && end && end.clientX - start.clientX < -60 && Math.abs(end.clientY - start.clientY) < 60) this.closeGallery();
  },
  async save() {
    if (this.data.saving || this.data.choosing) return;
    this.setData({ saving: true, formError: '' });
    try {
      const startAt = rangeTime(this.data.startDate, this.data.startTime);
      const dueAt = rangeTime(this.data.date, this.data.time);
      if (dueAt < startAt) throw Error('截止时间不能早于起始时间');
      await store.saveTodoWithImages({ id: this.data.editingId, title: this.data.title, startAt, dueAt, images: this.data.images.slice() });
      this.setData({ formVisible: false, images: [] });
      this.refresh();
        await this.refreshReminderStates();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) { this.setData({ formError: error.message || '保存未完成，请重试' }); }
    finally { this.setData({ saving: false }); }
  },
  async toggle(e) {
    if (this.data.togglingId) return;
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find(item => item.id === id);
    if (!todo) return;
    const desiredDone = !todo.done;
    this._optimisticTodo = { id, done: desiredDone, doneAt: desiredDone ? Date.now() : undefined };
    this.setData({ togglingId: id });
    await this.refresh();
          await this.refreshReminderStates();
    return attempt(async () => {
      try { await store.toggleTodo(id, desiredDone); }
      finally {
        this._optimisticTodo = null;
        this.setData({ togglingId: '' });
        await this.refresh();
      }
    });
  },
  async remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除待办', content: '删除后无法撤销。是否继续？', confirmColor: '#aa5849',
      success: async result => { if (result.confirm) attempt(async () => { await store.removeTodo(id); this.refresh(); }); }
    });
  }
});
