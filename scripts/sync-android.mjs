import { mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../public/', import.meta.url));
const dest = fileURLToPath(new URL('../android/app/src/main/assets/', import.meta.url));
await mkdir(dest, { recursive: true }); await cp(source, dest, { recursive: true });
console.log('安卓游戏资源已同步');
