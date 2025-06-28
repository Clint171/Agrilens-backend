const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const axios = require('axios');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3002;
const ML_INFER_URL = process.env.ML_INFER_URL || 'http://ml-service:5000/infer';
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth:3001';

// In-memory storage for farmer profiles and diagnosis history
const farmers = new Map();
const diagnosisHistory = new Map();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Auth middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token is required' 
      });
    }

    // Verify token with auth service
    const response = await axios.post(`${AUTH_SERVICE_URL}/verify`, { token });
    
    if (response.data.success) {
      req.userId = response.data.data.userId;
      next();
    } else {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
  } catch (error) {
    console.error('Auth verification error:', error.message);
    res.status(401).json({ 
      success: false, 
      message: 'Token verification failed' 
    });
  }
};

// Validation schemas
const profileSchema = Joi.object({
  name: Joi.string().min(2).required(),
  farmLocation: Joi.string().required(),
  farmSize: Joi.number().positive().optional(),
  primaryCrops: Joi.array().items(Joi.string()).optional(),
  contactPhone: Joi.string().optional()
});

// Mock ML service call
const callMLService = async (imageBuffer, filename) => {
  try {
    // In a real implementation, you would send the image to your ML service
    // For now, we'll simulate a response
    console.log(`Simulating ML inference for image: ${filename}`);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock response - in reality this would come from your ML model
    const mockDiseases = [
      { name: 'Early Blight', confidence: 0.85, severity: 'moderate' },
      { name: 'Late Blight', confidence: 0.92, severity: 'severe' },
      { name: 'Leaf Spot', confidence: 0.78, severity: 'mild' },
      { name: 'Healthy', confidence: 0.95, severity: 'none' }
    ];
    
    const randomDisease = mockDiseases[Math.floor(Math.random() * mockDiseases.length)];
    
    return {
      success: true,
      prediction: {
        disease: randomDisease.name,
        confidence: randomDisease.confidence,
        severity: randomDisease.severity,
        plantType: 'tomato', // This would be detected by the model
      }
    };
  } catch (error) {
    console.error('ML service error:', error);
    throw new Error('ML inference failed');
  }
};

// Mock LLM service call for treatment recommendations
const generateTreatmentRecommendations = async (disease, plantType, severity) => {
  try {
    // In a real implementation, you would call OpenAI API or another LLM
    console.log(`Generating treatment for ${disease} on ${plantType} (${severity})`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock treatment recommendations based on disease
    const treatments = {
      'Early Blight': {
        immediate: [
          'Remove affected leaves immediately',
          'Apply copper-based fungicide spray',
          'Improve air circulation around plants'
        ],
        preventive: [
          'Water at soil level to avoid wetting leaves',
          'Apply mulch to prevent soil splash',
          'Rotate crops annually'
        ],
        organic: [
          'Use baking soda spray (1 tsp per quart water)',
          'Apply neem oil every 7-14 days',
          'Use compost tea as foliar spray'
        ]
      },
      'Late Blight': {
        immediate: [
          'Remove and destroy all affected plant material',
          'Apply systemic fungicide immediately',
          'Increase spacing between plants'
        ],
        preventive: [
          'Plant resistant varieties',
          'Avoid overhead watering',
          'Monitor weather conditions closely'
        ],
        organic: [
          'Apply copper sulfate spray',
          'Use milk spray (1:10 ratio with water)',
          'Implement strict crop rotation'
        ]
      },
      'Leaf Spot': {
        immediate: [
          'Prune affected leaves and branches',
          'Apply broad-spectrum fungicide',
          'Ensure proper plant spacing'
        ],
        preventive: [
          'Water early morning to allow drying',
          'Remove plant debris regularly',
          'Use drip irrigation system'
        ],
        organic: [
          'Apply chamomile tea spray',
          'Use horticultural oils',
          'Implement companion planting'
        ]
      },
      'Healthy': {
        maintenance: [
          'Continue current care practices',
          'Monitor regularly for early signs of disease',
          'Maintain consistent watering schedule'
        ],
        preventive: [
          'Apply balanced fertilizer monthly',
          'Prune for good air circulation',
          'Keep garden area clean of debris'
        ]
      }
    };
    
    const recommendation = treatments[disease] || treatments['Healthy'];
    
    return {
      disease,
      plantType,
      severity,
      recommendations: recommendation,
      additionalTips: [
        'Monitor plants daily for changes',
        'Take photos to track progress',
        'Consult local agricultural extension if symptoms persist'
      ],
      estimatedRecoveryTime: severity === 'severe' ? '2-3 weeks' : '1-2 weeks'
    };
    
  } catch (error) {
    console.error('LLM service error:', error);
    throw new Error('Failed to generate treatment recommendations');
  }
};

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'api-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mlServiceUrl: ML_INFER_URL
  });
});

// Get farmer profile
app.get('/profile', authenticateToken, (req, res) => {
  try {
    const farmer = farmers.get(req.userId);
    
    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: 'Farmer profile not found'
      });
    }
    
    res.json({
      success: true,
      data: farmer
    });
    
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile'
    });
  }
});

// Create/Update farmer profile
app.post('/profile', authenticateToken, (req, res) => {
  try {
    const { error, value } = profileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details
      });
    }
    
    const profile = {
      ...value,
      userId: req.userId,
      updatedAt: new Date().toISOString()
    };
    
    farmers.set(req.userId, profile);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: profile
    });
    
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Image upload and disease diagnosis
app.post('/diagnose', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required'
      });
    }
    
    const diagnosisId = uuidv4();
    
    // Call ML service for disease detection
    const mlResult = await callMLService(req.file.buffer, req.file.originalname);
    
    if (!mlResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Disease detection failed'
      });
    }
    
    const { disease, confidence, severity, plantType } = mlResult.prediction;
    
    // Generate treatment recommendations using LLM
    const treatment = await generateTreatmentRecommendations(disease, plantType, severity);
    
    // Store diagnosis in history
    const diagnosisRecord = {
      id: diagnosisId,
      userId: req.userId,
      timestamp: new Date().toISOString(),
      image: {
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      },
      prediction: {
        disease,
        confidence,
        severity,
        plantType
      },
      treatment,
      status: 'completed'
    };
    
    diagnosisHistory.set(diagnosisId, diagnosisRecord);
    
    res.json({
      success: true,
      message: 'Diagnosis completed successfully',
      data: {
        diagnosisId,
        prediction: {
          disease,
          confidence,
          severity,
          plantType
        },
        treatment
      }
    });
    
  } catch (error) {
    console.error('Diagnosis error:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnosis failed',
      error: error.message
    });
  }
});

// Get diagnosis history
app.get('/history', authenticateToken, (req, res) => {
  try {
    const userHistory = Array.from(diagnosisHistory.values())
      .filter(record => record.userId === req.userId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      success: true,
      data: {
        total: userHistory.length,
        diagnoses: userHistory
      }
    });
    
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve history'
    });
  }
});

// Get specific diagnosis
app.get('/diagnosis/:id', authenticateToken, (req, res) => {
  try {
    const diagnosis = diagnosisHistory.get(req.params.id);
    
    if (!diagnosis) {
      return res.status(404).json({
        success: false,
        message: 'Diagnosis not found'
      });
    }
    
    if (diagnosis.userId !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      data: diagnosis
    });
    
  } catch (error) {
    console.error('Get diagnosis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve diagnosis'
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'API endpoint not found' 
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('API service error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});

app.listen(PORT, () => {
  console.log(`📦 API service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`ML Service URL: ${ML_INFER_URL}`);
  console.log(`Auth Service URL: ${AUTH_SERVICE_URL}`);
});