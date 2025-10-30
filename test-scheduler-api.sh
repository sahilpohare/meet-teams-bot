#!/bin/bash

# Test Scheduler API - Sample curl commands

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🧪 Testing Scheduler API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Health Check
echo "1️⃣  Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$BASE_URL/health" | jq .
echo ""
echo ""

# Test 2: API Info
echo "2️⃣  API Info"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$BASE_URL/" | jq .
echo ""
echo ""

# Test 3: Create Meeting (Full config)
echo "3️⃣  Create Meeting with Full Config"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -X POST "$BASE_URL/api/scheduler/meetings" \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_url": "https://meet.google.com/fki-ygkd-kao",
    "bot_name": "Azure Test Bot",
    "email": "bot@skyfern.ai",
    "recording_mode": "speaker_view",
    "enter_message": "Recording bot has joined the meeting",
    "automatic_leave": {
      "waiting_room_timeout": 600,
      "noone_joined_timeout": 600
    },
    "storage_provider": "azure",
    "azure_storage": {
      "container_name": "recordings",
      "blob_path_template": "/skyfern/meetings/{meeting_id}"
    }
  }' | jq .

echo ""
echo ""

# Extract job ID from response (if you want to check status)
echo "4️⃣  To check job status, use:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "curl -s '$BASE_URL/api/scheduler/jobs/{jobId}' | jq ."
echo ""
