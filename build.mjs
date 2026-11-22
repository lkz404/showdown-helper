import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/page-hook.js', 'src/content.js', 'src/background.js', 'src/popup.js'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  logLevel: 'info',
});

cpSync('src/panel.css', 'dist/panel.css');
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/popup.css', 'dist/popup.css');
