const schema=require('./data-schema');
const paths={signins:['signins'],todos:['todos'],expenses:['expenses'],notes:['notes'],courses:['schedule','courses'],exams:['schedule','exams'],lifeRecords:['life','records'],budgets:['life','budgets'],sessions:['life','sessions'],loans:['library','loans'],recipes:['library','recipes'],meals:['library','meals']};
const clone=v=>JSON.parse(JSON.stringify(v));
function at(obj,path){return path.reduce((value,key)=>value[key],obj);}
function key(kind,id){return kind+':'+id;}
function flatten(data){
  const out={};
  Object.keys(paths).forEach(kind=>(at(data,paths[kind]) || []).forEach(value=>{const id=kind==='budgets'?value.month:value.id;out[key(kind,id)]={kind,id,value:clone(value)};}));
  const term=clone(data.schedule);delete term.courses;delete term.exams;
  for(const [kind,value] of [['preferences',data.preferences],['term',term],['timer',{timer:data.life.timer}]])out[key(kind,'singleton')]={kind,id:'singleton',value:clone(value)};
  return out;
}
function hydrate(input){
  const data=schema.emptyData(),records=Array.isArray(input)?input:Object.values(input);
  records.forEach(r=>{
    if(r.deleted)return;
    if(paths[r.kind])at(data,paths[r.kind]).push(clone(r.value));
    else if(r.kind==='preferences')data.preferences=clone(r.value);
    else if(r.kind==='term')Object.assign(data.schedule,clone(r.value));
    else if(r.kind==='timer')data.life.timer=clone(r.value.timer);
    else throw Error('未知记录类型');
  });return data;
}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function diff(before,after,versions){
  const out=[];new Set(Object.keys(before).concat(Object.keys(after))).forEach(k=>{
    if(before[k]&&after[k]&&equal(before[k].value,after[k].value))return;
    const r=after[k]||before[k];out.push({kind:r.kind,id:r.id,expectedVersion:versions[k]||0,value:after[k]?clone(r.value):null});
  });return out;
}
function mergeLegacy(local,remote,choices){
 const source=flatten(local),target=flatten(remote),conflicts=[];choices=choices||{};
 Object.keys(source).forEach(k=>{
  if(source[k].kind==='meals'&&!target[k]){
   const localMeal=source[k].value,otherKey=Object.keys(target).find(t=>target[t].kind==='meals'&&target[t].value.date===localMeal.date&&target[t].value.slot===localMeal.slot);
   if(otherKey){const conflictKey='meal-slot:'+localMeal.date+':'+localMeal.slot;
    if(choices[conflictKey]==='local'){delete target[otherKey];target[k]=source[k];}
    else if(choices[conflictKey]!=='remote')conflicts.push({key:conflictKey,kind:'meals',id:localMeal.date+' '+localMeal.slot,local:localMeal,remote:target[otherKey].value});
    return;
   }
  }
  if(!target[k]){target[k]=source[k];return;}if(equal(source[k].value,target[k].value))return;
  if(choices[k]==='local')target[k]=source[k];else if(choices[k]!=='remote')conflicts.push({key:k,kind:source[k].kind,id:source[k].id,local:source[k].value,remote:target[k].value});
 });return {data:hydrate(target),conflicts};
}
module.exports={paths,key,flatten,hydrate,diff,equal,clone,mergeLegacy};
