# Meet Teams Bot - Recording Server

The core TypeScript application that handles automated meeting recording across Google Meet, Microsoft Teams, and Zoom platforms.

## Architecture

This application is built with:

- **TypeScript 5.4+** - Type-safe development
- **Playwright** - Browser automation and testing
- **Express.js** - Web server for API endpoints
- **Winston** - Structured logging
- **State Machine** - Manages bot lifecycle during meetings
- **Chrome Extension** - Enhanced browser integration
- **FFmpeg** - Media processing and transcoding

## Project Structure

```
src/
├── api/               # API endpoints and methods
├── browser/           # Browser automation and extension management
├── meeting/           # Meeting platform specific implementations
│   ├── meet.ts       # Google Meet integration
│   ├── teams.ts      # Microsoft Teams integration
│   └── zoom.ts       # Zoom integration
├── recording/         # Media recording and processing
├── state-machine/     # Bot state management
├── utils/             # Utility functions and helpers
├── main.ts           # Application entry point
└── types.ts          # TypeScript type definitions
```

## Key Features

### Multi-Platform Support
- **Google Meet**: Full browser automation with speaker detection
- **Microsoft Teams**: Complete meeting integration
- **Zoom**: Native SDK integration for Linux

### Recording Capabilities
- **Speaker View**: Records active speaker with automatic switching
- **Audio Transcription**: Real-time speech-to-text conversion
- **Custom Branding**: Overlay custom logos and bot names
- **Multiple Formats**: MP4 output with configurable quality

### State Management
The bot uses a sophisticated state machine with these states:
- `Initialization` - Setting up browser and environment
- `Joining` - Connecting to the meeting
- `InCall` - Active recording and monitoring
- `Paused` - Temporary recording suspension
- `Resuming` - Returning from pause
- `Cleanup` - Post-meeting cleanup and upload
- `Error` - Error handling and recovery

## Development Setup

### Prerequisites

- Node.js 14.16 or higher (recommended: 16.x)
- Chrome/Chromium browser
- FFmpeg installed on system
- Redis (for queue management)
- RabbitMQ (for message queuing)

### Installation

```bash
# Install dependencies
npm install

# Generate browser extension key
npm run generate_extension_key

# Build the application
npm run build
```

### Configuration

Create environment variables or modify the configuration:

```bash
# Development mode
export PROFILE=DEV
export ENVIRON=local

# Production settings
export SERVERLESS=true  # For containerized deployment
```

### Running

```bash
# Development with hot reload
npm run watch-dev

# Build and start
npm run build
npm start

# Serverless mode (reads from stdin)
npm run start-serverless
```

## Available Scripts

- `start` - Run the built application
- `start-serverless` - Run in serverless mode (reads JSON from stdin)
- `build` - Compile TypeScript to JavaScript
- `watch` - Watch mode for development
- `watch-dev` - Development mode with hot reload
- `format` - Format code with Prettier
- `test` - Run Jest tests
- `test:watch` - Run tests in watch mode
- `test:coverage` - Generate test coverage report
- `generate_extension_key` - Generate Chrome extension key

## API Endpoints

The server exposes several endpoints for monitoring and control:

- `GET /health` - Health check endpoint
- `POST /webhook` - Webhook receiver for external notifications
- `GET /status` - Current bot status and metrics
- `POST /control` - Bot control commands (pause, resume, stop)

## Chrome Extension

The recording server includes a Chrome extension for enhanced meeting integration:

```
chrome_extension/
├── manifest.json     # Extension manifest
├── src/
│   ├── background.ts # Background script
│   ├── content.ts    # Content script for page interaction
│   └── observeSpeakers/ # Speaker detection logic
```

## Media Processing

The application handles various media operations:

- **Screen Recording**: Captures meeting video using Playwright
- **Audio Processing**: Records and processes audio streams
- **Transcoding**: Converts recordings to MP4 format
- **Branding**: Overlays custom branding elements
- **Upload**: Automatic S3 upload of processed files

## State Machine Details

The bot's behavior is controlled by a state machine that ensures reliable operation:

```typescript
// State transitions
Initialization → Joining → InCall → Cleanup
                    ↓         ↓
                 Error ←→ Paused ↔ Resuming
```

Each state handles specific responsibilities and error conditions, ensuring the bot can recover from various failure scenarios.

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Logging

The application uses Winston for structured logging:

- Logs are written to both console and files
- Different log levels for development and production
- Automatic log rotation and S3 upload
- Bot-specific log files for troubleshooting

## Deployment

### Docker

The application is designed to run in Docker containers:

```bash
# Build image
docker build -t meet-teams-bot .

# Run with parameters
echo '{"meeting_url": "...", ...}' | docker run -i meet-teams-bot
```

### Environment Variables

Key environment variables:

- `SERVERLESS` - Enable serverless mode
- `PROFILE` - Development/production profile
- `ENVIRON` - Environment identifier
- `REDIS_URL` - Redis connection string
- `RABBITMQ_URL` - RabbitMQ connection string

## Troubleshooting

### Common Issues

1. **Chrome Extension Not Loading**
   - Ensure extension is built and key is generated
   - Check extension permissions in browser

2. **Meeting Join Failures**
   - Verify meeting URL format
   - Check authentication tokens
   - Review browser automation selectors

3. **Recording Issues**
   - Confirm FFmpeg installation
   - Check audio/video device permissions
   - Review media codec settings

### Debug Mode

Enable debug logging:

```bash
export DEBUG=true
export LOG_LEVEL=debug
npm run watch-dev
```

## Contributing

1. Follow TypeScript best practices
2. Add tests for new features
3. Update type definitions in `types.ts`
4. Use Prettier for code formatting
5. Write meaningful commit messages

## License

Licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
