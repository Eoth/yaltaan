// Dropping keys from an object: the platform's entries round trip against es-toolkit, the reference of the size
// harness for the same primitive, and Yaltaan's omit by a mask.
import { omit as omitByMask } from '@yaltaan/core/object';
import { omit } from 'es-toolkit';
import { seededRandom, user, word, type PerfScenario } from '../scenario.ts';

const secrets = ['password', 'token'] as const;
const secretMask = { password: true, token: true } as const;

function maskOf(keys: readonly string[]): Record<string, true> {
  return Object.fromEntries(keys.map((key) => [key, true] as const));
}

function nativeOmit(object: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

/** One wide object: 1 000 keys, of which every tenth is dropped. */
function wideObject(): { readonly object: Record<string, number>; readonly keys: readonly string[] } {
  const random = seededRandom(3);
  const object: Record<string, number> = {};
  const keys: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const key = `${word(random, 6)}${i}`;
    object[key] = i;
    if (i % 10 === 0) {
      keys.push(key);
    }
  }
  return { object, keys };
}

const scenario: PerfScenario = {
  calls: { micro: 50_000, realistic: 100, pathological: 100 },
  variants: {
    'native/micro': () => {
      const record = user(seededRandom(1), 0);
      return () => nativeOmit(record, secrets);
    },
    'es-toolkit/micro': () => {
      const record = user(seededRandom(1), 0);
      return () => omit(record, secrets);
    },
    'yaltaan/micro': () => {
      const record = user(seededRandom(1), 0);
      return () => omitByMask(record, secretMask);
    },
    'native/realistic': () => {
      const random = seededRandom(2);
      const records = Array.from({ length: 100 }, (_, i) => user(random, i));
      return () => records.map((record) => nativeOmit(record, secrets));
    },
    'es-toolkit/realistic': () => {
      const random = seededRandom(2);
      const records = Array.from({ length: 100 }, (_, i) => user(random, i));
      return () => records.map((record) => omit(record, secrets));
    },
    'yaltaan/realistic': () => {
      const random = seededRandom(2);
      const records = Array.from({ length: 100 }, (_, i) => user(random, i));
      return () => omitByMask(records, secretMask);
    },
    'native/pathological': () => {
      const { object, keys } = wideObject();
      return () => nativeOmit(object, keys);
    },
    'es-toolkit/pathological': () => {
      const { object, keys } = wideObject();
      return () => omit(object, keys);
    },
    'yaltaan/pathological': () => {
      const { object, keys } = wideObject();
      const mask = maskOf(keys);
      return () => omitByMask(object, mask);
    },
  },
};

export default scenario;
