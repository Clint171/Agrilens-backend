# AgriLens API Documentation

## Overview

The AgriLens API is a comprehensive plant disease detection system that allows users to upload images of plants and receive AI-powered disease diagnosis. The API supports user authentication, image analysis, and diagnosis history management.

**Base URL:** `http://localhost:4000` (Development) | `http://100.24.44.71` (Production)

**API Version:** 1.0.0

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Rate Limits

- Health check: No rate limit
- Authentication endpoints: 10 requests per minute
- Diagnosis endpoints: 5 requests per minute per user

## Error Handling

All errors return JSON responses with an `error` field:

```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `500` - Internal Server Error

---

## Endpoints

### Health Check

Check if the API server is running and healthy.

**GET** `/health`

#### Response

```json
{
  "status": "OK"
}
```

#### Example

```bash
curl -X GET http://localhost:4000/health
```

---

### User Registration (Local)

Register a new user with email and password.

**POST** `/signup`

#### Request Body

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "password": "securePassword123"
}
```

#### Response (201)

```json
{
  "message": "User created successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "john.doe@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "authProvider": "local"
  }
}
```

#### Error Response (400)

```json
{
  "error": "All fields are required"
}
```

#### Example

```bash
curl -X POST http://localhost:4000/signup \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "password": "securePassword123"
  }'
```

---

### User Registration (Google)

Register a new user using Google OAuth token.

**POST** `/signup/google`

#### Request Body

```json
{
  "googleToken": "your_google_jwt_token_here"
}
```

#### Response (201)

```json
{
  "message": "User created successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "john.doe@gmail.com",
    "firstName": "John",
    "lastName": "Doe",
    "authProvider": "google"
  }
}
```

#### Error Response (500)

```json
{
  "error": "Invalid Google token"
}
```

---

### User Login (Local)

Authenticate user with email and password.

**POST** `/login`

#### Request Body

```json
{
  "email": "john.doe@example.com",
  "password": "securePassword123"
}
```

#### Response (200)

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "john.doe@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "authProvider": "local"
  }
}
```

#### Error Response (400)

```json
{
  "error": "Invalid credentials"
}
```

#### Example

```bash
curl -X POST http://localhost:4000/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "securePassword123"
  }'
```

---

### User Login (Google)

Authenticate user using Google OAuth token.

**POST** `/login/google`

#### Request Body

```json
{
  "googleToken": "your_google_jwt_token_here"
}
```

#### Response (200)

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "john.doe@gmail.com",
    "firstName": "John",
    "lastName": "Doe",
    "authProvider": "google"
  }
}
```

#### Error Response (400)

```json
{
  "error": "User not found or invalid token"
}
```

---

### Diagnose Plant Disease

Upload plant images to get AI-powered disease diagnosis.

**POST** `/diagnose`

**Authentication Required:** Yes

#### Request Body (multipart/form-data)

- `images` (file): Plant image file (JPG, PNG, etc.)

#### Response (200)

```json
{
  "id": "diag_123",
  "disease": "Tomato Late Blight",
  "cropsAffected": ["Tomato", "Potato", "Pepper"],
  "affectedAreas": ["Leaves", "Stems", "Fruits"],
  "symptoms": [
    "Dark spots on leaves",
    "Yellowing of foliage",
    "Wilting of plant parts"
  ],
  "recommendedAction": "Apply fungicide spray and improve air circulation. Remove affected plant parts.",
  "confidenceScore": 0.85,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

#### Error Responses

**400 - No Image Uploaded**
```json
{
  "error": "No image uploaded"
}
```

**401 - Unauthorized**
```json
{
  "error": "Access token required"
}
```

**403 - Forbidden**
```json
{
  "error": "Invalid or expired token"
}
```

#### Example

```bash
curl -X POST http://localhost:4000/diagnose \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "images=@/path/to/plant_image.jpg"
```

---

### Get User Diagnosis History

Retrieve all diagnosis history for the authenticated user, sorted by date (newest first).

**GET** `/diagnoses`

**Authentication Required:** Yes

#### Response (200)

```json
[
  {
    "id": "diag_123",
    "disease": "Tomato Late Blight",
    "cropsAffected": ["Tomato", "Potato", "Pepper"],
    "affectedAreas": ["Leaves", "Stems", "Fruits"],
    "symptoms": [
      "Dark spots on leaves",
      "Yellowing of foliage",
      "Wilting of plant parts"
    ],
    "recommendedAction": "Apply fungicide spray and improve air circulation.",
    "confidenceScore": 0.85,
    "createdAt": "2024-01-15T10:30:00Z"
  },
  {
    "id": "diag_124",
    "disease": "Powdery Mildew",
    "cropsAffected": ["Cucumber", "Zucchini", "Squash"],
    "affectedAreas": ["Leaves"],
    "symptoms": [
      "White powdery coating on leaves",
      "Stunted growth"
    ],
    "recommendedAction": "Apply sulfur-based fungicide and ensure good air circulation.",
    "confidenceScore": 0.92,
    "createdAt": "2024-01-14T08:15:00Z"
  }
]
```

#### Error Responses

**401 - Unauthorized**
```json
{
  "error": "Access token required"
}
```

**403 - Forbidden**
```json
{
  "error": "Invalid or expired token"
}
```

#### Example

```bash
curl -X GET http://localhost:4000/diagnoses \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Data Models

### User Object

```json
{
  "id": "string",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "authProvider": "local | google"
}
```

### Diagnosis Object

```json
{
  "id": "string",
  "disease": "string",
  "cropsAffected": ["string"],
  "affectedAreas": ["string"],
  "symptoms": ["string"],
  "recommendedAction": "string",
  "confidenceScore": "number (0-1)",
  "createdAt": "string (ISO 8601)"
}
```

### Authentication Response

```json
{
  "message": "string",
  "token": "string",
  "user": "User Object"
}
```

---

## SDK Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

class AgriLensAPI {
  constructor(baseURL = 'http://localhost:4000') {
    this.baseURL = baseURL;
    this.token = null;
  }

  async login(email, password) {
    const response = await axios.post(`${this.baseURL}/login`, {
      email,
      password
    });
    this.token = response.data.token;
    return response.data;
  }

  async diagnose(imageFile) {
    const formData = new FormData();
    formData.append('images', imageFile);

    const response = await axios.post(`${this.baseURL}/diagnose`, formData, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  }

  async getHistory() {
    const response = await axios.get(`${this.baseURL}/diagnoses`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    return response.data;
  }
}

// Usage
const api = new AgriLensAPI();
await api.login('john.doe@example.com', 'password123');
const diagnosis = await api.diagnose(imageFile);
const history = await api.getHistory();
```

### Python

```python
import requests

class AgriLensAPI:
    def __init__(self, base_url="http://localhost:4000"):
        self.base_url = base_url
        self.token = None
    
    def login(self, email, password):
        response = requests.post(f"{self.base_url}/login", json={
            "email": email,
            "password": password
        })
        data = response.json()
        self.token = data["token"]
        return data
    
    def diagnose(self, image_path):
        with open(image_path, 'rb') as f:
            files = {'images': f}
            headers = {'Authorization': f'Bearer {self.token}'}
            response = requests.post(f"{self.base_url}/diagnose", 
                                   files=files, headers=headers)
        return response.json()
    
    def get_history(self):
        headers = {'Authorization': f'Bearer {self.token}'}
        response = requests.get(f"{self.base_url}/diagnoses", headers=headers)
        return response.json()

# Usage
api = AgriLensAPI()
api.login('john.doe@example.com', 'password123')
diagnosis = api.diagnose('/path/to/plant_image.jpg')
history = api.get_history()
```

---

## Testing

The API includes comprehensive test cases for all endpoints. You can run tests using the provided Postman collection or implement your own test suite.

*Postman Collection:* `https://.postman.co/workspace/My-Workspace~32b6c25f-2255-47b4-8f38-6da04b4423df/collection/29383370-37152d5b-0374-4f3a-8833-102c4592e0ce?action=share&creator=29383370&active-environment=29383370-7b09a741-53f7-40e8-81f2-73efa7144985`

### Key Test Scenarios

1. **Authentication Flow**
   - User registration with valid data
   - User registration with missing fields
   - User login with valid credentials
   - User login with invalid credentials
   - Google OAuth integration

2. **Authorization**
   - Accessing protected endpoints without token
   - Accessing protected endpoints with invalid token
   - Accessing protected endpoints with valid token

3. **Diagnosis**
   - Uploading valid plant images
   - Attempting diagnosis without image
   - Retrieving diagnosis history

### Response Time Expectations

- Health check: < 200ms
- Authentication: < 1000ms
- Diagnosis: < 5000ms (depends on image size and AI processing)
- History retrieval: < 500ms

---
