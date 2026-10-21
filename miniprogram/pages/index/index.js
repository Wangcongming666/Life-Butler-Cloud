// 兼容曾经生成的体验码和分享链接，统一进入真正的 Tab 首页。
require('../../utils/page-sync').definePage({
  data: { failed: false },
  onLoad() { this.goHome(); },
  goHome() {
    this.setData({ failed: false });
    wx.switchTab({ url: '/pages/todo/index', fail: () => this.setData({ failed: true }) });
  }
});
