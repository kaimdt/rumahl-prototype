import { readFile } from 'fs/promises';
import { extractManifestFromZip } from './frontend/src/lib/zip.js';
import { File } from 'buffer';

async function verify() {
  try {
    const zipPath = './apps/examples/network-scanner-app/network-scanner-app.zip';
    const zipBuffer = await readFile(zipPath);

    // Polyfill File for Node environment if necessary,
    // but Node 20+ has File and buffer.File can be used.
    const file = new File([zipBuffer], 'network-scanner-app.zip', { type: 'application/zip' }) as unknown as any;

    console.log('Extracting manifest from:', zipPath);
    const manifest = await extractManifestFromZip(file);

    console.log('Successfully extracted manifest:');
    console.log(JSON.stringify(manifest, null, 2));

    if (manifest.id === 'network-scanner-app' && manifest.name === 'Network Scanner') {
      console.log('Verification SUCCESS: Manifest data matches expected values.');
    } else {
      console.log('Verification FAILED: Manifest data does not match expected values.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Verification ERROR:', error);
    process.exit(1);
  }
}

verify();
