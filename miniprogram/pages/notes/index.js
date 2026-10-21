const cloudMedia=require('../../utils/media');
const store = require('../../utils/storage');
const media = require('../../utils/media');
const appearance = require('../../utils/appearance');

function blank() { return { editId: '', titleInput: '', commentInput: '', priceInput: '', images: [] }; }
function dataset(e) { return e.currentTarget.dataset; }

require('../../utils/page-sync').definePage({
  data: Object.assign({ notes: [], total: 0, query: '', formVisible: false, detailNote: null, formError: '', busy: false, dataError: false, scrollTarget: '' }, blank()),
  onLoad(options) { this._openId = options && options.id || ''; },
  onShow() {
    appearance.apply(this);
    this.refresh();
    if (this._openId) { const id = this._openId; this._openId = ''; this.openEdit({ currentTarget: { dataset: { id } } }); }
  },
  async toShopping(e) {
    if (this.data.busy) return;
    try {
      const id = await store.noteToShopping(dataset(e).id);
      wx.navigateTo({ url: '/pages/life/index?type=shopping&id=' + encodeURIComponent(id) });
    } catch (error) { this.showError(error); }
  },
  // 从相机或原生编辑器返回时只刷新列表，不重置未保存的草稿。
  refresh() {
    try {
      const all = store.read().notes;
      const query = this.data.query.trim().toLowerCase();
      this.setData({ total: all.length, dataError: false, notes: all.filter(note =>
        !query || (note.title + ' ' + note.comment).toLowerCase().includes(query)
      ).sort((a, b) => b.updatedAt - a.updatedAt).map(note => Object.assign({}, note, {
        currentImage: Math.min((this._galleryPositions || {})[note.id] || 0, Math.max(0, note.images.length - 1)),
        priceText: note.priceCents === null ? '' : store.money(note.priceCents),
        createdText: store.dateText(note.createdAt) + ' ' + store.timeText(note.createdAt),
        updatedText: store.dateText(note.updatedAt) + ' ' + store.timeText(note.updatedAt)
      })) });
      if (this.data.detailNote) this.setData({ detailNote: this.data.notes.find(note => note.id === this.data.detailNote.id) || null });
    } catch (error) { this.setData({ dataError: true }); this.showError(error); }
  },
  noop() {},
  openDetail(e) {
    if (this.data.busy || this.data.formVisible) return;
    const note = this.data.notes.find(item => item.id === dataset(e).id);
    if (note) this.setData({ detailNote: Object.assign({}, note, { images: note.images.slice() }) });
  },
  closeDetail() { if (!this.data.busy) this.setData({ detailNote: null }); },
  previewDetail(e) { if (this.data.detailNote) this.preview(this.data.detailNote.images, Number(dataset(e).index)); },
  showError(error) { if (this.data.formVisible) { this.setData({ formError: error.message || '请稍后重试' }); return; } wx.showModal({ title: '操作未完成', content: error.message || '请稍后重试', showCancel: false }); },
  onSearch(e) { this.setData({ query: e.detail.value }); this.refresh(); },
  onField(e) {
    if (this.data.busy) return;
    const key = dataset(e).key;
    if (['titleInput', 'commentInput', 'priceInput'].includes(key)) this.setData({ [key]: e.detail.value });
  },
  openNew() {
    if (this.data.busy) return;
    this.setData(Object.assign(blank(), { formVisible: true, detailNote: null, formError: '', scrollTarget: '' }));
  },
  async quickCapture() { this.openNew(); if (!this.data.busy) await this.selectImages('camera'); },
  closeForm() {
    if (this.data.busy) return;
    if (this.data.titleInput || this.data.commentInput || this.data.priceInput || this.data.images.length) {
      wx.showModal({ title: '放弃本次编辑？', content: '尚未保存的修改将丢失，原有随记会保留。', confirmText: '放弃编辑',
        success: async result => { if (result.confirm && !this.data.busy) this.resetForm(); } });
    } else this.resetForm();
  },
  resetForm() { this.setData(Object.assign(blank(), { formVisible: false, formError: '', scrollTarget: '' })); },
  openEdit(e) {
    if (this.data.busy) return;
    const note = this.data.notes.find(item => item.id === dataset(e).id);
    if (!note) return;
    this.setData({ editId: note.id, titleInput: note.title, commentInput: note.comment,
      priceInput: note.priceText, images: note.images.slice(), formVisible: true, detailNote: null, formError: '', scrollTarget: '' });
  },
  takePhoto() { return this.selectImages('camera'); },
  chooseAlbum() { return this.selectImages('album'); },
  async selectImages(source) {
    if (this.data.busy) return;
    const remaining = media.MAX_IMAGES - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '最多添加 6 张图片', icon: 'none' });
    this.setData({ busy: true, formError: '' });
    try {
      const paths = await media.choose(source === 'camera' ? 1 : remaining, source);
      this.setData({ images: this.data.images.concat(paths) });
    } catch (error) { this.showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async editImage(e) {
    if (this.data.busy) return;
    const index = Number(dataset(e).index), source = this.data.images[index];
    if (!source) return;
    this.setData({ busy: true, formError: '' });
    try {
      const result = await media.edit(source), images = this.data.images.slice();
      images[index] = result;
      this.setData({ images });
    } catch (error) { this.showError(error); }
    finally { this.setData({ busy: false }); }
  },
  removeImage(e) {
    if (this.data.busy) return;
    this.setData({ images: this.data.images.filter((path, index) => index !== Number(dataset(e).index)) });
  },
  clearImages() {
    if (this.data.busy || !this.data.images.length) return;
    wx.showModal({ title: '清空全部照片？', content: '仅清空这条随记的照片，文字会保留。保存随记后生效。', confirmText: '清空照片', confirmColor: '#aa5849',
      success: async result => {
        if (result.confirm && !this.data.busy) this.setData({ images: [] });
      } });
  },
  previewDraft(e) { this.preview(this.data.images, Number(dataset(e).index)); },
  // 轮播位置只留在页面内存，不写进随记数据；各条随记独立切换。
  onGalleryChange(e) { this.setGalleryPosition(dataset(e).id, Number(e.detail.current)); },
  switchPhoto(e) {
    const note = this.data.notes.find(item => item.id === dataset(e).id);
    if (note) this.setGalleryPosition(note.id, note.currentImage + Number(dataset(e).step));
  },
  setGalleryPosition(id, index) {
    const note = this.data.notes.find(item => item.id === id);
    if (!note || !note.images.length || !Number.isInteger(index)) return;
    const currentImage = Math.max(0, Math.min(index, note.images.length - 1));
    this._galleryPositions = Object.assign({}, this._galleryPositions, { [id]: currentImage });
    this.setData({ notes: this.data.notes.map(item => item.id === id ? Object.assign({}, item, { currentImage }) : item) });
  },
  previewNote(e) {
    const note = this.data.notes.find(item => item.id === dataset(e).id);
    if (note) this.preview(note.images, note.currentImage);
  },
  preview(images, index) {
    if (!images.length) return;
    cloudMedia.preview({ urls: images, current: images[index] || images[0],
      fail: () => this.showError(new Error('图片可能已被清理，请编辑随记重新添加')) });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, formError: '' });
    try {
      await store.saveNoteWithImages({ id: this.data.editId, title: this.data.titleInput,
        comment: this.data.commentInput, price: this.data.priceInput, images: this.data.images });
      this.resetForm(); this.refresh();
      wx.showToast({ title: '随记已保存', icon: 'success' });
    } catch (error) { this.showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async remove(e) {
    if (this.data.busy) return;
    const id = dataset(e).id;
    wx.showModal({ title: '删除这条随记？', content: '随记及附带图片将一并删除，无法撤销。', confirmText: '删除', confirmColor: '#aa5849',
      success: async result => {
        if (!result.confirm || this.data.busy) return;
        this.setData({ busy: true });
        try {
          await store.removeNote(id);
          if (this.data.editId === id) this.resetForm();
          this.refresh();
        } catch (error) { this.showError(error); }
        finally { this.setData({ busy: false }); }
      } });
  }
});
