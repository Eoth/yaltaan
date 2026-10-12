// A login form schema, an email and a password of at least eight characters, with the call that parses an input.
import * as v from 'valibot';

const LoginSchema = v.object({ email: v.pipe(v.string(), v.email()), password: v.pipe(v.string(), v.minLength(8)) });

export const parseLogin = (input) => v.safeParse(LoginSchema, input);
