import { defineConfig } from 'vitest/config';

/** Configuração só do benchmark de detecção (npm run bench). Não entra em `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/bench/**/*.bench-test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
});
