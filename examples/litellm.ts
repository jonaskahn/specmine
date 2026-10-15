import 'dotenv/config';
import { analyze, createOpenAiImageProvider, createPipeline } from '../src/index.js';

// Route text + image calls through a LiteLLM proxy with one base URL
const pipeline = createPipeline(
  {
    imageProvider: createOpenAiImageProvider({
      apiHost: process.env.SPECMINE_IMAGE_API_HOST ?? 'http://localhost:4000',
      model: process.env.SPECMINE_IMAGE_MODEL ?? 'dall-e-3',
    }),
  },
  { ...(process.env.SPECMINE_LLM_API_KEY ? { apiKey: process.env.SPECMINE_LLM_API_KEY } : {}) },
);

const result = await pipeline.process('Acme desk lamp, brushed aluminium, dimmable.', {
  outputs: ['spec', 'image'],
});
console.log(result.category);
console.log(JSON.stringify(result.spec, null, 2));

// Same via options only, no custom pipeline
const direct = await analyze('Acme desk lamp, brushed aluminium, dimmable.', {
  outputs: ['image'],
  image: {
    ...(process.env.SPECMINE_IMAGE_API_HOST
      ? { apiHost: process.env.SPECMINE_IMAGE_API_HOST }
      : {}),
    ...(process.env.SPECMINE_IMAGE_MODEL ? { model: process.env.SPECMINE_IMAGE_MODEL } : {}),
    size: '1792x1024',
  },
});
console.log(direct.image?.prompt);
