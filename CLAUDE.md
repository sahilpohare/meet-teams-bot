# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Architecture

This is an automated meeting bot that joins Google Meet and Microsoft Teams calls to record, transcribe, and manage video meetings. The system is containerized and uses Playwright for browser automation.

**Key Components:**
- **State Machine**: Central orchestration in `src/state-machine/` managing bot lifecycle through states (initialization, waiting-room, in-call, recording, cleanup, etc.)
- **Meeting Providers**: Platform-specific implementations in `src/meeting/` for Google Meet (`meet.ts`) and Microsoft Teams (`teams.ts`)
- **Recording System**: Screen capture via `src/recording/ScreenRecorder.ts` using FFmpeg
- **Browser Automation**: Playwright-based browser control in `src/browser/`
- **API Server**: Express server in `src/server.ts` for external control and webhook integration

## Common Development Commands

### Building and Running
```bash
# Build TypeScript
npm run build

# Start compiled application
npm start

# Watch mode for development
npm run watch-dev

# Build and run via Docker
./run_bot.sh build
./run_bot.sh run bot.config.json
```

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Test specific URL parsers
npm test -- --testNamePattern="meetUrlParser|teamsUrlParser"
```

### Development Tools
```bash
# Format code
npm run format

# Check for dead code/unused exports
npm run check:dead-code

# Individual dead code checks
npm run check:unused-exports
npm run check:unused-imports  
npm run check:unused-deps
```

### Docker Operations
```bash
# Build Docker image
./run_bot.sh build

# Run with config file
./run_bot.sh run bot.config.json

# Run with URL override
./run_bot.sh run bot.config.json "https://meet.google.com/abc-defg-hij"

# Debug mode (enables VNC on port 5900 + verbose logging)
./run_bot.sh debug bot.config.json

# Test recording system
./run_bot.sh test 60  # test for 60 seconds

# Clean recordings
./run_bot.sh clean
```

## Configuration

The bot uses JSON configuration files (default: `bot.config.json`). Key parameters:
- `meeting_url`: Target meeting URL
- `bot_name`: Display name for the bot
- `recording_mode`: "speaker_view" (default)
- `automatic_leave`: Timeout settings for waiting room and empty meetings
- `custom_branding_bot_path`: URL for bot avatar image

## State Machine Flow

The bot progresses through these states:
1. **Initialization** → **WaitingRoom** → **InCall** → **Recording** → **Cleanup** → **Terminated**

Error states and pause/resume functionality are also supported. Each state is implemented in `src/state-machine/states/`.

## Meeting Provider Integration

When adding support for new meeting platforms:
1. Implement `MeetingProviderInterface` in `src/types.ts`
2. Add detection logic in `src/utils/detectMeetingProvider.ts`
3. Create platform-specific implementation in `src/meeting/`
4. Add URL parser in `src/urlParser/`

## Environment Variables

- `RECORDING=true|false`: Enable/disable video recording
- `DEBUG=true`: Enable VNC access on port 5900
- `DEBUG_LOGS=true`: Enable verbose speaker detection logging
- `PROFILE=DEV`: Development mode with ts-node-dev

## Recording System

The ScreenRecorder uses FFmpeg to capture video/audio streams. Recordings are saved to `./recordings/` with the bot UUID as subdirectory. The system supports efficient sync and merge operations for optimal file sizes.

## Linting and Type Checking

Use TypeScript compiler for type checking:
```bash
npx tsc --noEmit
```

No specific linter is configured - the project relies on TypeScript and Prettier for code quality.