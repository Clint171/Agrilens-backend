#!/bin/bash

# Array of required environment variables
required_vars=(
    "PORT"
    "MONGO_URL"
    "MODEL_URL"
    "CLIENT_URL"
    "SUPABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY"
    "GOOGLE_API_KEY"
)

# Array to store missing variables
missing_vars=()

# Check each required variable
for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        missing_vars+=("$var")
    fi
done

# If any variables are missing, display error and exit
if [[ ${#missing_vars[@]} -gt 0 ]]; then
    echo "❌ ERROR: Missing required environment variables:"
    echo
    
    for var in "${missing_vars[@]}"; do
        echo "  • $var"
    done
    
    echo
    echo "📝 To fix this, run your container with the missing environment variables:"
    echo
    echo "Example using docker run:"
    echo "  docker run \\"
    
    for var in "${missing_vars[@]}"; do
        echo "    -e $var=\"your_${var,,}_value\" \\"
    done
    
    echo "    your_image_name"
    echo
    echo "Example using docker-compose.yml:"
    echo "  services:"
    echo "    your_service:"
    echo "      image: your_image_name"
    echo "      environment:"
    
    for var in "${missing_vars[@]}"; do
        echo "        - $var=your_${var,,}_value"
    done
    
    echo
    echo "Example using .env file with docker-compose:"
    echo "  Create a .env file with:"
    
    for var in "${missing_vars[@]}"; do
        echo "    $var=your_${var,,}_value"
    done
    
    echo "  Then use: docker-compose --env-file .env up"
    echo
    
    exit 1
fi

# All environment variables are present
echo "✅ All required environment variables are set"
echo "🚀 Starting the application..."
echo

# Start the Node.js application
exec node main.js