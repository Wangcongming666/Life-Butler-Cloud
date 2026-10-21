const store = require('../../utils/storage');
const { attempt } = require('../../utils/ui');
const { syncTab } = require('../../utils/navigation');

require('../../utils/page-sync').definePage({
  data: {
    stats: { totalTodos: 0, completedTodos: 0, pendingTodos: 0, expenseCount: 0, noteCount: 0,
      monthCount: 0, monthTotal: '0.00', totalExpense: '0.00' },
    completion: 0, exportVisible: false, jsonText: '', dataError: false
  },
  stopTouch() {},
  onShow() { syncTab(this, 3); this.refresh(); },
  openNotes() { wx.navigateTo({ url: '/pages/notes/index' }); },
  openBackup() { wx.navigateTo({ url: '/pages/backup/index' }); },
  openSearch() { wx.navigateTo({ url: '/pages/search/index' }); },
  openPersonal(e) { const page=e.currentTarget.dataset.page;if(['loans','food','review','timeline','settings'].includes(page))wx.navigateTo({url:'/pages/'+page+'/index'}); },
  refresh() {
    // 损坏数据不覆盖原文，仍保留导出、清空入口。
    try {
      const stats = store.stats(store.read());
      this.setData({ stats, dataError: false,
        completion: stats.totalTodos ? Math.round(stats.completedTodos / stats.totalTodos * 100) : 0 });
    } catch (error) {
      this.setData({ dataError: true });
      wx.showModal({ title: '本地数据读取失败', content: '可先导出原始 JSON 备份，再决定是否清空。' + (error.message || ''), showCancel: false });
    }
  },
  exportData() {
    return attempt(async () => { this.setData({ jsonText: store.exportJSON(), exportVisible: true }); });
  },
  copyExport() {
    // 剪贴板仅用于用户主动导出文本，不发生网络传输。
    wx.setClipboardData({ data: this.data.jsonText,
      success: async () => wx.showToast({ title: 'JSON 已复制', icon: 'success' }),
      fail: () => wx.showModal({ title: '复制未完成', content: '请重试，或在下方文本中长按选择并复制。', showCancel: false })
    });
  },
  closeExport() { this.setData({ exportVisible: false, jsonText: '' }); },
  async clearData() {
    wx.showModal({ title: '清空全部数据？',
      content: '将清空全部云端业务记录与照片引用并重置设置，同一账号的手机与PC都会受影响。建议先导出完整备份。',
      confirmText: '继续清空', confirmColor: '#aa5849',
      success: async first => {
        if (!first.confirm) return;
        wx.showModal({ title: '最后确认', content: '确定清空「生活管家」全部云端记录？此操作会同步到所有设备。',
          confirmText: '确认清空', confirmColor: '#aa5849',
          success: async second => {
            if (second.confirm) attempt(async () => {
              await store.clear();
              this.setData({ exportVisible: false, jsonText: '' });
              this.refresh();
              wx.showToast({ title: '已清空', icon: 'success' });
            });
          }
        });
      }
    });
  }
});
