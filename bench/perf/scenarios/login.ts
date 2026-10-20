// Validating a login form, an email and a password of at least eight characters: a predicate written with the
// platform against valibot's schema, the reference of the size harness for the same form. Both sides use valibot's
// email pattern, so they accept the same inputs.
import * as v from 'valibot';
import { seededRandom, word, type PerfScenario } from '../scenario.ts';

const LoginSchema = v.object({ email: v.pipe(v.string(), v.email()), password: v.pipe(v.string(), v.minLength(8)) });

function nativeIsLogin(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  const { email, password } = input as { email?: unknown; password?: unknown };
  return typeof email === 'string' && v.EMAIL_REGEX.test(email) && typeof password === 'string' && password.length >= 8;
}

/** `count` login inputs, about a third of them invalid in one of the ways a form receives. */
function logins(seed: number, count: number, length: number): unknown[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const email = `${word(random, length)}@${word(random, 6)}.com`;
    const password = word(random, 8 + Math.floor(random() * length));
    const fault = Math.floor(random() * 9);
    switch (fault) {
      case 0:
        return { email: email.replace('@', ''), password };
      case 1:
        return { email, password: password.slice(0, 7) };
      case 2:
        return { email };
      default:
        return { email, password };
    }
  });
}

/** Inputs no form should send: wrong types, nesting, and fields of ten thousand characters. */
function hostileLogins(): unknown[] {
  const random = seededRandom(5);
  const long = word(random, 10_000);
  const hostile: unknown[] = [
    null,
    42,
    'login',
    [],
    { email: 1, password: 2 },
    { email: { toString: () => 'a@b.cd' } },
  ];
  for (let i = 0; i < 94; i++) {
    const kind = i % 4;
    if (kind === 0) {
      hostile.push({ email: `${long}@${word(random, 6)}.com`, password: long });
    } else if (kind === 1) {
      hostile.push({ email: `${long}.${long}@x`, password: 'short' });
    } else if (kind === 2) {
      hostile.push({ email: `a@${'b-'.repeat(2_000)}.c`, password: long });
    } else {
      hostile.push(hostile[i % 6]);
    }
  }
  return hostile;
}

const scenario: PerfScenario = {
  calls: { micro: 50_000, realistic: 300, pathological: 5 },
  variants: {
    'native/micro': () => {
      const input = { email: 'ada.lovelace@example.com', password: 'analytical' };
      return () => nativeIsLogin(input);
    },
    'valibot/micro': () => {
      const input = { email: 'ada.lovelace@example.com', password: 'analytical' };
      return () => v.safeParse(LoginSchema, input).success;
    },
    'native/realistic': () => {
      const inputs = logins(4, 100, 8);
      return () => inputs.map(nativeIsLogin);
    },
    'valibot/realistic': () => {
      const inputs = logins(4, 100, 8);
      return () => inputs.map((input) => v.safeParse(LoginSchema, input).success);
    },
    'native/pathological': () => {
      const inputs = hostileLogins();
      return () => inputs.map(nativeIsLogin);
    },
    'valibot/pathological': () => {
      const inputs = hostileLogins();
      return () => inputs.map((input) => v.safeParse(LoginSchema, input).success);
    },
  },
};

export default scenario;
