const navigation = require('../utils/tab-navigation');
/** 原生自定义 TabBar；仅负责页面切换和视觉反馈，不存储业务数据。 */
Component({
  data: {
    selected: -1, tapped: -1, pulseFlip: false, busy: false, keyboardVisible: false, navigationLoading: false, navigationLabel: '',
    tabs: [
      { path: '/pages/todo/index', text: '待办', icon: 'assets/tabbar/todo.svg', activeIcon: 'assets/tabbar/todo-active.svg' },
      { path: '/pages/account/index', text: '记账', icon: 'assets/tabbar/account.svg', activeIcon: 'assets/tabbar/account-active.svg' },
      { path: '/pages/tools/index', text: '工具', icon: 'assets/tabbar/tools.svg', activeIcon: 'assets/tabbar/tools-active.svg' },
      { path: '/pages/profile/index', text: '我的', icon: 'assets/tabbar/profile.svg', activeIcon: 'assets/tabbar/profile-active.svg' }
    ]
  },
  lifetimes: {
    attached() {
      this._navigation = navigation.getDefault();
      this.syncRoute();
      this._navigationOff = this._navigation.subscribe(state => {
        const values = { navigationLoading: state.loading, navigationLabel: state.label, busy: state.loading };
        if (state.selected >= 0) values.selected = state.selected;
        if (state.loading) values.keyboardVisible = false;
        const patch = {};
        Object.keys(values).forEach(key => { if (this.data[key] !== values[key]) patch[key] = values[key]; });
        if (Object.keys(patch).length) this.setData(patch);
      });
      // 输入时收起导航，避免挡住软键盘上方的表单。
      this._keyboardListener = event => this.setData({ keyboardVisible: event.height > 0 });
      if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this._keyboardListener);
    },
    detached() {
      if (this._navigationOff) this._navigationOff();
      clearTimeout(this._pulseTimer);
      if (wx.offKeyboardHeightChange && this._keyboardListener) wx.offKeyboardHeightChange(this._keyboardListener);
    }
  },
  pageLifetimes: {
    show() { this.syncRoute(); },
    hide() {
      clearTimeout(this._pulseTimer);
      this.setData({ tapped: -1, keyboardVisible: false });
    }
  },
  methods: {
    syncRoute() {
      const pages = getCurrentPages();
      if (!pages.length) return;
      const route = '/' + pages[pages.length - 1].route;
      const index = this.data.tabs.findIndex(tab => tab.path === route);
      if (index >= 0) this.select(index);
    },
    select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.data.tabs.length) return;
      // 页面恢复只校准选中项，点击反馈由 onTap 单独触发。
      const state = navigation.getDefault().getState();
      const selected = state.loading && state.selected >= 0 ? state.selected : index;
      if (this.data.selected !== selected) this.setData({ selected });
    },
    pulse(index) {
      clearTimeout(this._pulseTimer);
      // 交替动画名称，连续点击当前项也能重新触发特效。
      this.setData({ tapped: index, pulseFlip: !this.data.pulseFlip });
      this._pulseTimer = setTimeout(() => this.setData({ tapped: -1 }), 460);
    },
    onTap(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= this.data.tabs.length) return;
      this.pulse(index);
      navigation.getDefault().request(index);
    },
    preventScroll() {}
  }
});