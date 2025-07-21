#!/bin/bash

echo "🎤 Testing Audio Device Configuration"
echo "===================================="

# Function to print colored output
print_info() {
    echo -e "\033[1;34mℹ️  $1\033[0m"
}

print_success() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

print_warning() {
    echo -e "\033[1;33m⚠️  $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

# Test 1: Default Configuration
print_info "Test 1: Default audio device configuration"
echo "Environment variables:"
echo "  VIRTUAL_MIC: ${VIRTUAL_MIC:-'pulse:virtual_mic (default)'}"
echo "  VIRTUAL_SPEAKER: ${VIRTUAL_SPEAKER:-'virtual_speaker (default)'}"
echo "  VIRTUAL_SPEAKER_MONITOR: ${VIRTUAL_SPEAKER_MONITOR:-'virtual_speaker.monitor (default)'}"
echo ""

# Test 2: Custom Configuration
print_info "Test 2: Custom audio device configuration"
export VIRTUAL_MIC="pulse:custom_test_mic"
export VIRTUAL_SPEAKER="custom_test_speaker"
export VIRTUAL_SPEAKER_MONITOR="custom_test_speaker.monitor"

echo "Custom environment variables:"
echo "  VIRTUAL_MIC: $VIRTUAL_MIC"
echo "  VIRTUAL_SPEAKER: $VIRTUAL_SPEAKER"
echo "  VIRTUAL_SPEAKER_MONITOR: $VIRTUAL_SPEAKER_MONITOR"
echo ""

# Test 3: Check if PulseAudio is available
print_info "Test 3: Checking PulseAudio availability"
if command -v pactl &> /dev/null; then
    print_success "PulseAudio is available"
    
    # List available sources
    echo "Available audio sources:"
    pactl list sources short | head -5
    
    # List available sinks
    echo "Available audio sinks:"
    pactl list sinks short | head -5
    
else
    print_warning "PulseAudio not found - audio device configuration may not work"
fi
echo ""

# Test 4: Check if virtual devices exist
print_info "Test 4: Checking for virtual audio devices"
if command -v pactl &> /dev/null; then
    if pactl list sources short | grep -q "virtual"; then
        print_success "Virtual audio sources found"
        pactl list sources short | grep "virtual"
    else
        print_warning "No virtual audio sources found"
    fi
    
    if pactl list sinks short | grep -q "virtual"; then
        print_success "Virtual audio sinks found"
        pactl list sinks short | grep "virtual"
    else
        print_warning "No virtual audio sinks found"
    fi
else
    print_warning "Cannot check virtual devices - PulseAudio not available"
fi
echo ""

# Test 5: Show Chrome flags that would be used
print_info "Test 5: Chrome flags for audio device configuration"
echo "When VIRTUAL_MIC is set, Chrome will use:"
echo "  --use-audio-device=$VIRTUAL_MIC"
echo ""
echo "When VIRTUAL_SPEAKER is set, Chrome will use:"
echo "  --use-audio-output-device=$VIRTUAL_SPEAKER"
echo ""
echo "Additional audio-related Chrome flags:"
echo "  --use-pulseaudio"
echo "  --use-fake-ui-for-media-stream"
echo "  --use-fake-device-for-media-stream"
echo "  --enable-audio-service-sandbox=false"
echo "  --audio-buffer-size=2048"
echo ""

# Test 6: Demonstrate usage with the bot
print_info "Test 6: Example usage with the meeting bot"
echo "To run the bot with custom audio devices:"
echo ""
echo "  # Method 1: Environment variables"
echo "  VIRTUAL_MIC='pulse:my_mic' VIRTUAL_SPEAKER='my_speaker' ./run_bot.sh run"
echo ""
echo "  # Method 2: Export variables"
echo "  export VIRTUAL_MIC='pulse:my_mic'"
echo "  export VIRTUAL_SPEAKER='my_speaker'"
echo "  ./run_bot.sh run"
echo ""
echo "  # Method 3: Docker with environment variables"
echo "  docker run -e VIRTUAL_MIC='pulse:my_mic' \\"
echo "             -e VIRTUAL_SPEAKER='my_speaker' \\"
echo "             your-bot-image"
echo ""

# Test 7: Show configuration in browser.ts
print_info "Test 7: Browser configuration code"
echo "The browser.ts file reads these environment variables:"
echo ""
echo "  const virtualMic = process.env.VIRTUAL_MIC || 'pulse:virtual_mic'"
echo "  const virtualSpeaker = process.env.VIRTUAL_SPEAKER || 'virtual_speaker'"
echo ""
echo "And adds Chrome flags conditionally:"
echo ""
echo "  ...(process.env.VIRTUAL_MIC ? [\`--use-audio-device=\${virtualMic}\`] : [])"
echo "  ...(process.env.VIRTUAL_SPEAKER ? [\`--use-audio-output-device=\${virtualSpeaker}\`] : [])"
echo ""

print_success "Audio device configuration test completed!"
echo ""
echo "📚 For more information, see: AUDIO_DEVICE_CONFIGURATION.md" 
