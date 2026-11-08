import { build, context } from 'esbuild';

const options = {
  entryPoints: ['ui/studio.tsx'],
  outfile: 'public/studio.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: !process.argv.includes('--watch'),
  external: ['/app.js'],
  define: { 'process.env.NODE_ENV': '"production"' },
};
if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
