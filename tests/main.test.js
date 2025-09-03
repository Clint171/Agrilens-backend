// tests/server.test.js - Fixed version with proper MongoDB handling
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const io = require('socket.io-client');

// Mock external dependencies BEFORE importing the server
jest.mock('axios');
jest.mock('google-auth-library');

const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

// Import your server AFTER setting up mocks and environment
let app, server, ioServer, User, Diagnosis, ChatSession;

describe('AgriLens Server Test Suite', () => {
  let testUser;
  let authToken;

  // Setup before all tests in this describe block
  beforeAll(async () => {
    // Wait for MongoDB connection to be ready
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => {
        mongoose.connection.on('connected', resolve);
      });
    }

    // Now import the server modules
    const serverModule = require('../server');
    app = serverModule.app;
    server = serverModule.server;
    ioServer = serverModule.io;
    User = serverModule.User;
    Diagnosis = serverModule.Diagnosis;
    ChatSession = serverModule.ChatSession;

    console.log('Test setup complete, MongoDB ready');
  });

  // Setup before each test
  beforeEach(async () => {
    // Clear database collections
    await User.deleteMany({});
    await Diagnosis.deleteMany({});
    await ChatSession.deleteMany({});

    // Create test user
    const hashedPassword = await bcrypt.hash('testpassword', 10);
    
    testUser = await User.create({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: hashedPassword,
      authProvider: 'local'
    });

    // Generate auth token
    authToken = jwt.sign(
      { id: testUser._id, email: testUser.email, authProvider: 'local' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Health Check', () => {
    test('GET /health should return OK', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);
      
      expect(res.body.status).toBe('OK');
    });
  });

  describe('Authentication - Signup', () => {
    test('POST /signup should create new user successfully', async () => {
      const userData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'password123'
      };

      const res = await request(app)
        .post('/signup')
        .send(userData)
        .expect(201);

      expect(res.body.message).toBe('User created successfully');
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(userData.email);
      expect(res.body.user.authProvider).toBe('local');

      // Verify user was created in database
      const dbUser = await User.findOne({ email: userData.email });
      expect(dbUser).toBeTruthy();
      expect(dbUser.firstName).toBe(userData.firstName);
    });

    test('POST /signup should fail with missing fields', async () => {
      const userData = {
        firstName: 'John',
        email: 'john@example.com'
        // Missing lastName and password
      };

      const res = await request(app)
        .post('/signup')
        .send(userData)
        .expect(400);

      expect(res.body.error).toBe('All fields are required');
    });

    test('POST /signup should fail for existing email', async () => {
      const userData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com', // Already exists
        password: 'password123'
      };

      const res = await request(app)
        .post('/signup')
        .send(userData)
        .expect(400);

      expect(res.body.error).toBe('User already exists with this email');
    });
  });

  describe('Authentication - Login', () => {
    test('POST /login should authenticate valid user', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'testpassword'
      };

      const res = await request(app)
        .post('/login')
        .send(loginData)
        .expect(200);

      expect(res.body.message).toBe('Login successful');
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(loginData.email);
    });

    test('POST /login should fail with invalid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      const res = await request(app)
        .post('/login')
        .send(loginData)
        .expect(400);

      expect(res.body.error).toBe('Invalid credentials');
    });

    test('POST /login should fail for non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'password123'
      };

      const res = await request(app)
        .post('/login')
        .send(loginData)
        .expect(400);

      expect(res.body.error).toBe('Invalid credentials');
    });
  });

  describe('Plant Disease Diagnosis', () => {
    test('POST /diagnose should process image and return diagnosis', async () => {
      // Mock OpenAI response
      const mockLLMResponse = {
        diseaseType: 'Bacterial Blight',
        cropsAffected: ['Rice'],
        affectedAreas: ['Leaves'],
        symptoms: ['Brown spots', 'Yellowing'],
        recommendedAction: 'Apply copper-based fungicide'
      };

      axios.post.mockResolvedValue({
        data: {
          choices: [{
            message: {
              content: JSON.stringify(mockLLMResponse)
            }
          }]
        }
      });

      // Create mock image buffer
      const mockImageBuffer = Buffer.from('fake-image-data');

      const res = await request(app)
        .post('/diagnose')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('images', mockImageBuffer, 'test-image.jpg')
        .expect(200);

      expect(res.body.disease).toBe(mockLLMResponse.diseaseType);
      expect(res.body.cropsAffected).toEqual(mockLLMResponse.cropsAffected);
      expect(res.body.recommendedAction).toBe(mockLLMResponse.recommendedAction);

      // Verify diagnosis was saved to database
      const savedDiagnosis = await Diagnosis.findOne({ userId: testUser._id });
      expect(savedDiagnosis).toBeTruthy();
      expect(savedDiagnosis.llmAnalysis.diseaseType).toBe(mockLLMResponse.diseaseType);
    });

    test('POST /diagnose should fail without authentication', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data');

      const res = await request(app)
        .post('/diagnose')
        .attach('images', mockImageBuffer, 'test-image.jpg')
        .expect(401);

      expect(res.body.error).toBe('Access token required');
    });

    test('POST /diagnose should fail without image', async () => {
      const res = await request(app)
        .post('/diagnose')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.error).toBe('No image uploaded');
    });

    test('POST /diagnose should handle OpenAI API failure gracefully', async () => {
      // Mock OpenAI API failure
      axios.post.mockRejectedValue(new Error('OpenAI API Error'));

      const mockImageBuffer = Buffer.from('fake-image-data');

      const res = await request(app)
        .post('/diagnose')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('images', mockImageBuffer, 'test-image.jpg')
        .expect(200); // Should still return 200 with fallback response

      expect(res.body.disease).toBeDefined();
      expect(res.body.recommendedAction).toContain('consult with a local agricultural');
    });
  });

  describe('Diagnosis History', () => {
    beforeEach(async () => {
      // Create test diagnosis
      await Diagnosis.create({
        userId: testUser._id,
        originalPrediction: { disease: 'Test Disease', accuracy: '85%' },
        llmAnalysis: {
          diseaseType: 'Bacterial Blight',
          cropsAffected: ['Rice'],
          affectedAreas: ['Leaves'],
          symptoms: ['Brown spots'],
          recommendedAction: 'Apply fungicide'
        },
        confidenceScore: 85
      });
    });

    test('GET /diagnoses should return user diagnosis history', async () => {
      const res = await request(app)
        .get('/diagnoses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].disease).toBe('Bacterial Blight');
    });

    test('GET /diagnoses should fail without authentication', async () => {
      const res = await request(app)
        .get('/diagnoses')
        .expect(401);

      expect(res.body.error).toBe('Access token required');
    });

    test('GET /diagnoses should only return user-specific diagnoses', async () => {
      // Create another user and their diagnosis
      const otherUser = await User.create({
        firstName: 'Other',
        lastName: 'User',
        email: 'other@example.com',
        password: await bcrypt.hash('password', 10),
        authProvider: 'local'
      });

      await Diagnosis.create({
        userId: otherUser._id,
        originalPrediction: { disease: 'Other Disease', accuracy: '90%' },
        llmAnalysis: {
          diseaseType: 'Other Disease',
          cropsAffected: ['Corn'],
          affectedAreas: ['Stems'],
          symptoms: ['Wilting'],
          recommendedAction: 'Water more'
        },
        confidenceScore: 90
      });

      // Test user should only see their own diagnosis
      const res = await request(app)
        .get('/diagnoses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].disease).toBe('Bacterial Blight');
    });
  });

  describe('Chat Sessions - REST API', () => {
    beforeEach(async () => {
      // Create test chat session
      await ChatSession.create({
        userId: testUser._id,
        sessionId: `${testUser._id}_123456789`,
        messages: [
          { role: 'user', content: 'Hello', timestamp: new Date() },
          { role: 'assistant', content: 'Hi there!', timestamp: new Date() }
        ],
        isActive: true
      });
    });

    test('GET /chat/sessions should return user chat sessions', async () => {
      const res = await request(app)
        .get('/chat/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].sessionId).toBeDefined();
      expect(res.body[0].messageCount).toBe(2);
    });

    test('GET /chat/sessions/:sessionId should return specific session', async () => {
      const sessionId = `${testUser._id}_123456789`;
      
      const res = await request(app)
        .get(`/chat/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.sessionId).toBe(sessionId);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].content).toBe('Hello');
    });

    test('GET /chat/sessions/:sessionId should return 404 for non-existent session', async () => {
      const res = await request(app)
        .get('/chat/sessions/non-existent-session')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body.error).toBe('Chat session not found');
    });
  });

  describe('JWT Token Validation', () => {
    test('should accept valid JWT token', async () => {
      await request(app)
        .get('/diagnoses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });

    test('should reject invalid JWT token', async () => {
      const res = await request(app)
        .get('/diagnoses')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(res.body.error).toBe('Invalid or expired token');
    });

    test('should reject request without token', async () => {
      const res = await request(app)
        .get('/diagnoses')
        .expect(401);

      expect(res.body.error).toBe('Access token required');
    });
  });

  describe('Google OAuth Authentication', () => {
    test('POST /signup/google should create new Google user', async () => {
      // Mock Google OAuth verification
      const mockGoogleUser = {
        sub: 'google123',
        email: 'google@example.com',
        given_name: 'Google',
        family_name: 'User'
      };

      OAuth2Client.prototype.verifyIdToken = jest.fn().mockResolvedValue({
        getPayload: () => mockGoogleUser
      });

      const res = await request(app)
        .post('/signup/google')
        .send({ googleToken: 'mock-google-token' })
        .expect(201);

      expect(res.body.message).toBe('User created successfully');
      expect(res.body.user.email).toBe(mockGoogleUser.email);
      expect(res.body.user.authProvider).toBe('google');

      // Verify user was created in database
      const dbUser = await User.findOne({ email: mockGoogleUser.email });
      expect(dbUser).toBeTruthy();
      expect(dbUser.googleId).toBe(mockGoogleUser.sub);
    });

    test('POST /login/google should authenticate existing Google user', async () => {
      // Create Google user first
      await User.create({
        firstName: 'Google',
        lastName: 'User',
        email: 'google@example.com',
        googleId: 'google123',
        authProvider: 'google'
      });

      // Mock Google OAuth verification
      OAuth2Client.prototype.verifyIdToken = jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google123',
          email: 'google@example.com',
          given_name: 'Google',
          family_name: 'User'
        })
      });

      const res = await request(app)
        .post('/login/google')
        .send({ googleToken: 'mock-google-token' })
        .expect(200);

      expect(res.body.message).toBe('Login successful');
      expect(res.body.user.authProvider).toBe('google');
    });
  });

  describe('Data Validation and Security', () => {
    test('should prevent cross-user data access', async () => {
      // Create another user
      const otherUser = await User.create({
        firstName: 'Other',
        lastName: 'User',
        email: 'other@example.com',
        password: await bcrypt.hash('password', 10),
        authProvider: 'local'
      });

      const otherToken = jwt.sign(
        { id: otherUser._id, email: otherUser.email, authProvider: 'local' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Create diagnosis for test user
      await Diagnosis.create({
        userId: testUser._id,
        originalPrediction: { disease: 'Private Disease', accuracy: '85%' },
        llmAnalysis: {
          diseaseType: 'Private Disease',
          cropsAffected: ['Private Crop'],
          affectedAreas: ['Private Area'],
          symptoms: ['Private Symptom'],
          recommendedAction: 'Private Action'
        },
        confidenceScore: 85
      });

      // Other user should not see test user's diagnoses
      const res = await request(app)
        .get('/diagnoses')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    test('should validate JWT token integrity', async () => {
      // Tamper with token
      const tamperedToken = authToken.slice(0, -10) + '1234567890';

      const res = await request(app)
        .get('/diagnoses')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(403);

      expect(res.body.error).toBe('Invalid or expired token');
    });
  });
});