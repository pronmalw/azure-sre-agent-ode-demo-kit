module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // The CPU load suite asserts that a real busy-wait clears the host-saturation
  // threshold the classifier keys on. Parallel Jest workers compete for the same
  // cores, so the burn cannot reach that threshold and the suite fails for
  // reasons unrelated to the code under test. Measuring CPU requires having the
  // CPU to measure, so these run one at a time.
  maxWorkers: 1,
  moduleNameMapper: {
    '^@sre-demo/shared(.*)$': '<rootDir>/../shared$1'
  }
};
