const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');

// Mock external dependencies
jest.mock('axios');
jest.mock('@supabase/supabase-js');
jest.mock('@google/generative-ai', () => {
  let mockInstance;
  const GoogleGenerativeAI = jest.fn().mockImplementation(() => {
    mockInstance = {
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn().mockResolvedValue({
          response: {
            candidates: [{
              content: {
                parts: [{ inlineData: { data: 'mock-pictorial-base64' } }]
              }
            }]
          }
        })
      })
    };
    return mockInstance;
  });
  return {
    GoogleGenerativeAI,
    __getGoogleGenAIInstance: () => mockInstance
  };
});

const { createClient } = require('@supabase/supabase-js');

// Import server and models
let app, Diagnosis, ChatSession;

describe('AgriLens Server - Judge & Analysis Tests', () => {
  const mockUserId = 'user_12345';
  const mockUserEmail = 'farmer@example.ke';
  const validToken = 'valid-supabase-token';

  // Mock Supabase Client behavior
  const mockSupabase = {
    auth: {
      getUser: jest.fn()
    },
    storage: {
      from: jest.fn().mockReturnThis(),
      upload: jest.fn().mockResolvedValue({ data: { path: 'path' }, error: null }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'http://supabase.com/pic.jpg' } })
    }
  };

  beforeAll(async () => {
    // Inject the mock into the module
    createClient.mockReturnValue(mockSupabase);

    const serverModule = require('../main');
    app = serverModule.app;
    Diagnosis = serverModule.Diagnosis;
    ChatSession = serverModule.ChatSession;
  });

  beforeEach(async () => {
    await Diagnosis.deleteMany({});
    await ChatSession.deleteMany({});
    jest.clearAllMocks();

    // Default Supabase Auth Success
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockUserId, email: mockUserEmail } },
      error: null
    });
  });

  describe('Authentication Middleware', () => {
    test('Should return 401 if no Authorization header is present', async () => {
      await request(app).get('/diagnoses').expect(401);
    });

    test('Should return 403 if Supabase token is invalid', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Invalid token') });
      
      await request(app)
        .get('/diagnoses')
        .set('Authorization', 'Bearer fake-token')
        .expect(403);
    });
  });

  describe('Plant Disease Diagnosis (/diagnose) - Judge Logic', () => {
    const mockImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    test('Should query external model, then verify and correct via LLM', async () => {
      // 1. Mock Prediction from MODEL_URL (Model thinks it's Healthy)
      axios.post.mockResolvedValueOnce({
        data: { disease: 'Healthy', accuracy: 88.5 }
      });

      // 2. Mock LLM verification and correction using the Google Generative AI client
      const mockLLMCorrection = {
        isModelCorrect: false,
        diseaseType: 'Tomato Early Blight',
        cropsAffected: ['Tomato'],
        affectedAreas: ['Leaves'],
        symptoms: ['Dark spots', 'Bullseye pattern'],
        recommendedAction: 'Apply copper-based fungicide.'
      };

      const googleGenAIInstance = require('@google/generative-ai').__getGoogleGenAIInstance();
      googleGenAIInstance.getGenerativeModel().generateContent.mockResolvedValueOnce({
        text: mockLLMCorrection
      });

      const res = await request(app)
        .post('/diagnose')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ image: mockImage })
        .expect(200);

      // --- Assertions ---
      
      // Check if the final result is the LLM correction, not the model's wrong guess
      expect(res.body.disease).toBe('Tomato Early Blight');
      
      // Check if the original model's confidence was preserved
      expect(res.body.confidenceScore).toBe(88.5);
      
      // Verify persistence in MongoDB
      const saved = await Diagnosis.findOne({ userId: mockUserId });
      expect(saved.originalPrediction.disease).toBe('Healthy'); // Verify history kept original guess
      expect(saved.llmAnalysis.diseaseType).toBe('Tomato Early Blight');
      
      // Ensure axios was called only for the external model prediction
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenNthCalledWith(1, process.env.MODEL_URL, expect.anything(), expect.anything());
    });
  });

  describe('Chat Sessions API', () => {
    test('GET /chat/sessions returns formatted summaries', async () => {
      await ChatSession.create({
        userId: mockUserId,
        sessionId: 'session_abc',
        messages: [{ role: 'user', content: 'How do I treat blight?' }],
        isActive: true
      });

      const res = await request(app)
        .get('/chat/sessions')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(res.body[0].sessionId).toBe('session_abc');
      expect(res.body[0].messageCount).toBe(1);
    });
  });
});