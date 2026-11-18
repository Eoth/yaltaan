// Writing a list of order lines kept by their product code: a line added with a new code, which is checked against
// every other, then taken out, and the whole list written back as it was. Written with the platform against an array
// of objects, and with an array of the form whose items are kept by `identity`.
import { array, createForm, field, group } from '@yaltaan/form';
import { seededRandom, word, type PerfScenario, type PerfVariant } from '../scenario.ts';

interface Line {
  sku: string;
  quantity: number;
}

/** `count` lines with distinct codes. */
function lines(seed: number, count: number): Line[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, index) => ({
    sku: `${word(random, 6)}-${index}`,
    quantity: 1 + Math.floor(random() * 9),
  }));
}

const ADDED: Line = { sku: 'added', quantity: 1 };

function native(rows: readonly Line[]): () => unknown {
  let list = rows.map((row) => ({ ...row }));
  return () => {
    if (list.some((line) => line.sku === ADDED.sku)) {
      throw new TypeError('a code is taken');
    }
    list = [{ ...ADDED }, ...list].slice(1);
    // Written back: each line kept by its code, its fields given the values written.
    const kept = new Map(list.map((line) => [line.sku, line]));
    list = rows.map((row) => Object.assign(kept.get(row.sku) ?? {}, row));
    return list;
  };
}

function yaltaan(rows: Line[]): () => unknown {
  const form = createForm(
    array(group({ sku: field(''), quantity: field(0) }), { identity: ['sku'], initial: rows, maxLength: 2000 }),
  );
  return () => {
    form.remove(form.insert(0, ADDED));
    form.set(rows);
    return form.raw.get();
  };
}

const sizes = { micro: 3, realistic: 50, pathological: 1000 } as const;

const variants: Record<string, PerfVariant> = {};
for (const [dataset, count] of Object.entries(sizes)) {
  variants[`native/${dataset}`] = () => native(lines(count, count));
  variants[`yaltaan/${dataset}`] = () => yaltaan(lines(count, count));
}

const scenario: PerfScenario = {
  calls: { micro: 2000, realistic: 200, pathological: 10 },
  variants,
};

export default scenario;
