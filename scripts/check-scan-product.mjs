/** Reproducible offline scan regressions. Never reads private room captures or
 * invokes a live AI provider. Each suite gets an isolated module/store cache. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  'native-import', 'native-real-scans', 'native-persistence', 'native-mesh',
  'native-textures', 'native-plane-textures', 'native-countertop-planes', 'native-asset-transfer', 'native-detail-photos',
  'scan-design', 'scan-clearance', 'scan-wall-evidence', 'scan-finish-estimates', 'scan-photo-finishes',
  'scan-finish-api', 'scan-finish-admission', 'bounded-photo-input',
  'photo-floor-registration', 'observed-top-owners', 'observed-model', 'mirror-lifecycle',
  'countertop-appearance', 'clean-face-finish', 'captured-furniture',
  'reconstructed-mirrors', 'reconstructed-floor', 'reconstructed-floor-finish',
  'reconstructed-object-refinement', 'captured-camera-projection', 'native-sharing',
  'scanned-object-parts', 'scanned-material-slots', 'scan-view', 'jarvis-native', 'preview-context',
];
const pending = [...suites], results = [];
function run(name) {
  return new Promise(resolve => {
    const code = `import { createJiti } from 'jiti'; const jiti = createJiti(process.cwd() + '/', { alias: { '@': process.cwd() + '/src' }, jsx: { runtime: 'automatic' }, fsCache: false }); await jiti.import(${JSON.stringify(`./scripts/check-${name}.ts`)});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', reason = '';
    const append = chunk => { output += chunk; if (output.length > 1_000_000) { reason = 'output limit exceeded'; child.kill(); } };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { reason = '120-second timeout'; child.kill(); }, 120_000);
    child.on('error', error => { reason = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const passed = code === 0 && !reason;
      results.push({ name, passed });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${reason || signal ? ` (${reason || signal})` : ''}`);
      if (!passed) process.stderr.write(output.slice(-8000));
      resolve();
    });
  });
}
await Promise.all(Array.from({ length: 3 }, async () => { while (pending.length) await run(pending.shift()); }));
console.log(`Scan product suites: ${results.filter(r => r.passed).length}/${suites.length} passed.`);
console.log('Physical LiDAR accuracy, real browser GPU rendering and live provider/Redis connectivity are separate checks.');
if (results.some(result => !result.passed)) process.exitCode = 1;
