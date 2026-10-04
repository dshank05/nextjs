module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  verbose: true,
  // tests/backend has its own config (npm run test:backend).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/backend/'],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'pages/api/**/*.{js,ts}',
    'lib/**/*.{js,ts}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/prisma/',
    '/.next/',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
