// Writes the framework recipes of the reactive guide, its blocks fenced ```ts angular and ```ts vue, to
// recipe-angular.ts and recipe-vue.ts in the current folder, once the English and the French guide show the same code:
// the files of this folder then judge the code a reader copies. Run by tests/interop/run.sh.
//
// Usage: node recipes.mjs <docs/guide/en/reactive.md> <docs/guide/fr/reactive.md>
import { readFileSync, writeFileSync } from 'node:fs';

const recipes = (file) => {
  const found = new Map();
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const fence = /^```ts (angular|vue)$/.exec(lines[index]);
    if (fence !== null) {
      const end = lines.indexOf('```', index + 1);
      found.set(fence[1], `${lines.slice(index + 1, end).join('\n')}\n`);
      index = end;
    }
  }
  return found;
};

const [english, french] = process.argv.slice(2).map(recipes);
for (const name of ['angular', 'vue']) {
  if (!english.has(name) || english.get(name) !== french.get(name)) {
    throw new Error(`the ${name} recipe is missing from a guide, or differs between them`);
  }
  writeFileSync(`recipe-${name}.ts`, english.get(name));
}
