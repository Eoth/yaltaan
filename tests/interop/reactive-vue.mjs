// The Vue recipe of the reactive guide, `nodeRef`, on Vue: a ref that follows a node inside an effect scope, through a
// batch and a computed, writes through to a source, throws what the node throws, and stops following when its scope
// stops. Run by tests/interop/run.sh, which writes recipe-vue.ts from the guide.
import assert from 'node:assert/strict';

import { createGraph } from '@yaltaan/core/reactive';
import { computed, effectScope, watchEffect } from 'vue';

import { nodeRef } from './recipe-vue.ts';

const graph = createGraph();
const price = graph.source(10);
const failure = new Error('negative');
const total = graph.derived([price], (value) => {
  if (value < 0) {
    throw failure;
  }
  return value * 2;
});
let computes = 0;
const counted = graph.derived([price], (value) => {
  computes += 1;
  return value;
});

const seen = [];
const scope = effectScope();
const refs = scope.run(() => {
  const totalRef = nodeRef(total);
  const priceRef = nodeRef(price);
  const countedRef = nodeRef(counted);
  const quadrupled = computed(() => totalRef.value * 2);
  watchEffect(() => seen.push(totalRef.value), { flush: 'sync' });
  return { priceRef, countedRef, quadrupled };
});
assert.deepEqual(seen, [20]);
price.set(15);
assert.deepEqual(seen, [20, 30]);
assert.equal(refs.quadrupled.value, 60);
refs.priceRef.value = 20;
assert.equal(price.get(), 20);
assert.deepEqual(seen, [20, 30, 40]);
graph.batch(() => {
  price.set(1);
  price.set(2);
});
assert.deepEqual(seen, [20, 30, 40, 4]);
assert.equal(refs.countedRef.value, 2);

scope.stop();
const before = computes;
price.set(5);
assert.deepEqual(seen, [20, 30, 40, 4], 'no longer followed once the scope stops');
assert.equal(computes, before, 'a node no longer followed computes nothing on a write');

const failing = effectScope();
const totalRef = failing.run(() => nodeRef(total));
price.set(-1);
assert.throws(
  () => totalRef.value,
  (error) => error === failure,
);
failing.stop();
console.log('reactive-vue: nodeRef follows a node, writes through to a source, and lets it go with its scope');
