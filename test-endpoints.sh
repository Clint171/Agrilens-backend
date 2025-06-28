#!/bin/bash

# Test script to verify all endpoints are working correctly
# Run this after starting the services with docker-compose up

BASE_URL="http://localhost"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Testing AgriLens Backend Services${NC}"
echo "========================================"

# Test Gateway Health
echo -e "\n${YELLOW}1. Testing Gateway Health${NC}"
curl -s "$BASE_URL/health" | jq . || echo -e "${RED}❌ Gateway health check failed${NC}"

# Test Auth Service Health
echo -e "\n${YELLOW}2. Testing Auth Service Health${NC}"
curl -s "$BASE_URL/auth/health" | jq . || echo -e "${RED}❌ Auth service health check failed${NC}"

# Test API Service Health
echo -e "\n${YELLOW}3. Testing API Service Health${NC}"
curl -s "$BASE_URL/api/health" | jq . || echo -e "${RED}❌ API service health check failed${NC}"

# Test User Registration
echo -e "\n${YELLOW}4. Testing User Registration${NC}"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@farmer.com",
    "password": "testpass123",
    "name": "Test Farmer",
    "farmLocation": "Nairobi, Kenya"
  }')

echo "$REGISTER_RESPONSE" | jq .

# Extract access token
ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.accessToken // empty')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo -e "${RED}❌ Registration failed or no access token received${NC}"
  
  # Try login instead
  echo -e "\n${YELLOW}4b. Trying Login (user might already exist)${NC}"
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@farmer.com",
      "password": "testpass123"
    }')
  
  echo "$LOGIN_RESPONSE" | jq .
  ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.accessToken // empty')
fi

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo -e "${RED}❌ Could not obtain access token. Skipping authenticated tests.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Access token obtained${NC}"

# Test Token Verification
echo -e "\n${YELLOW}5. Testing Token Verification${NC}"
curl -s -X POST "$BASE_URL/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$ACCESS_TOKEN\"}" | jq .

# Test Profile Creation
echo -e "\n${YELLOW}6. Testing Profile Creation${NC}"
curl -s -X POST "$BASE_URL/api/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Farmer",
    "farmLocation": "Nairobi, Kenya",
    "farmSize": 2.5,
    "primaryCrops": ["tomatoes", "maize", "beans"],
    "contactPhone": "+254700000000"
  }' | jq .

# Test Profile Retrieval
echo -e "\n${YELLOW}7. Testing Profile Retrieval${NC}"
curl -s -X GET "$BASE_URL/api/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Test Diagnosis History (should be empty initially)
echo -e "\n${YELLOW}8. Testing Diagnosis History${NC}"
curl -s -X GET "$BASE_URL/api/history" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Test Image Upload for Diagnosis (using a sample text file as placeholder)
echo -e "\n${YELLOW}9. Testing Image Diagnosis (Mock)${NC}"
# Create a small test image file
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > test_image.png

curl -s -X POST "$BASE_URL/api/diagnose" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "image=@test_image.png" | jq .

# Clean up
rm -f test_image.png

# Test Invalid Endpoints
echo -e "\n${YELLOW}10. Testing Invalid Endpoints${NC}"
curl -s "$BASE_URL/invalid-endpoint" | jq . 2>/dev/null || echo "Expected 404 response"

echo -e "\n${YELLOW}11. Testing Unauthorized Access${NC}"
curl -s -X GET "$BASE_URL/api/profile" | jq .

echo -e "\n${GREEN}🎉 Endpoint testing completed!${NC}"
echo -e "${YELLOW}💡 Check the responses above to verify everything is working correctly.${NC}"