import { defineConfig } from 'vite'

// Vite 4 does not read jsx settings through tsconfig project references.
// Keep runtime JSX transformation aligned with tsconfig.app.json and the tests.
export default defineConfig({ esbuild: { jsx: 'automatic' } })
