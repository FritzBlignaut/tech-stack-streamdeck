import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Bake the short git commit hash into the bundle at build time.
// Displayed as v0.1.0-8a8f1b3 in the app's top-right corner.
let gitHash = 'dev'
try { gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() } catch {}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    setupFiles: ['./src/__tests__/setup.js'],
  },
})
