const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../miniprogram/utils/data-schema');
const model = require('../miniprogram/utils/record-model');
test('empty snapshot and all categories round trip', () => {
  const data = schema.emptyData();
  data.todos.push({id:'t1',title:'手机创建',done:false,dueAt:1,createdAt:1,images:[]});
  assert.deepEqual(model.hydrate(model.flatten(data)), data);
  assert.deepEqual(model.diff(model.flatten(data), model.flatten(data), {}), []);
});
test('diff sends only changed records with expected versions and deletion', () => {
  const a = schema.emptyData(); a.todos.push({id:'t',title:'旧',done:false,dueAt:0,createdAt:0});
  const b = structuredClone(a); b.todos=[];
  assert.deepEqual(model.diff(model.flatten(a),model.flatten(b),{'todos:t':3}),[{kind:'todos',id:'t',expectedVersion:3,value:null}]);
});
test('invalid money and foreign image paths fail validation', () => {
  const data=schema.emptyData(); data.expenses=[{id:'e',amountCents:0,category:'餐饮',note:'',createdAt:0}];
  assert.throws(()=>schema.validate(data));
  data.expenses=[]; data.todos=[{id:'t',title:'图片',done:false,dueAt:0,createdAt:0,images:['/other-device/image.jpg']}];
  assert.throws(()=>schema.validate(data, p=>p.startsWith('cloud://')));
});
