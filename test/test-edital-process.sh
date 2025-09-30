#!/bin/bash

# Test script for /api/edital-process endpoint

echo "🧪 Testing /api/edital-process endpoint..."

# Test request data
REQUEST_DATA='{
  "user_id": "98d8b11a-8a32-4f6b-9dae-6e42efa23116",
  "schedule_plan_id": "bca596cc-d484-4df1-8cf2-e9a5ca637eac",
  "url": "http://transcribe-ms-production-4cdd.up.railway.app/texts/bca596cc-d484-4df1-8cf2-e9a5ca637eac/bca596cc-d484-4df1-8cf2-e9a5ca637eac-1759269219576.txt"
}'

echo "📤 Sending request to /api/edital-process..."
echo "Request data: $REQUEST_DATA"

# Make the request
RESPONSE=$(curl -s -X POST http://localhost:3000/api/edital-process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-123" \
  -d "$REQUEST_DATA")

echo "📥 Response received:"
echo "$RESPONSE"

# Extract filePath from response
FILE_PATH=$(echo "$RESPONSE" | grep -o '"filePath":"[^"]*"' | cut -d'"' -f4)

if [ -n "$FILE_PATH" ]; then
  echo ""
  echo "✅ File path received: $FILE_PATH"
  echo "🌐 Full URL: http://localhost:3000$FILE_PATH"

  echo ""
  echo "⏳ Waiting 5 seconds for processing to start..."
  sleep 5

  echo "📄 Checking if file exists..."
  FILE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$FILE_PATH")
  echo "HTTP Status: $FILE_RESPONSE"

  if [ "$FILE_RESPONSE" = "200" ]; then
    echo "✅ File exists! Downloading content..."
    FILE_CONTENT=$(curl -s "http://localhost:3000$FILE_PATH")
    echo "📄 File content (first 500 chars):"
    echo "${FILE_CONTENT:0:500}..."
  else
    echo "❌ File not found or still processing (HTTP $FILE_RESPONSE)"
  fi
else
  echo "❌ No filePath found in response"
fi

echo ""
echo "🏁 Test completed!"