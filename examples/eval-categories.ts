import 'dotenv/config';
import { analyze } from '../src/index.js';

// Live evaluation across categories and modes. Requires API keys; not run in CI.
// Usage: npx tsx examples/eval-categories.ts
const SAMPLES: Array<{ category: string; text: string }> = [
  {
    category: 'apparel_footwear',
    text: 'Acme Trail Shell Jacket, forest green ripstop nylon, relaxed fit, sizes XS–XXL, 480 g.',
  },
  {
    category: 'electronics',
    text: 'Acme Kettle, 1.5 L, matte black stainless steel, 2200 W, keep-warm function.',
  },
  {
    category: 'real_estate',
    text: 'Sunny 3-bedroom townhouse in Lisbon, 128 m², rooftop terrace, renovated 2021.',
  },
  {
    category: 'food_beverage',
    text: 'Acme dark chocolate 70%, 100 g bar, single origin Ecuador, notes of cherry.',
  },
];

for (const sample of SAMPLES) {
  for (const mode of ['parallel', 'sequential'] as const) {
    const result = await analyze(sample.text, {
      outputs: ['spec', 'image'],
      mode,
      category: sample.category,
      image: { includePrompt: true },
    });
    const prompt = result.image?.prompt ?? '(no image)';
    const forbidden = /\d+\s?(kg|g|ml|mm|W|€|\$)|premium|best/i.test(prompt);
    console.log(
      [
        sample.category,
        mode,
        `specKeys=${Object.keys(result.spec ?? {}).length}`,
        `image=${result.image ? 'yes' : 'no'}`,
        `forbidden=${forbidden}`,
      ].join(' | '),
    );
  }
}
