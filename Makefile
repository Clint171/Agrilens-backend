# AgriLens Backend Makefile

.PHONY: help build up down logs test clean restart status

# Default target
help:
	@echo "AgriLens Backend - Available Commands:"
	@echo "======================================"
	@echo "  make build     - Build all Docker images"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make restart   - Restart all services"
	@echo "  make logs      - Show logs from all services"
	@echo "  make test      - Run endpoint tests"
	@echo "  make status    - Show service status"
	@echo "  make clean     - Stop services and remove volumes"
	@echo "  make dev       - Start in development mode with logs"

# Build all services
build:
	@echo "🏗️  Building AgriLens services..."
	docker-compose build

# Start all services
up:
	@echo "🚀 Starting AgriLens services..."
	docker-compose up -d
	@echo "✅ Services started! Gateway available at http://localhost"
	@echo "💡 Run 'make test' to verify endpoints"

# Start in development mode with logs
dev:
	@echo "🔧 Starting AgriLens in development mode..."
	docker-compose up --build

# Stop all services
down:
	@echo "🛑 Stopping AgriLens services..."
	docker-compose down

# Restart all services
restart:
	@echo "🔄 Restarting AgriLens services..."
	docker-compose restart
	@echo "✅ Services restarted!"

# Show logs
logs:
	@echo "📋 Showing service logs..."
	docker-compose logs -f

# Show service status
status:
	@echo "📊 Service Status:"
	@echo "=================="
	docker-compose ps

# Run endpoint tests
test:
	@echo "🧪 Running endpoint tests..."
	@chmod +x test-endpoints.sh
	@./test-endpoints.sh

# Clean up everything
clean:
	@echo "🧹 Cleaning up AgriLens environment..."
	docker-compose down -v
	docker system prune -f
	@echo "✅ Cleanup completed!"

# Quick health check
health:
	@echo "🏥 Health Check:"
	@echo "==============="
	@curl -s http://localhost/health | jq . 2>/dev/null || echo "❌ Gateway not responding"
	@curl -s http://localhost/auth/health | jq . 2>/dev/null || echo "❌ Auth service not responding"
	@curl -s http://localhost/api/health | jq . 2>/dev/null || echo "❌ API service not responding"


# Production deployment commands

prod-deploy:
	@echo "Triggering production deployment..."
	git push origin main

prod-logs:
	@echo "Fetching production logs..."
	aws logs tail /aws/ecs/agrilens-gateway --follow &
	aws logs tail /aws/ecs/agrilens-api --follow &
	aws logs tail /aws/ecs/agrilens-auth --follow &
	wait

prod-health:
	@echo "Checking production health..."
	chmod +x scripts/health-check.sh
	./scripts/health-check.sh

prod-rollback:
	@echo "Rolling back to previous version..."
	aws ecs update-service --cluster agrilens-prod --service agrilens-gateway-service --force-new-deployment
	aws ecs update-service --cluster agrilens-prod --service agrilens-api-service --force-new-deployment
	aws ecs update-service --cluster agrilens-prod --service agrilens-auth-service --force-new-deployment

prod-scale:
	@echo "Scaling production services..."
	aws ecs update-service --cluster agrilens-prod --service agrilens-gateway-service --desired-count 2
	aws ecs update-service --cluster agrilens-prod --service agrilens-api-service --desired-count 3
	aws ecs update-service --cluster agrilens-prod --service agrilens-auth-service --desired-count 2

# Local commands for production testing
prod-build:
	docker-compose -f docker-compose.prod.yml build

prod-test-local:
	docker-compose -f docker-compose.prod.yml up -d
	sleep 30
	./test-endpoints.sh
	docker-compose -f docker-compose.prod.yml down