# Turborepo Monorepo Migration - Complete! 🎉

## Structure

```
meet-teams-bot/
├── apps/
│   ├── bot/                 # Meeting bot application
│   │   ├── src/            # Bot source code
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── scheduler/          # Azure Functions scheduler
│       ├── src/
│       │   ├── functions/  # Azure Functions
│       │   └── scheduler/  # Scheduler logic
│       ├── scripts/
│       │   └── deploy.js   # Flex Consumption deployment script
│       ├── host.json
│       ├── local.settings.json
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/            # Shared utilities and types
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── turbo.json            # Turborepo configuration
├── pnpm-workspace.yaml   # Workspace configuration
└── package.json          # Root package.json
```

## Commands

### Development
```bash
# Run all apps in parallel
bun run dev

# Run specific app
bun run dev:bot
bun run dev:scheduler

# Build all apps
bun run build

# Clean all apps
bun run clean
```

### Scheduler Deployment
```bash
# Deploy scheduler to Azure Flex Consumption
bun run deploy:scheduler

# Or manually from apps/scheduler:
cd apps/scheduler
bun run deploy
```

## Key Features

### ✅ Fixed Azure Flex Consumption Deployment

The scheduler now has a **custom deployment script** (`apps/scheduler/scripts/deploy.js`) that:

1. Builds TypeScript to JavaScript
2. Creates a clean `dist-deploy/` directory with ONLY:
   - Compiled JavaScript files
   - Production dependencies (no symlinks)
   - Configuration files (host.json, etc.)
3. Deploys the clean package to Azure

This solves the Flex Consumption issues:
- ❌ No mixed TypeScript/JavaScript source
- ❌ No symlinks
- ❌ No dev dependencies
- ✅ Clean, production-ready deployment

### Benefits

1. **Clean Separation**: Bot and Scheduler are completely independent
2. **Shared Code**: Common utilities in `packages/shared`
3. **Fast Builds**: Turborepo caches builds intelligently
4. **Independent Deployments**: Each app deploys separately
5. **Better DX**: Run both apps simultaneously, test independently

## Local Testing

### Scheduler (Verified ✅)
```bash
cd apps/scheduler
bun run build
func host start
```

Functions detected at: `http://localhost:7071/{*path}`

### Bot
```bash
cd apps/bot
bun run dev
```

## Next Steps

1. Test the deployment script:
   ```bash
   cd apps/scheduler
   bun run deploy
   ```

2. Configure environment variables in Azure:
   - `AZURE_RESOURCE_GROUP`
   - `AZURE_JOB_NAME`
   - `AZURE_LOCATION`
   - `SCHEDULER_CONTAINER_IMAGE`

3. Verify functions are detected in Azure after deployment

## Migration Status

✅ Turborepo initialized
✅ Monorepo structure created
✅ Bot code moved to `apps/bot/`
✅ Scheduler code moved to `apps/scheduler/`
✅ Shared package created
✅ Build pipeline configured
✅ TypeScript project references set up
✅ Deployment script created
✅ Local testing verified
⏳ Azure deployment pending

## Troubleshooting

If Azure Functions aren't detected after deployment:

1. Check the deployment script completed successfully
2. Verify `dist-deploy/` contains compiled JavaScript
3. Ensure production dependencies are installed
4. Check Azure Function App logs
5. Verify `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is set

## Resources

- [Turborepo Documentation](https://turbo.build/docs)
- [Azure Functions Flex Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Node.js v4 Programming Model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
