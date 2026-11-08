// The Angular recipe of the reactive guide, `fromNode`, in Angular's test environment over jsdom: a signal that follows
// a node, through a batch, throws what the node throws, and stops following once its injector is destroyed. Run by
// tests/interop/run.sh, which writes recipe-angular.ts from the guide.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { createEnvironmentInjector, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { createGraph } from '@yaltaan/core/reactive';
import { JSDOM } from 'jsdom';

import { fromNode } from './recipe-angular.ts';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

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

const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
const [doubled, followed] = runInInjectionContext(injector, () => [fromNode(total), fromNode(counted)]);
assert.equal(doubled(), 20);
price.set(15);
assert.equal(doubled(), 30);
graph.batch(() => {
  price.set(1);
  price.set(2);
});
assert.equal(doubled(), 4);
price.set(-1);
assert.throws(
  () => doubled(),
  (error) => error === failure,
);
price.set(3);
assert.equal(doubled(), 6);
assert.equal(followed(), 3);

injector.destroy();
const before = computes;
price.set(4);
assert.equal(computes, before, 'a node no longer followed computes nothing on a write');
assert.equal(doubled(), 6, 'the signal keeps its last value');
console.log('reactive-angular: fromNode follows a node, and lets it go with its injector');
