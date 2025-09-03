// tests/setup.js - Fixed MongoDB setup
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// Global MongoDB Memory Server instance
let mongoServer;

// Global setup - runs once before all tests
beforeAll(async () => {
  console.log('Starting MongoDB Memory Server...');
  
  try {
    // Create MongoDB Memory Server instance
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: '6.0.0', // Specify MongoDB version
        downloadDir: './node_modules/.cache/mongodb-memory-server/mongodb-binaries',
      },
      instance: {
        port: undefined, // Let it choose a random port
        dbName: 'agrilens-test',
      },
    });

    const mongoUri = mongoServer.getUri();
    console.log('MongoDB Memory Server started at:', mongoUri);

    // Set environment variables
    process.env.NODE_ENV = 'test';
    process.env.MONGO_URL = mongoUri;
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
    process.env.OPENAI_API_KEY = 'test-openai-api-key';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.CLIENT_URL = 'http://localhost:3000';
    
    // Connect to the in-memory database
    await mongoose.connect(mongoUri, {
      dbName: 'agrilens-test'
    });

    console.log('Connected to test database');
  } catch (error) {
    console.error('Failed to start MongoDB Memory Server:', error);
    throw error;
  }

  // Suppress console logs during tests (optional)
  if (process.env.SUPPRESS_LOGS === 'true') {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  }
});

// Global teardown - runs once after all tests
afterAll(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('Disconnected from test database');
    }
    
    if (mongoServer) {
      await mongoServer.stop();
      console.log('MongoDB Memory Server stopped');
    }
  } catch (error) {
    console.error('Error during test cleanup:', error);
  }

  // Reset mocks
  jest.restoreAllMocks();
});

// Clean up between test suites
beforeEach(async () => {
  // Clear all collections before each test
  if (mongoose.connection.readyState === 1) {
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      await collection.deleteMany({});
    }
  }
});

// Increase timeout for database operations
jest.setTimeout(30000);