const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Google OAuth2 client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// MongoDB connection
mongoose.connect(process.env.MONGO_URL, {
  dbName: "agrilens"
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Optional for Google users
  googleId: { type: String }, // For Google OAuth users
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Diagnosis Schema
const diagnosisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
  confidenceScore: Number,
  createdAt: { type: Date, default: Date.now }
});

const Diagnosis = mongoose.model('Diagnosis', diagnosisSchema);

// Chat Session Schema
const chatSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Socket.IO JWT middleware
const authenticateSocketToken = (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Access token required'));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return next(new Error('Invalid or expired token'));
    }
    socket.user = user;
    next();
  });
};

// Helper function to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user._id, 
      email: user.email,
      authProvider: user.authProvider 
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Helper function to verify Google token
const verifyGoogleToken = async (token) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    return ticket.getPayload();
  } catch (error) {
    throw new Error('Invalid Google token');
  }
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
const getAIChatResponse = async (messages, userContext) => {
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
- Provide practical, actionable advice for Kenyan farmers
- Be concise but thorough
- If asked about diseases not in their history, provide general agricultural guidance
- Always encourage consulting local agricultural extension services for complex issues`;

    const chatMessages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...messages
    ];

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: chatMessages,
      max_tokens: 800,
      temperature: 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('AI chat response error:', error);
    return "I apologize, but I'm having trouble processing your request right now. Please try again later or consult with a local agricultural expert.";
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
        content: msg.content
      }));

      // Get AI response
      const aiResponse = await getAIChatResponse(messagesForAI, userContext);

      // Add AI response to session
      chatSession.messages.push({
        role: 'assistant',
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

// POST /signup - Regular signup
app.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      authProvider: 'local'
    });

    await user.save();

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        authProvider: user.authProvider
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /signup/google - Google signup
app.post('/signup/google', async (req, res) => {
  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      return res.status(400).json({ error: 'Google token required' });
    }

    // Verify Google token
    const googleUser = await verifyGoogleToken(googleToken);
    
    // Check if user already exists
    const existingUser = await User.findOne({ email: googleUser.email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Create user
    const user = new User({
      firstName: googleUser.given_name,
      lastName: googleUser.family_name,
      email: googleUser.email,
      googleId: googleUser.sub,
      authProvider: 'google'
    });

    await user.save();

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        authProvider: user.authProvider
      }
    });

  } catch (error) {
    console.error('Google signup error:', error);
    res.status(500).json({ error: 'Invalid Google token or internal server error' });
  }
});

// POST /login - Regular login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check if user signed up with Google
    if (user.authProvider === 'google') {
      return res.status(400).json({ error: 'Please login with Google' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        authProvider: user.authProvider
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: `Internal server error:\n${error}` });
  }
});

// POST /login/google - Google login
app.post('/login/google', async (req, res) => {
  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      return res.status(400).json({ error: 'Google token required' });
    }

    // Verify Google token
    const googleUser = await verifyGoogleToken(googleToken);
    
    // Find user
    const user = await User.findOne({ email: googleUser.email });
    if (!user) {
      return res.status(400).json({ error: 'User not found. Please signup first.' });
    }

    // Check if user signed up with local auth
    if (user.authProvider === 'local') {
      return res.status(400).json({ error: 'Please login with email and password' });
    }

    // Generate token
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        authProvider: user.authProvider
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ error: 'Invalid Google token or internal server error' });
  }
});

// Function to get LLM analysis
const getLLMAnalysis = async (disease, accuracy) => {
  try {
    const prompt = `Analyze this plant disease diagnosis:
    Disease: ${disease}
    Confidence: ${accuracy}
    
    Please provide a detailed analysis in the following JSON format:
    {
      "diseaseType": "specific disease name",
      "cropsAffected": ["crop1", "crop2"],
      "affectedAreas": ["area1", "area2"],
      "symptoms": ["symptom1", "symptom2"],
      "recommendedAction": "detailed recommended action"
    }
    
    Only return the JSON response, no additional text.`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an expert agricultural pathologist. Provide accurate information about plant diseases in JSON format only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return JSON.parse(response.data.choices[0].message.content);
  } catch (error) {
    console.error('LLM analysis error:', error);
    // Return default analysis if LLM fails
    return {
      diseaseType: disease,
      cropsAffected: ['Unknown'],
      affectedAreas: ['Unknown'],
      symptoms: ['Please consult agricultural expert'],
      recommendedAction: 'Please consult with a local agricultural extension officer for proper diagnosis and treatment recommendations.'
    };
  }
};

// Bypass model, for test
const getLLMAnalysisBypass = async (base64Images) => {
  try {
    const prompt = `Analyze the plant in the uploaded image to identify any diseases or health issues.

    Please provide a detailed analysis in the following JSON format:
    {
      "diseaseType": "specific disease name or 'Healthy' if no disease detected",
      "cropsAffected": ["crop type(s) identified"],
      "affectedAreas": ["specific plant parts affected"],
      "symptoms": ["visible symptoms observed"],
      "recommendedAction": "detailed recommended treatment or prevention measures"
    }
    
    Only return a valid JSON response, no additional text.`;

    // Prepare messages with image(s)
    const messages = [
      {
        role: 'system',
        content: 'You are an expert agricultural pathologist. Analyze plant images to identify diseases and provide accurate information in JSON format only.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ];

    // Add images to the user message
    const imageArray = Array.isArray(base64Images) ? base64Images : [base64Images];
    imageArray.forEach(base64Image => {
      messages[1].content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Image}`,
          detail: 'high'
        }
      });
    });

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o', // Using GPT-4 Vision model for image analysis
      messages: messages,
      max_tokens: 500,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return JSON.parse(response.data.choices[0].message.content.replace(/`/g, '').replace(/json/, ''));
  } catch (error) {
    console.error('LLM analysis error:', error);
    // Return default analysis if LLM fails
    return {
      diseaseType: 'Analysis unavailable',
      cropsAffected: ['Unable to identify'],
      affectedAreas: ['Unable to determine'],
      symptoms: ['Please consult agricultural expert'],
      recommendedAction: 'Please consult with a local agricultural extension officer for proper diagnosis and treatment recommendations.'
    };
  }
};

// POST /diagnose - Enhanced with authentication and LLM analysis
app.post('/diagnose', authenticateToken, upload.array('images'), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const base64Images = files.map(file => file.buffer.toString('base64'));
    const payload = {
      type: base64Images.length > 1 ? "multiple" : "single",
      data: base64Images.length > 1 ? base64Images : base64Images[0]
    };

    // Get prediction from model
    // const modelResponse = await axios.post(`${process.env.MODEL_URL}`, payload);
    const { disease, accuracy } = { disease: 'Unknown', accuracy: 0 };

    // Get LLM analysis
    // const llmAnalysis = await getLLMAnalysis(disease, accuracy);

    // Bypass
    const llmAnalysis = await getLLMAnalysisBypass(base64Images);

    // Save to database
    const diagnosis = new Diagnosis({
      userId: req.user.id,
      originalPrediction: {
        disease,
        accuracy
      },
      llmAnalysis,
      confidenceScore: parseFloat(accuracy)
    });

    await diagnosis.save();

    // Return response
    res.json({
      id: diagnosis._id,
      disease: llmAnalysis.diseaseType,
      cropsAffected: llmAnalysis.cropsAffected,
      affectedAreas: llmAnalysis.affectedAreas,
      symptoms: llmAnalysis.symptoms,
      recommendedAction: llmAnalysis.recommendedAction,
      confidenceScore: parseFloat(accuracy),
      createdAt: diagnosis.createdAt
    });

  } catch (error) {
    console.error("Diagnosis error:", error.message);
    return res.status(500).json({ error: "Failed to diagnose image" });
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
      confidenceScore: diagnosis.confidenceScore,
      createdAt: diagnosis.createdAt
    }));

    res.json(formattedDiagnoses);
  } catch (error) {
    console.error("Get diagnoses error:", error);
    res.status(500).json({ error: "Failed to fetch diagnoses" });
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
  User: require('mongoose').model('User'),
  Diagnosis: require('mongoose').model('Diagnosis'), 
  ChatSession: require('mongoose').model('ChatSession')
};