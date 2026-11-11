// What the form uses of the platform beyond ES2023, which browsers and Node both give: declared for its build alone,
// which reads neither the DOM's library nor Node's. The declarations it emits name only the global `AbortSignal`, which
// node.ts declares empty for an application that reads neither.
interface AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare var AbortController: new () => AbortController;
