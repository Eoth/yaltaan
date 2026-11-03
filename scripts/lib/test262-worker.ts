// One thread of scripts/test262.ts: runs the tests it is sent, in the order it receives them.
import { parentPort, workerData } from 'node:worker_threads';
import { Runner, type Setup } from './test262.ts';

const runner = new Runner(workerData as Setup);
parentPort?.on('message', (tests: readonly string[]) => {
  parentPort?.postMessage(tests.map((test) => runner.run(test)));
});
