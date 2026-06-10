/** @type {import('jest').Config} */
const createJestConfig = require('next/jest')({ dir: './' });

const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Stub the WASM package in tests — real WASM can't run in jsdom
    '^infall-wasm$': '<rootDir>/__mocks__/infall-wasm.ts',
  },
  // Prevent jest-haste-map from indexing the wasm-pkg local package, which
  // causes a "dupMap.get is not a function" error in newer jest-haste-map.
  modulePathIgnorePatterns: ['<rootDir>/wasm-pkg/'],
  watchPathIgnorePatterns: ['<rootDir>/wasm-pkg/'],
};

module.exports = createJestConfig(config);
