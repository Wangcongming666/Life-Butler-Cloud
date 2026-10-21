const welcome = require('../../utils/login-checkin'), store = require('../../utils/storage');
Component({
  data: {visible: false, streak: 0, quote: {}, appearance: ''},
  lifetimes: {
    attached() {
      this._unsubscribe = welcome.subscribe(result => {
        if (!result) { this.setData({visible: false}); return; }
        const preferences = store.read().preferences;
        this.setData({visible: true, streak: result.streak, quote: result.quote, appearance: 'theme-' + preferences.theme + (preferences.dark ? ' theme-dark' : '') + (preferences.font === 'large' ? ' font-large' : '')});
      });
    },
    detached() { if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; }
  },
  methods: {
    dismiss() { welcome.dismiss(); },
    stopTap() {}
  }
});