const store = require('../../utils/storage');
const life = require('../../utils/life');
const { attempt } = require('../../utils/ui');
const appearance = require('../../utils/appearance');
require('../../utils/page-sync').definePage({
  data: { query: '', results: [], searched: false },
  onShow() { appearance.apply(this); if (this.data.query.trim()) this.search(); },
  onQuery(e) { this.setData({ query: e.detail.value }); this.search(); },
  search() { return attempt(async () => { this.setData({ results: life.search(store.read(), this.data.query), searched: !!this.data.query.trim() }); }); },
  open(e) {
    const result = this.data.results.find(r => r.key === e.currentTarget.dataset.key);
    if (!result) return;
    const tab = ['/pages/todo/index', '/pages/account/index'].includes(result.route);
    const app = getApp();
    // Tab 路由不能携带查询参数，交给目标页消费一次性定位指令。
    app.pendingSearch = tab ? { id: result.id, kind: result.kind, query: this.data.query } : null;
    const fail = () => { app.pendingSearch = null; wx.showToast({ title: '打开失败，请重试', icon: 'none' }); };
    if (tab) wx.switchTab({ url: result.route, fail });
    else wx.navigateTo({ url: result.route + (result.route.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(result.id), fail });
  }
});
