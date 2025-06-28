# AgriLens Backend

AgriLens is an AI-powered platform that helps farmers detect plant diseases from uploaded images and receive treatment recommendations. This repository contains the **backend services** that power the AgriLens system, structured into modular microservices that can be independently developed, tested, and deployed.

## 🧱 Architecture Overview

The backend consists of the following services:

```
                  ┌────────────┐
                  │  Frontend  │
                  └────┬───────┘
                       │
                       ▼
                  ┌────────────┐
                  │  NGINX     │  ← Gateway Server (Single exposed port)
                  │  Gateway   │
                  └────┬───────┘
         ┌────────────┴─────────────┬──────────────┐
         ▼                          ▼              ▼
  ┌────────────┐           ┌────────────┐   ┌────────────┐
  │  Auth      │           │   API      │   │   (ML Service) 
  │  Server    │           │  Server    │   │   External)   
  └────────────┘           └────────────┘   └────────────┘
```

### 🔌 Gateway Server (NGINX)
- Acts as the single entry point for all client traffic.
- Routes requests to internal services based on URL path:
  - `/auth/*` → Auth Server
  - `/api/*` → API Server

---

### 🔐 Auth Server
- Handles user authentication.
- Supports:
  - Farmer sign up and login
  - Access and refresh token generation (JWT-based)
- Verifies credentials and issues secure tokens for protected routes.

---

### 📦 API Server
- Handles business logic related to farmer activity and disease diagnosis.
- Responsibilities:
  - Manage farmer profiles (CRUD)
  - Handle image upload and validation
  - Send images to the **ML inference service** (external) to detect plant diseases
  - Based on the diagnosis, call a **Large Language Model (LLM)** (e.g., ChatGPT API or a self-hosted model) to generate tailored treatment recommendations
  - Return structured advice to the frontend for delivery to the farmer

---

## 🐳 Running the Backend with Docker Compose

This project uses Docker Compose to simplify development and deployment.

### 📁 Directory Structure

```
agrilens-backend/
├── api/            # API service
├── auth/           # Auth service
├── gateway/        # NGINX gateway configuration
├── docker-compose.yml
├── .env            # Environment variables (not committed)
└── README.md
```

### ▶️ Start All Services

```bash
docker-compose up --build
```

Services included:
- `nginx`: The API gateway (exposed on port 80)
- `auth`: Authentication microservice
- `api`: Application logic microservice

The ML service is **external** to this repository and is expected to expose a prediction endpoint.

---

## 🌐 API Gateway Routing

NGINX handles internal routing:

| Path Prefix | Service     |
|-------------|-------------|
| `/auth/*`   | Auth Server |
| `/api/*`    | API Server  |
| `/ml/*`     | (Optional proxy to ML endpoint, if internalized later) |

---

## 🛡️ Environment Variables

Each service has its own `.env` configuration (not included in repo). Sample variables:

### `.env` (for API server)
```env
ML_INFER_URL=http://ml-service:5000/infer
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
```

---

## 🚀 Future Improvements

- Add centralized logging and monitoring
- Add Swagger UI to `/api/docs`
- Introduce rate limiting and IP filtering at the gateway
- Integrate service discovery or move to orchestration (e.g., Kubernetes)

---