const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');

// Mock external dependencies
jest.mock('axios');
jest.mock('@supabase/supabase-js');

const { createClient } = require('@supabase/supabase-js');

// Import server and models
let app, Diagnosis, ChatSession;

describe('AgriLens Server - Current Architecture Tests', () => {
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

  describe('Plant Disease Diagnosis (/diagnose)', () => {
    const mockImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    test('Successfully processes image and saves to MongoDB/Supabase', async () => {
      const mockLLMData = {
        diseaseType: 'Maize Lethal Necrosis',
        cropsAffected: ['Maize'],
        affectedAreas: ['Leaves'],
        symptoms: ['Yellowing', 'Drying'],
        recommendedAction: 'Uproot and burn affected plants.'
      };

      // Mock OpenAI/GPT-4o response
      axios.post.mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: JSON.stringify(mockLLMData) } }]
        }
      });

      const res = await request(app)
        .post('/diagnose')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ image: mockImage })
        .expect(200);

      expect(res.body.disease).toBe('Maize Lethal Necrosis');
      expect(res.body.plantImageUrl).toBeDefined();
      
      // Verify DB persistence
      const saved = await Diagnosis.findOne({ userId: mockUserId });
      expect(saved).toBeTruthy();
      expect(saved.llmAnalysis.diseaseType).toBe('Maize Lethal Necrosis');
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