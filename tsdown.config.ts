import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  noExternal: [/.*/],
  // inline skills/ markdown files as strings
  loader: { '.md': 'text' },
})
