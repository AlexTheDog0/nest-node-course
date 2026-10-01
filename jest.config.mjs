export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '<rootDir>/test/integration/**/*.test.mjs',
    '<rootDir>/test/e2e/**/*.test.mjs',
    '<rootDir>/test/contract/**/*.test.mjs',
  ],
  reporters: ['default'],
  verbose: true,
  maxWorkers: 1,
  testTimeout: 120000,
};
