# AgriLens Backend Setup Guide

This guide will help you set up and run the AgriLens backend services locally.

## 📋 Prerequisites

Make sure you have the following installed on your system:

- **Docker** (version 20.0 or higher)
- **Docker Compose** (version 2.0 or higher)
- **curl** (for testing endpoints)
- **jq** (optional, for JSON formatting in tests)

### Installing Prerequisites

#### On Ubuntu/Debian
```bash
# Install Docker
sudo apt update
sudo apt install docker.io docker-compose-plugin

# Install testing tools
sudo apt install curl jq

# Add your user to docker group (logout/login required)
sudo usermod -aG docker $USER
```

#### On macOS
```bash
# Install Docker Desktop from https://docs.docker.com/desktop/mac/install/
# Or use Homebrew
brew install --cask docker
brew install curl jq
```

#### On Windows
- Install Docker Desktop from https://docs.docker.com/desktop/windows/install/
- Use WSL2 for better performance
- Install curl and jq in WSL2

## 🚀 Quick Start

### 1. Clone and Navigate
```bash
git clone <your-repo-url>
cd agrilens-backend
```

### 2. Create Environment File
```bash
cp .env.example .env
```

Edit the `.env` file with your actual values:
```env
JWT_SECRET=your-super-secret-jwt-key-change-in-production
OPENAI_API_KEY=your-openai-api-key-here
```

### 3. Start Services
```bash
# Using Make (recommended)
make up

# Or using Docker Compose directly
docker-compose up -d --build
```

### 4. Verify Services
```bash
# Run automated tests
make test

# Or check manually
curl http://localhost/health
```

## 🏗️ Project Structure

```
agrilens-backend/
├── api/                    # API service
│   ├── server.js          # Main API server
│   ├── package.json       # Dependencies
│   └── Dockerfile         # API container config
├── auth/                  # Authentication service
│   ├── server.js          # Auth server
│   ├── package.json       # Dependencies
│   └── Dockerfile         # Auth container config
├── gateway/               # NGINX gateway
│   ├── nginx.conf         # NGINX configuration
│   └── Dockerfile         # Gateway container config
├── docker-compose.yml     # Service orchestration
├── Makefile              # Development commands
├── test-endpoints.sh     # Automated testing script
└── README.md             # Main documentation
```

## 🔧 Development Commands

### Using Make (Recommended)
```bash
make help      # Show available commands
make build     # Build all services
make up        # Start services
make down      # Stop services
make logs      # View service logs
make test      # Run endpoint tests
make restart   # Restart services
make clean     # Clean up everything
```

### Using Docker Compose Directly
```bash
# Start services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Restart a specific service
docker-compose restart api
```

## 🌐 API Endpoints

### Gateway (Port 80)
- `GET /health` - Gateway health check

### Authentication Service (`/auth/*`)
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/verify` - Token verification
- `POST /auth/refresh` - Refresh tokens
- `GET /auth/health` - Auth service health

### API Service (`/api/*`)
- `GET /api/health` - API service health
- `GET /api/profile` - Get farmer profile (auth required)
- `POST /api/profile` - Create/update profile (auth required)
- `POST /api/diagnose` - Upload image for diagnosis (auth required)
- `GET /api/history` - Get diagnosis history (auth required)
- `GET /api/diagnosis/:id` - Get specific diagnosis (auth required)

## 🧪 Testing

### Automated Testing
```bash
# Run all endpoint tests
make test

# Or run the script directly
chmod +x test-endpoints.sh
./test-endpoints.sh
```

### Manual Testing Examples

#### 1. Register a new user
```bash
curl -X POST http://localhost/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "farmer@example.com",
    "password": "securepass123",
    "name": "John Farmer",
    "farmLocation": "Nairobi, Kenya"
  }'
```

#### 2. Login
```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "farmer@example.com",
    "password": "securepass123"
  }'
```

#### 3. Create Profile (use token from login)
```bash
curl -X POST http://localhost/api/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Farmer",
    "farmLocation": "Nairobi, Kenya",
    "farmSize": 5.0,
    "primaryCrops": ["tomatoes", "maize"]
  }'
```

#### 4. Upload Image for Diagnosis
```bash
curl -X POST http://localhost/api/diagnose \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "image=@path/to/plant-image.jpg"
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Services won't start
```bash
# Check Docker daemon is running
sudo systemctl status docker

# Check port conflicts
sudo netstat -tulpn | grep :80

# View service logs
docker-compose logs
```

#### 2. Permission errors
```bash
# Fix Docker permissions
sudo usermod -aG docker $USER
# Logout and login again
```

#### 3. Gateway 502 errors
```bash
# Check if backend services are healthy
curl http://localhost/auth/health
curl http://localhost/api/health

# Restart services
make restart
```

#### 4. Database connection issues
```bash
# View service logs
docker-compose logs api
docker-compose logs auth

# Restart problematic service
docker-compose restart api
```

### Debugging Tips

1. **Check service logs**:
   ```bash
   docker-compose logs -f [service-name]
   ```

2. **Access service directly** (bypassing gateway):
   ```bash
   # Get service IP
   docker inspect agrilens-backend_api_1 | grep IPAddress
   
   # Test direct connection
   curl http://172.x.x.x:3002/health
   ```

3. **Inspect running containers**:
   ```bash
   docker-compose ps
   docker-compose exec api sh
   ```

## 📚 Next Steps

1. **Add a real database**: Replace in-memory storage with PostgreSQL
2. **Implement ML service**: Connect to actual plant disease detection model
3. **Add monitoring**: Integrate logging and metrics collection
4. **Security hardening**: Add rate limiting, CORS policies, etc.
5. **API documentation**: Generate OpenAPI/Swagger docs

## 🔐 Security Notes

- Change default JWT secret in production
- Use environment variables for sensitive data
- Implement proper CORS policies
- Add rate limiting for production
- Use HTTPS in production
- Regularly update dependencies

## 📞 Support

If you encounter issues:

1. Check the logs: `make logs`
2. Run health checks: `make health`
3. Review this documentation
4. Check Docker and system requirements