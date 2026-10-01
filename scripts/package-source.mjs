import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Packaging uses the companion Python script; no credentials, data or SDK files.
const script = fileURLToPath(new URL('./package-source.py', import.meta.url));
const result = spawnSync(process.env.PYTHON || 'python', [script], { stdio: 'inherit' });
if (result.error) { console.error('请使用 Python 运行 scripts/package-source.py'); process.exit(1); }
process.exit(result.status ?? 1);
