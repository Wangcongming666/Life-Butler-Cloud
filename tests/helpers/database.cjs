class Database{
 constructor(){this.data=new Map();this.command={gt:value=>({gt:value}),lte:value=>({lte:value})};this.queue=Promise.resolve();this.failNext=false;}
 collection(name){return this.collectionFor(this.data,name);}
 collectionFor(data,name){
   const api={doc:id=>({get:async()=>({data:structuredClone(data.get(name+':'+id)||null)}),set:async({data:row})=>{if(Object.prototype.hasOwnProperty.call(row,'_id'))throw Error('document.set:fail _id is a read-only field');data.set(name+':'+id,{...structuredClone(row),_id:id});return {};},update:async({data:patch})=>{if(Object.prototype.hasOwnProperty.call(patch,'_id'))throw Error('document.update:fail _id is a read-only field');const key=name+':'+id;if(!data.has(key))throw Error('missing document');data.set(key,{...data.get(key),...structuredClone(patch)});return {};}}),where:condition=>{
   let limit=100,order='_id';return {orderBy(field){order=field;return this;},limit(n){limit=n;return this;},async get(){return {data:[...data.entries()].filter(([k,r])=>k.startsWith(name+':')&&Object.keys(condition).every(f=>condition[f]&&condition[f].gt!==undefined?r[f]>condition[f].gt:condition[f]&&condition[f].lte!==undefined?r[f]<=condition[f].lte:r[f]===condition[f])).map(([,r])=>structuredClone(r)).sort((a,b)=>typeof a[order]==='number'&&typeof b[order]==='number'?a[order]-b[order]:String(a[order]).localeCompare(String(b[order]))).slice(0,limit)};}};
  }};return api;
 }
 async runTransaction(fn){const work=this.queue.then(async()=>{const draft=structuredClone(this.data);const result=await fn({collection:n=>this.collectionFor(draft,n)});if(this.failNext){this.failNext=false;throw Error('事务中断');}this.data=draft;return result;});this.queue=work.catch(()=>{});return work;}
}
module.exports={Database};
