// scripts/download-gpt2.js
import { downloadModel } from '@xenova/transformers';

async function main() {
  // This will cache to ./models/gpt2/
  await downloadModel('gpt2', { localDir: './models' });
  console.log('GPT-2 model downloaded.');
}

main();
