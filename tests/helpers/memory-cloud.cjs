const clone=v=>structuredClone(v);
class MemoryRepository{
 constructor(){this.users=new Map();this.ops=new Map();this.imports=new Map();this.queue=Promise.resolve();}
 async load(owner){return clone(this.users.get(owner)||{meta:{generation:'g0',revision:0},records:[]});}
 async operation(owner,id){return clone(this.ops.get(owner+':'+id)||null);}
 async apply(owner,revision,update){
  const task=this.queue.then(async()=>{
   const current=await this.load(owner);if(current.meta.revision!==revision)throw Object.assign(Error('写冲突'),{code:'CONFLICT'});
   this.users.set(owner,{meta:clone(update.meta),records:clone(update.records)});
   if(update.operation)this.ops.set(owner+':'+update.operation.id,clone(update.operation));return clone(update.meta);
  });this.queue=task.catch(()=>{});return task;
 }
 async saveImport(owner,id,value){this.imports.set(owner+':'+id,clone(value));}
 async getImport(owner,id){return clone(this.imports.get(owner+':'+id)||null);}
}
module.exports={MemoryRepository};
