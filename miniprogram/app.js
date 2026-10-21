const cloud = require('./utils/cloud'), sync = require('./utils/sync');
App({
  globalData: {env: cloud.ENV},
  onLaunch() { try { cloud.init(); } catch (error) { console.error(error); } },
  onShow(options) {
    const todoId = options && options.path === 'pages/todo/index' && options.query && options.query.todoId;
    if (typeof todoId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(todoId)) this.pendingSearch = {kind: '待办', id: todoId};
    this._foreground = true;
    const service = sync.getDefault();
    if (this._checkinOff) this._checkinOff();
    // A successful retry or background pull should also recover today's sign-in.
    this._checkinOff = service.subscribe(state => {
      if (this._foreground && state.ready && state.status === 'synced') {
        require('./utils/login-checkin').run().catch(error => console.error('每日签到', error.message));
      }
    });
    service.start().catch(error => console.error('云同步', error.message));
    if (this._syncInterval) clearInterval(this._syncInterval);
    this._syncInterval = setInterval(() => service.pull().catch(error => console.error('云同步', error.message)), 30000);
  },
  onHide() {
    this._foreground = false;
    require('./utils/login-checkin').dismiss();
    if (this._syncInterval) clearInterval(this._syncInterval);
    this._syncInterval = null;
    if (this._checkinOff) this._checkinOff();
    this._checkinOff = null;
  }
});
