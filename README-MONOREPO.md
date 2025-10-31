# Meet Teams Bot - Turborepo Monorepo

This project has been migrated to a Turborepo monorepo structure for better organization and deployment.

## 📁 Project Structure

```
meet-teams-bot/
├── apps/
│   ├── bot/                    # Meeting bot application
│   │   ├── src/               # Bot source code
│   │   ├── Dockerfile
│   │   └── package.json
│   └── scheduler/             # Azure Functions scheduler
│       ├── src/
│       │   ├── functions/     # Azure Functions
│       │   └── scheduler/     # Scheduler logic
│       ├── scripts/
│       │   └── deploy.js      # Flex Consumption deployment
│       ├── host.json
│       └── package.json
├── packages/
│   └── shared/               # Shared utilities
└── turbo.json               # Turborepo config
```

## 🚀 Quick Start

### Install Dependencies
```bash
bun install
```

### Development

Run all apps in parallel:
```bash
bun run dev
```

Run specific app:
```bash
bun run dev:bot        # Meeting bot
bun run dev:scheduler  # Scheduler
```

### Build

Build all apps:
```bash
bun run build
```

Build specific app:
```bash
turbo run build --filter=@meet-teams-bot/scheduler
```

## 📦 Applications

### Bot (`apps/bot/`)
The meeting bot application that joins Google Meet and Microsoft Teams calls.

**Commands:**
```bash
cd apps/bot
bun run build    # Build
bun run dev      # Development mode
bun run start    # Run built version
```

### Scheduler (`apps/scheduler/`)
Azure Functions app for scheduling and managing bot instances.

**Commands:**
```bash
cd apps/scheduler
bun run build    # Build TypeScript
bun run dev      # Start local Azure Functions host
bun run deploy   # Deploy to Azure Flex Consumption
```

**Local Testing:**
```bash
cd apps/scheduler
bun run build
func host start
```

Functions available at: `http://localhost:7071`

## ☁️ Deployment

### Scheduler to Azure Flex Consumption

The scheduler includes a custom deployment script that solves Flex Consumption issues:

```bash
cd apps/scheduler
bun run deploy
```

Or from root:
```bash
bun run deploy:scheduler
```

**What the deployment script does:**
1. Builds TypeScript to JavaScript
2. Creates clean `dist-deploy/` with:
   - Compiled JavaScript (no TypeScript source)
   - Production dependencies only (no symlinks)
   - Configuration files
3. Deploys to Azure

**Environment Variables:**
Set these in Azure Function App settings:
- `AZURE_RESOURCE_GROUP` - Your resource group name
- `AZURE_JOB_NAME` - Container job name
- `AZURE_LOCATION` - Azure region
- `SCHEDULER_CONTAINER_IMAGE` - Bot container image
- `AzureWebJobsFeatureFlags` - Set to `EnableWorkerIndexing`

### Bot Deployment

```bash
cd apps/bot
docker build -t meet-teams-bot .
docker push <your-registry>/meet-teams-bot
```

## 🔧 Turborepo Commands

```bash
# Run command in all workspaces
turbo run <command>

# Run in specific workspace
turbo run <command> --filter=@meet-teams-bot/scheduler

# Run in parallel
turbo run dev --parallel

# Clean all builds
bun run clean
```

## 📝 Package Scripts

### Root (`/`)
- `bun run build` - Build all apps
- `bun run dev` - Run all apps in parallel
- `bun run dev:bot` - Run bot only
- `bun run dev:scheduler` - Run scheduler only
- `bun run clean` - Clean all builds
- `bun run deploy:scheduler` - Deploy scheduler to Azure

### Bot (`apps/bot/`)
- `bun run build` - Build bot
- `bun run dev` - Development mode
- `bun run start` - Run production build

### Scheduler (`apps/scheduler/`)
- `bun run build` - Build TypeScript
- `bun run dev` - Start local Functions host
- `bun run deploy` - Deploy to Azure
- `bun run clean` - Clean build output

## 🧪 Testing

```bash
# Test all apps
bun run test

# Test specific app
cd apps/bot && bun test
cd apps/scheduler && bun test
```

## 📚 Documentation

- [Monorepo Migration Guide](./MONOREPO-MIGRATION.md)
- [Original README](./README.md)
- [Scheduler Documentation](./SCHEDULER.md)
- [Turborepo Docs](https://turbo.build/docs)

## 🐛 Troubleshooting

### Azure Functions not detected

1. Check `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is set
2. Verify deployment script completed successfully
3. Check `dist-deploy/` contains compiled JavaScript
4. Review Azure Function App logs

### Local development issues

```bash
# Clean everything and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install
turbo run build
```

### Deployment fails

```bash
# Rebuild and try again
cd apps/scheduler
rm -rf dist dist-deploy
bun run build
bun run deploy
```

## 🎯 Benefits of Monorepo

- ✅ **Clean Separation**: Bot and Scheduler are independent
- ✅ **Shared Code**: Common utilities in `packages/shared`
- ✅ **Fast Builds**: Turborepo intelligent caching
- ✅ **Fixed Flex Consumption**: Clean deployment without symlinks
- ✅ **Better DX**: Run/test apps independently or together

## 📄 License

Apache-2.0 - see [LICENSE](./LICENSE)
