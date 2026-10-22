// Variants of known cost that check the timed harness and the allocation reading, not scenarios: an empty function,
// the harness's floor function, a workload and the same workload twice as long, and two allocations whose size the V8
// heap layout gives (64-bit heap without pointer compression, as Node ships it).
import type { PerfScenario } from '../scenario.ts';

/**
 * A chain of dependent multiplications `length` long: its time grows with `length`, and no step can be skipped. Every
 * step stays a 32-bit integer, so that the optimizing compiler never meets an overflow that would make it start over.
 * Each call starts from the previous call's result: independent calls would overlap in the processor's out-of-order
 * window, a short chain more than a long one, and the time would stop growing with the length.
 */
function spin(length: number): () => number {
  let state = 1;
  return () => {
    let value = state;
    for (let i = 0; i < length; i++) {
      value = Math.imul(value, 31) ^ i;
    }
    state = value;
    return value;
  };
}

const scenario: PerfScenario = {
  calls: { micro: 1, realistic: 1, pathological: 1 },
  variants: {
    'empty/micro': () => () => undefined,
    // The harness's own floor function: once the floor is subtracted it reads zero, and the floor itself without it.
    'floor/micro': () => (index?: number) => index,
    'work/micro': () => spin(256),
    'double/micro': () => spin(512),
    // A JSObject of three in-object fields: map, properties, elements, then three fields of 8 bytes, 48 bytes.
    'object/micro': () => () => ({ a: 1, b: 2, c: 3 }),
    // A JSArray (32 bytes) and its backing store of 1 000 holes (16 bytes of header and 8 per element), 8 048 bytes.
    'array/micro': () => () => new Array<unknown>(1000),
  },
};

export default scenario;
