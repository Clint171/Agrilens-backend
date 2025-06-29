#!/bin/bash

# Health check script for post-deployment verification
LOAD_BALANCER_URL="https://your-agrilens-domain.com"  # Replace with your actual domain
MAX_RETRIES=30
RETRY_INTERVAL=10

echo "Starting post-deployment health checks..."

# Function to check endpoint
check_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local retries=0
    
    echo "Checking $endpoint..."
    
    while [ $retries -lt $MAX_RETRIES ]; do
        response=$(curl -s -o /dev/null -w "%{http_code}" "$LOAD_BALANCER_URL$endpoint")
        
        if [ "$response" = "$expected_status" ]; then
            echo "✅ $endpoint is healthy (HTTP $response)"
            return 0
        else
            echo "⏳ $endpoint returned HTTP $response, retrying in ${RETRY_INTERVAL}s..."
            sleep $RETRY_INTERVAL
            retries=$((retries + 1))
        fi
    done
    
    echo "❌ $endpoint failed health check after $MAX_RETRIES attempts"
    return 1
}

# Check all endpoints
check_endpoint "/health" "200"
check_endpoint "/auth/health" "200"
check_endpoint "/api/health" "200"

echo "✅ All health checks passed!"