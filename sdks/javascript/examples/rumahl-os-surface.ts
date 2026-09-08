/**
 * Example: using the full `ora.*` SDK surface from an app.
 *
 * Shows the OS-level capabilities (jobs, clipboard, permissions, files,
 * secrets, devices, system events) on top of the classic smart-home APIs.
 * Mirrors the example in docs/sdks/rumahl-sdk.md.
 *
 * Run: ts-node examples/rumahl-os-surface.ts (with RUMAHL_APP_TOKEN set)
 */
import { rumahlClient } from '../src';

const ora = new rumahlClient({
  baseUrl: process.env.RUMAHL_BASE_URL || 'http://localhost:8126',
  apiKey: process.env.RUMAHL_APP_TOKEN,
});
ora.setAppId('my-app');

async function main() {
  // 1. Ask for a permission the app does not hold yet (shell shows Allow/Deny)
  await ora.permissions
    .request({ permission: 'os.power', reason: 'Schedule a nightly shutdown' })
    .catch((e) => console.log('permission request skipped:', e.message));

  // 2. Run a long task as a system job (survives app switches, Job Center)
  const job = await ora.jobs.create({
    name: 'Export holiday photos',
    job_type: 'export',
    source: 'my-app',
  });
  for (let p = 10; p <= 100; p += 30) {
    await ora.jobs.update(job.id, { progress: p, message: `Step ${p / 30}/4`, status: 'running' });
  }
  await ora.jobs.update(job.id, { progress: 100, status: 'completed' });

  // 3. Files: list the user's root, then copy something into the job output folder
  const { files } = await ora.files.list({ folderId: null });
  const folder = await ora.files.createFolder('exports');
  if (files[0]) await ora.files.copy(files[0].id, folder.id);

  // 4. Clipboard + secrets + devices + system events
  await ora.clipboard.add('Export finished');
  await ora.secrets.create({ name: 'ftp_password', value: 'hunter2' }).catch(() => {});
  const devices = await ora.devices.list();
  await ora.system.reportEvent({
    severity: 'info',
    source: 'my-app',
    message: `Export finished, ${devices.length} devices on the network`,
  });

  console.log('done — open the Job Center to see the export job.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
