import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: '*.feature',
  steps: '*.test.mjs',
});

export default defineConfig({
  testDir,
  reporter: 'list',
});
