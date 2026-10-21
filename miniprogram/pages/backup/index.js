const store = require('../../utils/storage');
const appearance = require('../../utils/appearance');
const migration=require('../../utils/migration');
require('../../utils/page-sync').definePage({
  data: { restoreVisible: false, text: '', busy: false, preview: null, backupPath: '', backupName: '', fileLabel: '' },
  stopTouch() {},
  openRestore() { if (!this.data.busy) this.setData({ restoreVisible: true }); },
  closeRestore() { if (!this.data.busy) this.setData({ restoreVisible: false }); },
  onShow() { appearance.apply(this); },
  error(e) { wx.showModal({ title: '操作未完成', content: e.message || '请重试', showCancel: false }); },
  async exportFull() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const file = await store.exportBackupFile();
      this.setData({ backupPath: file.path, backupName: file.name });
      wx.showToast({ title: '备份文件已生成', icon: 'success' });
    } catch (e) { this.error(e); } finally { this.setData({ busy: false }); }
  },
  saveFile() {
    if (!this.data.backupPath) return;
    const filePath = this.data.backupPath;
    if (typeof wx.saveFileToDisk === 'function') {
      wx.saveFileToDisk({ filePath, fail: e => { if (!/cancel/i.test(e.errMsg || '')) this.shareFile(); } });
    } else this.shareFile();
  },
  shareFile() {
    if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({ filePath: this.data.backupPath, fileName: this.data.backupName,
      fail: e => { if (!/cancel/i.test(e.errMsg || '')) this.error(new Error('当前客户端无法导出文件，请升级微信或在电脑端保存')); } });
    else this.error(new Error('当前环境不支持文件导出，请在手机微信或电脑微信中使用'));
  },
  onText(e) {
    if (this.data.busy) return;
    this._source = e.detail.value; this.setData({ text: e.detail.value, fileLabel: '', preview: null });
  },
  chooseFile() {
    if (this.data.busy) return;
    this.setData({ busy: true, restoreVisible: true });
    try {
      wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) { this.setData({ busy: false }); return; }
        if (file.size > 40 * 1024 * 1024) { this.setData({ busy: false }); this.error(new Error('备份最多40MB')); return; }
        try {
          wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: r => {
            try { this._source = r.data; this.setData({ text: '', fileLabel: file.name || '已选择JSON文件', preview: null }); this.parse(); }
            finally { this.setData({ busy: false }); }
          }, fail: () => { this.setData({ busy: false }); this.error(new Error('无法读取文件，请确认文件已下载到本机')); } });
        } catch (e) { this.setData({ busy: false }); this.error(e); }
      }, fail: e => { this.setData({ busy: false }); if (!/cancel/i.test(e.errMsg || '')) this.error(new Error('无法选择文件，请在微信中选择已下载的备份')); } });
    } catch (e) { this.setData({ busy: false }); this.error(e); }
  },
  parse() {
    try {
      const result = store.previewBackup(this._source || this.data.text);
      const names = { todos: '待办', expenses: '账目', notes: '随记', courses: '课程', exams: '考试', life: '生活记录', budgets: '月预算', sessions: '计时记录', loans:'借还',recipes:'菜谱',meals:'饮食安排' };
      this._mergePreview=migration.prepare(this._source||this.data.text);
      this.setData({restoreVisible:true,conflicts:this._mergePreview.conflicts.map(c=>({key:c.key,name:(names[c.kind]||c.kind)+' / '+c.id})), preview: Object.assign({}, result, { rows: Object.keys(names).map(key => ({ name: names[key], count: result.counts[key] })) }) });
    } catch (e) { this.setData({ preview: null }); this.error(e); }
  },
  previewLegacy(){if(this.data.busy)return;try{const text=migration.inspectLegacy();if(!text)throw Error('当前设备没有旧版数据，请从旧项目导出完整备份后选择文件');this._source=text;this.setData({text:'',fileLabel:'当前设备旧记录'});this.parse();}catch(e){this.error(e);}},
  chooseMerge(e){if(this.data.busy||!this._mergePreview)return;const ds=e.currentTarget.dataset;migration.choose(this._mergePreview,ds.key||'*',ds.choice);this.setData({conflicts:this._mergePreview.conflicts.map(c=>({key:c.key,name:c.kind+' / '+c.id}))});},
  mergeData(){
    if(this.data.busy||!this._mergePreview)return;if(this._mergePreview.conflicts.length)return this.error(Error('请先选择冲突处理方式'));
    const preview=this._mergePreview;wx.showModal({title:'合并到云端？',content:'将合并导入记录，影响同一账号的手机与PC。'+(preview.missing?'有'+preview.missing+'张旧照片不可访问，确认后只合并可恢复的内容。':'已有云端独立记录会保留。'),confirmText:'确认合并',success:async r=>{
      if(!r.confirm||this.data.busy)return;this.setData({busy:true});try{await migration.apply(preview);this._source='';this._mergePreview=null;this.setData({restoreVisible:false,text:'',preview:null,conflicts:[],fileLabel:''});wx.showToast({title:'云端合并完成',icon:'success'});}catch(e){this.error(e);}finally{this.setData({busy:false});}}
    });
  },
  async restore() {
    if (this.data.busy || !this.data.preview) return;
    const source = this._source || this.data.text, missing = this.data.preview.missing;
    wx.showModal({ title: '恢复将覆盖全部云端数据', content: '会同步影响手机与PC，请先导出完整备份。' + (missing ? '此备份有' + missing + '张照片缺失，将只恢复对应文字。' : '备份中的照片将上传云存储。'), confirmText: '继续恢复',
      success: async first => {
        if (!first.confirm || this.data.busy) return;
        wx.showModal({ title: '确认覆盖？', content: '当前记录会被备份内容替换，进行中的计时会重置。此操作无法撤销。', confirmText: '确认恢复', confirmColor: '#aa5849', success: async second => {
          if (!second.confirm || this.data.busy) return;
          this.setData({ busy: true });
          try {
            await store.restoreBackup(source); this._source = ''; this._mergePreview = null; this.setData({ restoreVisible: false, text: '', preview: null, conflicts: [], fileLabel: '' });
            wx.showToast({ title: '恢复完成', icon: 'success' });
          } catch (e) { this.error(e); } finally { this.setData({ busy: false }); }
        } });
      } });
  }
});
