import { generateKeyPair } from './public/drop-crypto.js';
import { keysDir, refuseExistingKeys, writeKeyPair } from './keys.ts';

const dir = keysDir();
let publicPath: string, privatePath: string;
try {
  // Checked up front so a refusal doesn't first wait on RSA-4096 generation.
  refuseExistingKeys(dir);
  [publicPath, privatePath] = writeKeyPair(dir, await generateKeyPair());
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

console.log(`Wrote ${publicPath}`);
console.log(`Wrote ${privatePath} (owner-only)`);
console.log('Keep the private key safe — it is the only way to open uploads.');
