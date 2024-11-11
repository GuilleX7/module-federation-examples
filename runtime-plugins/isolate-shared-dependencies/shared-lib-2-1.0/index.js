function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

export const instanceId = getRandomInt(100000);

const data = require('./lib.js');

console.log(data);

export function getLib2InstanceId() {
  return instanceId;
}

export function getLazyData() {
  return import('./lazyDataOld.json');
}
