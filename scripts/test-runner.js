#!/usr/bin/env node
// scripts/test-runner.js

const { spawn } = require('child_process');
const path = require('path');

const testTypes = {
  unit: ['--testPathPattern=unit'],
  integration: ['--testPathPattern=integration'],
  e2e: ['--testPathPattern=e2e'],
  all: []
};

const testEnvironments = {
  development: {
    NODE_ENV: 'test',
    SUPPRESS_LOGS: 'false'
  },
  ci: {
    NODE_ENV: 'test',
    SUPPRESS_LOGS: 'true',
    CI: 'true'
  },
  coverage: {
    NODE_ENV: 'test',
    SUPPRESS_LOGS: 'true'
  }
};

function runTests(type = 'all', environment = 'development', options = []) {
  const env = { ...process.env, ...testEnvironments[environment] };
  const args = ['--detectOpenHandles', '--forceExit', ...testTypes[type], ...options];

  console.log(`🧪 Running ${type} tests in ${environment} environment`);
  console.log(`Command: jest ${args.join(' ')}\n`);

  const jest = spawn('npx', ['jest', ...args], {
    stdio: 'inherit',
    env
  });

  jest.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ All tests passed!');
    } else {
      console.log('\n❌ Some tests failed.');
      process.exit(code);
    }
  });

  jest.on('error', (error) => {
    console.error('Failed to start test runner:', error);
    process.exit(1);
  });
}

// Parse command line arguments
const args = process.argv.slice(2);
const testType = args[0] || 'all';
const testEnv = args[1] || 'development';
const additionalOptions = args.slice(2);

if (!testTypes[testType]) {
  console.error(`Invalid test type: ${testType}`);
  console.error(`Available types: ${Object.keys(testTypes).join(', ')}`);
  process.exit(1);
}

if (!testEnvironments[testEnv]) {
  console.error(`Invalid environment: ${testEnv}`);
  console.error(`Available environments: ${Object.keys(testEnvironments).join(', ')}`);
  process.exit(1);
}

runTests(testType, testEnv, additionalOptions);