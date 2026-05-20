const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json(
  { limit: '10mb' }
));

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// MongoDB connection
mongoose.connect(process.env.MONGO_URL, {
  dbName: "agrilens"
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// Diagnosis Schema
const diagnosisSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  originalPrediction: {
    disease: String,
    accuracy: String
  },
  llmAnalysis: {
    diseaseType: String,
    cropsAffected: [String],
    affectedAreas: [String],
    symptoms: [String],
    recommendedAction: String
  },
  plantImageUrl: String,
  pictorialUrl: String,
  confidenceScore: Number,
  createdAt: { type: Date, default: Date.now }
});

const Diagnosis = mongoose.model('Diagnosis', diagnosisSchema);

// Chat Session Schema
const chatSessionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  sessionId: { type: String, required: true, unique: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now }
});

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Supabase auth middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
};

// Socket.IO Supabase auth middleware
const authenticateSocketToken = async (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Access token required'));
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return next(new Error('Invalid or expired token'));
  }

  socket.user = user;
  next();
};

// Helper function to get user's diagnosis context
const getUserDiagnosisContext = async (userId) => {
  try {
    const diagnoses = await Diagnosis.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10); // Get last 10 diagnoses

    if (diagnoses.length === 0) {
      return "No previous diagnoses found.";
    }

    const contextString = diagnoses.map((diagnosis, index) => {
      return `Diagnosis ${index + 1} (${diagnosis.createdAt.toDateString()}):
              - Disease: ${diagnosis.llmAnalysis.diseaseType}
              - Crops Affected: ${diagnosis.llmAnalysis.cropsAffected.join(', ')}
              - Affected Areas: ${diagnosis.llmAnalysis.affectedAreas.join(', ')}
              - Symptoms: ${diagnosis.llmAnalysis.symptoms.join(', ')}
              - Recommended Action: ${diagnosis.llmAnalysis.recommendedAction}
              - Confidence Score: ${diagnosis.confidenceScore}%`;
    }).join('\n\n');
    return `Previous diagnoses for context:\n\n${contextString}`;
  } catch (error) {
    console.error('Error fetching diagnosis context:', error);
    return "Unable to retrieve previous diagnoses.";
  }
};

// Helper function to get AI chat response
const getAIChatResponse = async (messages, userContext, genAI) => {
  try {
    const systemPrompt = `You are AgriLens AI, an expert agricultural assistant specializing in plant disease diagnosis and farm management. You help farmers and agricultural professionals with:

      1. Plant disease identification and treatment
      2. Crop management advice
      3. Agricultural best practices
      4. Interpretation of previous diagnoses

      User Context:
      ${userContext}

      Instructions:
      - Use the user's previous diagnoses to provide personalized advice
      - Reference specific past diagnoses when relevant
      - Provide practical, actionable advice for Kenyan farmers, using local terminology and names where appropriate
      - Be concise but thorough
      - If asked about diseases not in their history, provide general agricultural guidance
      - Encourage consulting local agricultural extension services for complex issues`;

    
    const chat = genAI.chats.create({
      model: "gemini-3.5-flash",
      history: [messages.slice(0, messages.length - 1)],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
      },
    });


    const response = await chat.sendMessage({
      message: messages.pop(),
    });
    return response.text;
  } catch (error) {
    console.error('AI chat response error:', error);
    return "I apologize, but I'm having trouble processing your request right now. Please try again later or consult with a local agricultural expert.";
  }
};

const uploadToSupabase = async (base64Data, fileName) => {
  try {""
    const buffer = Buffer.from(base64Data, 'base64');
    const { data, error } = await supabase.storage
      .from('Agrilens images') // Ensure this bucket exists and is public
      .upload(`${fileName}`, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('Agrilens images')
      .getPublicUrl(`${fileName}`);

    return publicUrl;
  } catch (err) {
    console.error("Supabase Upload Error:", err);
    return null;
  }
};

const generateRecommendationPictorial = async (recommendationText, diseaseName) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });
    
    // Context-aware prompt for Kenyan agriculture
    const prompt = `A clear, instructional agricultural pictorial set in a Kenyan farm context. 
                    It illustrates the following recommended action for ${diseaseName}: "${recommendationText}". 
                    The style should be a professional, clean infographic with realistic African farmers and local crops. 
                    Avoid text in the image, focus on visual explanation.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Google Imagen usually returns images as base64 in the response parts
    const imagePart = response.candidates[0].content.parts.find(p => p.inlineData);
    if (!imagePart) return null;

    // Upload the generated AI image to Supabase
    const fileName = `pictorial_${Date.now()}.png`;
    return await uploadToSupabase(imagePart.inlineData.data, fileName);
  } catch (error) {
    console.error("Google Image Gen Error:", error);
    return null; // Fallback to no image if generation fails
  }
};

// This function now acts as both a Judge and an Analyst
const getVerifiedLLMAnalysis = async (base64Images, modelPrediction = null, genAI) => {
  try {
    const { disease, accuracy } = modelPrediction || { disease: 'Unknown', accuracy: 0 };
    
    // The prompt now includes the "Judging" logic
    const prompt = `
    I have a plant image and a computer vision model prediction.
    Model Prediction: ${disease} (Confidence: ${accuracy}%)

    Task:
    1. Look at the image.
    2. Determine if the model's prediction (${disease}) is correct.
    3. If the model is CORRECT, provide an analysis for "${disease}".
    4. If the model is WRONG or the prediction is "Unknown", identify the correct disease yourself and provide the analysis.
    5. Always provide the common Kenyan name for the disease if available.

    Return ONLY a valid JSON object:
    {
      "isModelCorrect": true/false,
      "diseaseType": "specific disease name, in English and local Kenyan name if possible",
      "cropsAffected": ["crop1", "crop2"],
      "affectedAreas": ["area1", "area2"],
      "symptoms": ["symptom1", "symptom2"],
      "recommendedAction": "detailed action"
    }`;

    const imageArray = Array.isArray(base64Images) ? base64Images : [base64Images];
 
    const contents = [
      {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageArray[0],
      },
      },
      { text: prompt }
    ];

    const response = await genAI.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: 'You are an expert agricultural pathologist. Analyze plant images to verify model predictions and identify diseases accurately.',
        temperature: 0.2,
        responseFormat: {
          type: 'json_object',
          jsonObjectSpecs: {
            properties: {
              isModelCorrect: { type: 'boolean' },
              diseaseType: { type: 'string' },
              cropsAffected: { type: 'array', items: { type: 'string' } },
              affectedAreas: { type: 'array', items: { type: 'string' } },
              symptoms: { type: 'array', items: { type: 'string' } },
              recommendedAction: { type: 'string' }
            },
            required: ['isModelCorrect', 'diseaseType', 'cropsAffected', 'affectedAreas', 'symptoms', 'recommendedAction']
          }
        }
      },
    });

    return response.text;
  } catch (error) {
    console.error('LLM verification error:', error);
    return {
      diseaseType: modelPrediction?.disease || 'Analysis unavailable',
      cropsAffected: ['Unknown'],
      affectedAreas: ['Unknown'],
      symptoms: ['Error processing image'],
      recommendedAction: 'Please consult a local agricultural officer.'
    };
  }
};

// Socket.IO connection handling
io.use(authenticateSocketToken);

io.on('connection', async (socket) => {
  console.log(`User ${socket.user.email} connected to chat`);

  // Get user's diagnosis context
  const userContext = await getUserDiagnosisContext(socket.user.id);

  // Join user to their personal room
  socket.join(`user_${socket.user.id}`);

  // Handle new chat session
  socket.on('start_chat', async (data) => {
    try {
      console.log(`Starting new chat session for user ${socket.user.email}`);
      const sessionId = `${socket.user.id}_${Date.now()}`;
      
      const chatSession = new ChatSession({
        userId: socket.user.id,
        sessionId,
        messages: []
      });

      await chatSession.save();

      socket.emit('chat_started', {
        sessionId,
        message: 'Hello! I\'m AgriLens AI, your agricultural assistant. I can help you with plant diseases, crop management, and interpret your previous diagnoses. How can I assist you today?'
      });
    } catch (error) {
      console.error('Start chat error:', error);
      socket.emit('error', { message: 'Failed to start chat session' });
    }
  });

  // Handle chat messages
  socket.on('chat_message', async (data) => {
    try {
      const { sessionId, message } = data;

      if (!sessionId || !message) {
        socket.emit('error', { message: 'Session ID and message are required' });
        return;
      }

      // Find chat session
      const chatSession = await ChatSession.findOne({ 
        sessionId, 
        userId: socket.user.id 
      });

      if (!chatSession) {
        socket.emit('error', { message: 'Chat session not found' });
        return;
      }

      // Add user message to session
      chatSession.messages.push({
        role: 'user',
        content: message
      });

      chatSession.lastActivity = new Date();
      await chatSession.save();

      // Emit user message back to client
      socket.emit('message_received', {
        role: 'user',
        content: message,
        timestamp: new Date()
      });

      // Prepare messages for AI
      const messagesForAI = chatSession.messages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }));

      // Get AI response
      const aiResponse = await getAIChatResponse(messagesForAI, userContext, genAI);

      // Add AI response to session
      chatSession.messages.push({
        role: 'model',
        content: aiResponse
      });

      chatSession.lastActivity = new Date();
      await chatSession.save();

      // Emit AI response to client
      socket.emit('ai_response', {
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Chat message error:', error);
      socket.emit('error', { message: 'Failed to process message' });
    }
  });

  // Handle get chat history
  socket.on('get_chat_history', async (data) => {
    try {
      const { sessionId } = data;

      const chatSession = await ChatSession.findOne({ 
        sessionId, 
        userId: socket.user.id 
      });

      if (!chatSession) {
        socket.emit('error', { message: 'Chat session not found' });
        return;
      }

      socket.emit('chat_history', {
        sessionId,
        messages: chatSession.messages
      });

    } catch (error) {
      console.error('Get chat history error:', error);
      socket.emit('error', { message: 'Failed to retrieve chat history' });
    }
  });

  // Handle get user's chat sessions
  socket.on('get_chat_sessions', async () => {
    try {
      const sessions = await ChatSession.find({ 
        userId: socket.user.id,
        isActive: true 
      })
      .sort({ lastActivity: -1 })
      .limit(20)
      .select('sessionId createdAt lastActivity messages');

      const sessionSummaries = sessions.map(session => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messages.length,
        lastMessage: session.messages.length > 0 ? 
          session.messages[session.messages.length - 1].content.substring(0, 100) + '...' : 
          'No messages'
      }));

      socket.emit('chat_sessions', sessionSummaries);

    } catch (error) {
      console.error('Get chat sessions error:', error);
      socket.emit('error', { message: 'Failed to retrieve chat sessions' });
    }
  });

  // Handle end chat session
  socket.on('end_chat', async (data) => {
    try {
      const { sessionId } = data;

      await ChatSession.findOneAndUpdate(
        { sessionId, userId: socket.user.id },
        { isActive: false }
      );

      socket.emit('chat_ended', { sessionId });

    } catch (error) {
      console.error('End chat error:', error);
      socket.emit('error', { message: 'Failed to end chat session' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.email} disconnected from chat`);
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// POST /diagnose - Enhanced with authentication and LLM analysis
app.post('/diagnose', authenticateToken, async (req, res) => {
  try {
    const { image, images } = req.body;
    if (!image && (!images || images.length === 0)) {
      return res.status(400).json({ error: "No images provided" });
    }

    const base64Images = images || [image];
    const primaryImage = base64Images[0];

    // 1. Get Prediction from your external MODEL_URL
    let prediction;
    try {
      const modelResponse = await axios.post(process.env.MODEL_URL, {
        type: "single",
        data: primaryImage 
      }, { timeout: 10000 }); // 10s timeout for model safety
      
      prediction = modelResponse.data; // Expecting { disease, accuracy }
    } catch (modelError) {
      console.error("External Model Error:", modelError.message);
      // Fallback: If model is down, we let LLM handle it (Bypass mode)
      prediction = { disease: 'Unknown', accuracy: 0 };
    }

    // 2. Get LLM Verification and Analysis (using the function from the previous step)
    // This uses the model's prediction as context for the "Judge"
    const result = await getVerifiedLLMAnalysis(base64Images, prediction, genAI);

    // 3. Parallel Tasks: Upload to Supabase and Generate Pictorial
    const plantImageName = `${req.user.id}_plant_${Date.now()}.jpg`;
    
    const [plantImageUrl, pictorialUrl] = await Promise.all([
      uploadToSupabase(primaryImage, plantImageName),
      generateRecommendationPictorial(result.recommendedAction, result.diseaseType)
    ]);

    // 4. Save to MongoDB
    // We keep the original model's confidence as requested
    const diagnosis = new Diagnosis({
      userId: req.user.id,
      originalPrediction: { 
        disease: prediction.disease, 
        accuracy: prediction.accuracy.toString() 
      },
      llmAnalysis: result,
      plantImageUrl,
      pictorialUrl,
      confidenceScore: prediction.accuracy, // Original model confidence
      createdAt: new Date()
    });

    await diagnosis.save();

    // 5. Response to Frontend
    res.json({
      id: diagnosis._id,
      disease: result.diseaseType,
      isModelCorrect: result.isModelCorrect,
      cropsAffected: result.cropsAffected,
      symptoms: result.symptoms,
      recommendedAction: result.recommendedAction,
      plantImageUrl,
      pictorialUrl,
      confidenceScore: prediction.accuracy, 
      createdAt: diagnosis.createdAt
    });

  } catch (error) {
    console.error("Critical Diagnosis failure:", error);
    res.status(500).json({ error: "Failed to process diagnosis" });
  }
});

// GET /diagnoses - Get user's diagnosis history
app.get('/diagnoses', authenticateToken, async (req, res) => {
  try {
    const diagnoses = await Diagnosis.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);

    const formattedDiagnoses = diagnoses.map(diagnosis => ({
      id: diagnosis._id,
      disease: diagnosis.llmAnalysis.diseaseType,
      cropsAffected: diagnosis.llmAnalysis.cropsAffected,
      affectedAreas: diagnosis.llmAnalysis.affectedAreas,
      symptoms: diagnosis.llmAnalysis.symptoms,
      recommendedAction: diagnosis.llmAnalysis.recommendedAction,
      plantImageUrl : diagnosis.plantImageUrl,    // Send back to frontend
      pictorialUrl : diagnosis.pictorialUrl,     // Send back to frontend
      confidenceScore: diagnosis.confidenceScore,
      createdAt: diagnosis.createdAt

    }));

    res.json(formattedDiagnoses);
  } catch (error) {
    console.error("Get diagnoses error:", error);
    res.status(500).json({ error: "Failed to fetch diagnoses" });
  }
});

app.get('/diagnoses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const diagnosis = await Diagnosis.findOne({
      _id: id,
      userId: req.user.id
    });
    if (!diagnosis) {
      return res.status(404).json({ error: 'Diagnosis not found' });
    }

    res.json({
      id: diagnosis._id,
      disease: diagnosis.llmAnalysis.diseaseType,
      cropsAffected: diagnosis.llmAnalysis.cropsAffected,
      affectedAreas: diagnosis.llmAnalysis.affectedAreas,
      symptoms: diagnosis.llmAnalysis.symptoms,
      recommendedAction: diagnosis.llmAnalysis.recommendedAction,
      plantImageUrl : diagnosis.plantImageUrl,    // Send back to frontend
      pictorialUrl : diagnosis.pictorialUrl,     // Send back to frontend
      confidenceScore: diagnosis.confidenceScore,
      createdAt: diagnosis.createdAt
    });
  } catch (error) {
    console.error('Get diagnosis error:', error);
    res.status(500).json({ error: 'Failed to retrieve diagnosis' });
  }
});

// Delete diagnosis
app.delete('/diagnoses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const diagnosis = await Diagnosis.findOneAndDelete({
      _id: id,
      userId: req.user.id
    });

    if (!diagnosis) {
      return res.status(404).json({ error: 'Diagnosis not found' });
    }
    res.json({ message: 'Diagnosis deleted successfully' });
  } catch (error) {
    console.error('Delete diagnosis error:', error);
    res.status(500).json({ error: 'Failed to delete diagnosis' });
  }
});

// REST endpoint to get chat sessions (alternative to WebSocket)
app.get('/chat/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await ChatSession.find({ 
      userId: req.user.id,
      isActive: true 
    })
    .sort({ lastActivity: -1 })
    .limit(20)
    .select('sessionId createdAt lastActivity messages');

    const sessionSummaries = sessions.map(session => ({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      messageCount: session.messages.length,
      lastMessage: session.messages.length > 0 ? 
        session.messages[session.messages.length - 1].content.substring(0, 100) + '...' : 
        'No messages'
    }));

    res.json(sessionSummaries);
  } catch (error) {
    console.error('Get chat sessions error:', error);
    res.status(500).json({ error: 'Failed to retrieve chat sessions' });
  }
});

// REST endpoint to get specific chat session
app.get('/chat/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const chatSession = await ChatSession.findOne({ 
      sessionId, 
      userId: req.user.id 
    });

    if (!chatSession) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    res.json({
      sessionId: chatSession.sessionId,
      messages: chatSession.messages,
      createdAt: chatSession.createdAt,
      lastActivity: chatSession.lastActivity
    });

  } catch (error) {
    console.error('Get chat session error:', error);
    res.status(500).json({ error: 'Failed to retrieve chat session' });
  }
});

const PORT = process.env.PORT || 4000;

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready for AI chat`);
  });
}

module.exports = { 
  app, 
  server, 
  io,
  // Also export models for direct testing if needed
  Diagnosis: require('mongoose').model('Diagnosis'), 
  ChatSession: require('mongoose').model('ChatSession')
};