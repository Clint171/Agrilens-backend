const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
//const fs = require('fs');
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

dotenv.config();

const app = express();
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
    const prompt = `Analyze the plant in the uploaded image(s) to identify any diseases or health issues.

    Please provide a detailed analysis in the following JSON format:
    {
      "diseaseType": "specific disease name or 'Healthy' if no disease detected",
      "cropsAffected": ["crop type(s) identified"],
      "affectedAreas": ["specific plant parts affected"],
      "symptoms": ["visible symptoms observed"],
      "recommendedAction": "detailed recommended treatment or prevention measures"
    }
    
    Only return the JSON response, no additional text or formatting.`;

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

    return JSON.parse(response.data.choices[0].message.content.replace(/`/g, ''));
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
    const modelResponse = await axios.post(`${process.env.MODEL_URL}`, payload);
    const { disease, accuracy } = modelResponse.data;

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});