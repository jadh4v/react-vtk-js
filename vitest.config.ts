import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // Match the project tsconfig "jsx": "react-jsx" so JSX in test files
    // is transformed via the React 17+ automatic runtime (no React import needed).
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
