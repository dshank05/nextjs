// Backend tests (tests/backend): the real API routes and libs over an in-memory database.
// Run: npm run test:backend
// Dates are India days (the shop's): tests assume the server runs in Asia/Kolkata.
process.env.TZ = 'Asia/Kolkata';
const nextJest = require('next/jest');
const createJestConfig = nextJest({ dir: './' });
const S = '<rootDir>/tests/backend/support';
module.exports = createJestConfig({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/backend/**/*.test.{js,ts}'],
  testTimeout: 170000,
  setupFilesAfterEnv: ['<rootDir>/tests/backend/support/setup.js'],
  moduleNameMapper: {
    '^@prisma/client$': `${S}/prismaclient-stub.js`,
    '^(\\.\\.?/)+(lib/)?db$': `${S}/dbstub.js`,
    'withObservability$': `${S}/obs.js`,
    '^next-auth(/.*)?$': `${S}/authstub.js`,
    '\\[\\.\\.\\.nextauth\\]$': `${S}/authstub.js`
  }
});
