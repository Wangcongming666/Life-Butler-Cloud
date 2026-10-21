const media = require('../../utils/media');
Component({
  properties: { images: { type: Array, value: [] }, disabled: { type: Boolean, value: false } },
  data: { choosing: false },
  methods: {
    async choose(e) {
      if (this.properties.disabled || this.data.choosing || this.properties.images.length >= 6) return;
      this.setData({ choosing: true }); this.triggerEvent('busy', { value: true });
      try { const source=e.currentTarget.dataset.source, paths=await media.choose(source==='camera'?1:6-this.properties.images.length,source); this.triggerEvent('change',{images:this.properties.images.concat(paths)}); }
      catch(error){wx.showModal({title:'选图未完成',content:error.message,showCancel:false});}
      finally{this.setData({choosing:false});this.triggerEvent('busy',{value:false});}
    },
    remove(e){if(!this.properties.disabled && !this.data.choosing)this.triggerEvent('change',{images:this.properties.images.filter((p,i)=>i!==Number(e.currentTarget.dataset.index))});},
    preview(e){media.preview({urls:this.properties.images,current:this.properties.images[Number(e.currentTarget.dataset.index)]});}
  }
});
