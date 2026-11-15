// The part of jsdom that the component tests use. jsdom ships no declarations; those of DefinitelyTyped would add three
// packages to the workspace for one constructor. Read by the type check of the tests only, never by the build.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
