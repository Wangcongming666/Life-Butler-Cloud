/** 每个 Tab 页显示时同步自定义导航，兼容组件尚未挂载的时机。 */
const appearance = require('./appearance');
function syncTab(page, index) {
  const bar = typeof page.getTabBar === 'function' ? page.getTabBar() : null;
  if (bar && typeof bar.select === 'function') bar.select(index);
  appearance.apply(page);
  const appearanceClass = page.data && page.data.appearanceClass || '';
  if (bar && typeof bar.setData === 'function' && (!bar.data || bar.data.appearanceClass !== appearanceClass)) {
    bar.setData({ appearanceClass });
  }
}
function takeSearch(kind) {
  if (typeof getApp !== 'function') return null;
  const app = getApp(), pending = app.pendingSearch;
  if (!pending || pending.kind !== kind) return null;
  app.pendingSearch = null; return pending;
}
module.exports = { syncTab, takeSearch };
