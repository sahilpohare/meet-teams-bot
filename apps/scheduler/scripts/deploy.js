#!/usr/bin/env node
/**
 * Azure Functions Flex Consumption Deployment Script
 *
 * This script creates a clean deployment package that works with Flex Consumption:
 * 1. Builds TypeScript to JavaScript
 * 2. Creates a clean dist-deploy directory with only production files
 * 3. Installs production dependencies (no symlinks)
 * 4. Deploys to Azure
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_NAME = process.env.AZURE_FUNCTION_APP_NAME || 'meeting-bot-scheduler';
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'meeting-bot-scheduler_group';

console.log('🚀 Starting Azure Functions Flex Consumption deployment...\n');

// Step 1: Clean previous builds
console.log('1️⃣  Cleaning previous builds...');
execSync('rm -rf dist dist-deploy', { stdio: 'inherit' });

// Step 2: Build TypeScript
console.log('\n2️⃣  Building TypeScript...');
execSync('npm run build', { stdio: 'inherit' });

// Step 3: Create deployment directory
console.log('\n3️⃣  Creating clean deployment package...');
execSync('mkdir -p dist-deploy', { stdio: 'inherit' });

// Copy compiled JavaScript files
execSync('cp -r dist/* dist-deploy/', { stdio: 'inherit' });

// Copy configuration files
execSync('cp host.json dist-deploy/', { stdio: 'inherit' });
execSync('cp local.settings.json dist-deploy/ 2>/dev/null || true', { stdio: 'inherit' });
execSync('cp .funcignore dist-deploy/ 2>/dev/null || true', { stdio: 'inherit' });

// Copy package.json with production dependencies only
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const deployPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  main: packageJson.main,
  dependencies: packageJson.dependencies
};
fs.writeFileSync('dist-deploy/package.json', JSON.stringify(deployPackageJson, null, 2));

// Step 4: Install production dependencies
console.log('\n4️⃣  Installing production dependencies (no symlinks)...');
process.chdir('dist-deploy');
execSync('npm install --production --no-package-lock', { stdio: 'inherit' });
process.chdir('..');

// Step 5: Deploy to Azure
console.log(`\n5️⃣  Deploying to Azure Function App: ${APP_NAME}...`);
try {
  process.chdir('dist-deploy');
  execSync(`func azure functionapp publish ${APP_NAME}`, { stdio: 'inherit' });
  process.chdir('..');

  console.log('\n✅ Deployment successful!');
  console.log(`\nFunction URL: https://${APP_NAME}.azurewebsites.net`);
} catch (error) {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
}
