import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Stub the WASM package in tests — real WASM can't run in jsdom
    '^infall-wasm$': '<rootDir>/__mocks__/infall-wasm.ts',
  },
};

export default createJestConfig(config);
