# Meet Teams Bot

A Node.js TypeScript bot for automated meeting recording on **Google Meet** and **Microsoft Teams**. **This open source version focuses on serverless/containerized deployment**.

## 🚀 Quick Start with Docker

The easiest way to use Meet Teams Bot is through our simple runner script:

### Prerequisites
- Docker installed on your system
- A JSON configuration file with meeting parameters

### Usage

1. **Prepare your configuration** (`params.json`):
```json
{
    "meeting_url": "https://meet.google.com/your-meeting-url",
    "user_token": "your-jwt-token-here",
    "bots_api_key": "your-api-key-here", 
    "bot_name": "Recording Bot",
    "speech_to_text_provider": "Default",
    "bots_webhook_url": "https://your-webhook-url.com/webhook-endpoint",
    "bot_uuid": "unique-bot-identifier",
    "recording_mode": "SpeakerView",
    "mp4_s3_path": "recordings/output.mp4",
    "custom_branding_bot_path": "https://your-domain.com/path/to/branding-image.jpg",
    "automatic_leave": {
        "waiting_room_timeout": 60,
        "noone_joined_timeout": 60
    },
    "enter_message": "Recording bot has joined the meeting",
    "secret": "your-secret-key"
}
```

2. **Build and run the bot**:
```bash
# Build the Docker image
./run_bot.sh build

# Run with your configuration file
./run_bot.sh run params.json
```

**Alternative: One-liner with JSON**:
```bash
./run_bot.sh run-json '{"meeting_url": "https://meet.google.com/...", "bot_name": "My Bot", ...}'
```

The bot will automatically:
- Join the specified meeting
- Start recording in the configured mode
- Handle speaker detection and switching
- Upload the recording when finished
- Send webhook notifications

### Manual Docker Usage

If you prefer to use Docker directly:

```bash
# Build
docker build -t meet-teams-bot .

# Run
cat params.json | docker run -i meet-teams-bot
```

## ✨ Features

- **🎯 Serverless-First**: Designed for containerized, stateless deployments
- **🌐 Multi-Platform**: Google Meet and Microsoft Teams support
- **🎥 Smart Recording**: Speaker view with automatic speaker detection
- **💬 Real-time Transcription**: Speech-to-text conversion capabilities  
- **🎨 Custom Branding**: Support for custom bot names and branding
- **📡 Webhook Integration**: Real-time status updates and notifications
- **☁️ S3 Integration**: Automatic upload of recordings and artifacts (need adaptation on your side)
- **🔧 Configurable**: Extensive configuration options via JSON 

## 🏗️ Architecture

The bot uses a sophisticated state machine to manage the meeting lifecycle:

- **Initialization** → **Joining** → **Recording** → **Cleanup**
- **Error Recovery**: Automatic handling of common meeting issues
- **Browser Automation**: Playwright-based automation with Chrome extension
- **Media Processing**: FFmpeg integration for high-quality recordings

## 🌐 Supported Platforms

### Google Meet
- URL format: `https://meet.google.com/xxx-xxxx-xxx`
- Automatic joining without user interaction
- Automatic speaker detection
- Waiting room support

### Microsoft Teams
- URL format: `https://teams.microsoft.com/l/meetup-join/...`
- Support for classic Teams meetings and Teams Live
- Handles different Teams URL formats
- Automatic conversion of light-meetings URLs

## 📋 Configuration Reference

| Parameter | Description | Required |
|-----------|-------------|----------|
| `meeting_url` | Full URL of the meeting to join (Meet or Teams) | ✅ |
| `bot_name` | Display name for the bot in the meeting | ✅ |
| `recording_mode` | Recording format (`SpeakerView`, etc.) | ✅ |
| `bots_webhook_url` | URL for status notifications | ✅ |
| `speech_to_text_provider` | STT service (`Default`, etc.) | ❌ |
| `automatic_leave` | Auto-leave configuration | ❌ |
| `enter_message` | Message when bot joins | ❌ |

## 🔒 Security Considerations

- Store sensitive tokens and keys securely (environment variables, secret managers)
- Use HTTPS for all webhook URLs
- Ensure meeting URLs are authorized for bot access
- Review the [Security Policy](SECURITY.md) for detailed guidelines

## 🛠️ Local Development

While this open source version focuses on serverless deployment, you can also run it locally for development:

```bash
# Run in serverless mode locally
echo '{"meeting_url": "...", ...}' | SERVERLESS=true npm run start-serverless
```

> **Note**: The codebase also contains a non-serverless mode that requires Redis and RabbitMQ, but this is not the focus of this open source release.

## 📚 Documentation

- [Contributing Guidelines](CONTRIBUTING.md)
- [Security Policy](SECURITY.md) 
- [Changelog](CHANGELOG.md)
- [Technical Details](recording_server/README.md)

## 🤝 Contributing

Contributions are welcome! This project focuses on serverless/Docker deployments. Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## 📄 License

Licensed under the Apache License 2.0 - see the [LICENSE](recording_server/LICENSE) file for details.

## 🆘 Support

- 📖 Check the [documentation](recording_server/README.md)
- 🐛 Report issues on [GitHub Issues](https://github.com/yourusername/meet-teams-bot/issues)
- 💬 Join discussions on [GitHub Discussions](https://github.com/yourusername/meet-teams-bot/discussions)

---

**🎯 Focus**: This open source version is optimized for serverless/containerized deployments on **Google Meet** and **Microsoft Teams** only. For enterprise features or managed hosting, please contact the maintainers.
