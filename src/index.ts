import { createRng, randInt } from './rng.ts';

// --seed=123 を読む
function readSeed(argv: string[]): number {
  const hit = argv.find((a) => a.startsWith('--seed='));
  const n = hit ? Number(hit.slice('--seed='.length)) : NaN;
  return Number.isFinite(n) ? n : 1;
}

function main(argv: string[]): void {
  const seed = readSeed(argv);
  const rng = createRng(seed);
  console.log(`basketball-simulation seed=${seed}`);
  console.log(`sample: ${[0, 1, 2].map(() => randInt(rng, 100)).join(', ')}`);
}

main(process.argv.slice(2));
