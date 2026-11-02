// A login form schema, an email and a password of at least eight characters, with the call that parses an input. The
// pattern is valibot's email pattern: its reference scenario carries the same one.
import { object, parse, string } from '@yaltaan/schema';

const EMAIL = /^[\w+-]+(?:\.[\w+-]+)*@[\da-zA-Z]+(?:[.-][\da-zA-Z]+)*\.[a-zA-Z]{2,}$/u;

const LoginSchema = object({ email: string({ pattern: EMAIL, maxLength: 254 }), password: string({ minLength: 8 }) });

export const parseLogin = (input) => parse(LoginSchema, input);
