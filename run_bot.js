#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

/**
 * Constants and Utilities
 */
const COLORS = {
  RED: '\x1b[0;31m',
  GREEN: '\x1b[0;32m',
  YELLOW: '\x1b[1;33m',
  BLUE: '\x1b[0;34m',
  NC: '\x1b[0m'
};

const ICONS = {
  INFO: 'ℹ️',
  SUCCESS: '✅',
  WARNING: '⚠️',
  ERROR: '❌',
  FILE: '📁',
  BOT: '🤖',
  DISPLAY: '🖥️'
};

const print = {
  info: (msg) => console.error(`${COLORS.BLUE}${ICONS.INFO}  ${msg}${COLORS.NC}`),
  success: (msg) => console.error(`${COLORS.GREEN}${ICONS.SUCCESS} ${msg}${COLORS.NC}`),
  warning: (msg) => console.error(`${COLORS.YELLOW}${ICONS.WARNING}  ${msg}${COLORS.NC}`),
  error: (msg) => console.error(`${COLORS.RED}${ICONS.ERROR} ${msg}${COLORS.NC}`)
};

/**
 * Core Utility Functions
 */
function generateUuid() {
  return crypto.randomUUID().toUpperCase();
}

function getContainerEngine() {
  // Check if user explicitly set container engine
  if (process.env.CONTAINER_ENGINE) {
    return process.env.CONTAINER_ENGINE;
  }
  
  // Try docker first, then podman
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return 'docker';
  } catch (error) {
    try {
      execSync('podman --version', { stdio: 'ignore' });
      print.info('Docker not found, using Podman as container engine');
      return 'podman';
    } catch (podmanError) {
      return null;
    }
  }
}

function checkDocker() {
  const engine = getContainerEngine();
  
  if (!engine) {
    print.error('Neither Docker nor Podman is installed or in PATH');
    print.info('Please install Docker: https://docs.docker.com/get-docker/');
    print.info('Or install Podman: https://podman.io/getting-started/installation');
    process.exit(1);
  }
  
  // Set the container engine for the session
  process.env.CONTAINER_ENGINE = engine;
  
  if (engine === 'podman') {
    print.info(`Using ${engine} as container engine`);
  }
}

function createOutputDir() {
  const outputDir = './recordings';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

function getDockerImage() {
  return process.env.DOCKER_IMAGE_NAME || 'meet-teams-bot:latest';
}

/**
 * Configuration Processing
 */
function applyOverrides(json, overrides) {
  let config = JSON.parse(json);
  
  for (const override of overrides) {
    if (override.includes('=')) {
      const [key, value] = override.split('=', 2);
      config[key] = value;
    } else {
      print.warning(`Invalid override format: ${override} (must be key=value)`);
    }
  }
  
  return JSON.stringify(config);
}

function processConfig(configJson) {
  const botUuid = generateUuid();
  print.info(`${ICONS.BOT} Generated bot session ID: ${botUuid.slice(0, 8)}...`);
  
  let config = JSON.parse(configJson);
  config.bot_uuid = botUuid;
  
  return JSON.stringify(config);
}

/**
 * Container Image Management
 */
function buildImage(imageName = 'meet-teams-bot') {
  const engine = getContainerEngine();
  const dateTag = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z/, '')
    .replace('T', '-')
    .slice(0, 13);
  const fullTag = `${imageName}:${dateTag}`;
  
  print.info(`Building Meet Teams Bot container image using ${engine}...`);
  print.info(`Tagging as: ${fullTag}`);
  
  try {
    execSync(`${engine} build -t "${fullTag}" .`, { stdio: 'inherit' });
    print.success(`Container image built successfully: ${fullTag}`);
    
    // Also tag as latest for convenience
    execSync(`${engine} tag "${fullTag}" "${imageName}:latest"`, { stdio: 'ignore' });
    print.info(`Also tagged as: ${imageName}:latest`);
    
    // Update the image name for the rest of the script
    process.env.DOCKER_IMAGE_NAME = fullTag;
  } catch (error) {
    print.error(`Failed to build container image with ${engine}`);
    process.exit(1);
  }
}

/**
 * Container Process Management
 */
function createContainerArgs(debugMode) {
  if (debugMode) {
    return ['-p', '5900:5900', '-p', '3000:3000'];
  }
  return ['-p', '3000:3000'];
}

function createContainerCommand(containerArgs, envVars, outputDir) {
  const engine = getContainerEngine();
  return [
    engine, 'run', '-i',
    ...containerArgs,
    ...envVars.map(env => ['-e', env]).flat(),
    '-v', `${process.cwd()}/${outputDir}:/app/data`,
    getDockerImage()
  ];
}

function handleContainerOutput(containerProcess) {
  containerProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.includes('Starting virtual display')) {
        print.info(`${ICONS.DISPLAY} ${line}`);
      } else if (line.includes('Virtual display started')) {
        print.success(line);
      } else if (line.trim()) {
        console.log(line);
      }
    }
  });
  
  containerProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(line);
      }
    }
  });
}

function listGeneratedFiles(outputDir) {
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir, { recursive: true })
      .filter(file => file.endsWith('.mp4') || file.endsWith('.wav'))
      .map(file => path.join(outputDir, file));
    
    if (files.length > 0) {
      console.log();
      print.success('Generated recordings:');
      for (const file of files) {
        const stats = fs.statSync(file);
        const size = (stats.size / (1024 * 1024)).toFixed(1) + 'M';
        const filename = path.basename(file);
        console.log(`  ${COLORS.GREEN}${ICONS.FILE} ${filename}${COLORS.NC} (${size})`);
      }
    }
  }
}

function printBotSummary(botUuid) {
  if (botUuid) {
    console.log(`\n${COLORS.GREEN}done, check out your recording and metadata for bot UUID in ${botUuid}${COLORS.NC}`);
    console.log();
    console.log(`./recordings/${botUuid}/output.mp4`);
    console.log(`./recordings/${botUuid}/`);
  }
}

/**
 * Main Bot Execution Functions
 */
async function runBotProcess(processedConfig, containerArgs, envVars, outputDir) {
  const containerCmd = createContainerCommand(containerArgs, envVars, outputDir);
  
  const containerProcess = spawn(containerCmd[0], containerCmd.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  containerProcess.stdin.write(processedConfig);
  containerProcess.stdin.end();
  
  handleContainerOutput(containerProcess);
  
  return new Promise((resolve) => {
    containerProcess.on('close', (code) => {
      if (code === 0) {
        print.success('Bot session completed successfully');
        listGeneratedFiles(outputDir);
        
        const config = JSON.parse(processedConfig);
        printBotSummary(config.bot_uuid);
        resolve(0);
      } else {
        print.error('Bot session failed');
        resolve(1);
      }
    });
  });
}

async function runWithConfig(configFile, overrideMeetingUrl) {
  const recordingMode = process.env.RECORDING || 'true';
  const debugMode = process.env.DEBUG === 'true';
  const debugLogs = process.env.DEBUG_LOGS === 'true';
  
  if (!fs.existsSync(configFile)) {
    print.error(`Configuration file '${configFile}' not found`);
    print.info('Please create a JSON configuration file. See params.json for example format.');
    process.exit(1);
  }
  
  const outputDir = createOutputDir();
  let configJson = fs.readFileSync(configFile, 'utf8');
  
  // Override meeting URL if provided as argument
  if (overrideMeetingUrl) {
    print.info(`Overriding meeting URL with: ${overrideMeetingUrl}`);
    let config = JSON.parse(configJson);
    config.meeting_url = overrideMeetingUrl;
    configJson = JSON.stringify(config);
  }
  
  const processedConfig = processConfig(configJson);
  
  print.info(`Running Meet Teams Bot with configuration: ${configFile}`);
  print.info(`Recording enabled: ${recordingMode}`);
  print.info('Recording mode: screen (direct capture)');
  if (overrideMeetingUrl) {
    print.info(`Meeting URL: ${overrideMeetingUrl}`);
  }
  print.info(`Output directory: ${outputDir}`);
  
  // Debug mode with VNC
  const containerArgs = createContainerArgs(debugMode);
  if (debugMode) {
    print.info('🔍 DEBUG MODE: VNC enabled on port 5900');
    print.info('💻 Connect with VNC viewer to: localhost:5900');
    print.info('📱 On Mac, you can use: open vnc://localhost:5900');
  }
  
  // Debug: Show what we're sending to container (first 200 chars)
  const preview = processedConfig.slice(0, 200);
  print.info(`Config preview: ${preview}...`);
  
  // Validate JSON is not empty
  if (!processedConfig || processedConfig === '{}') {
    print.error('Invalid configuration format after processing.');
    print.error(`Original config_json: ${configJson}`);
    print.error(`Processed config: ${processedConfig}`);
    process.exit(1);
  }
  
  // Add debug logs environment variable if enabled
  const envVars = [`RECORDING=${recordingMode}`];
  if (debugLogs) {
    envVars.push('DEBUG_LOGS=true');
    print.info('🐛 DEBUG logs enabled - verbose speakers logging activated');
  }
  
  return await runBotProcess(processedConfig, containerArgs, envVars, outputDir);
}

async function runWithConfigAndOverrides(configFile, overrides = []) {
  let configJson = fs.readFileSync(configFile, 'utf8');
  
  if (overrides.length > 0) {
    configJson = applyOverrides(configJson, overrides);
    print.info(`Applied CLI overrides: ${overrides.join(' ')}`);
  }
  
  const outputDir = createOutputDir();
  const processedConfig = processConfig(configJson);
  const recordingMode = process.env.RECORDING || 'true';
  const debugMode = process.env.DEBUG === 'true';
  const debugLogs = process.env.DEBUG_LOGS === 'true';
  
  print.info(`Running Meet Teams Bot with configuration: ${configFile}`);
  print.info(`Recording enabled: ${recordingMode}`);
  print.info('Recording mode: screen (direct capture)');
  print.info(`Output directory: ${outputDir}`);
  
  // Debug mode with VNC
  const containerArgs = createContainerArgs(debugMode);
  if (debugMode) {
    print.info('🔍 DEBUG MODE: VNC enabled on port 5900');
    print.info('💻 Connect with VNC viewer to: localhost:5900');
    print.info('📱 On Mac, you can use: open vnc://localhost:5900');
  }
  
  // Debug: Show what we're sending to container (first 200 chars)
  const preview = processedConfig.slice(0, 200);
  print.info(`Config preview: ${preview}...`);
  
  // Validate JSON is not empty
  if (!processedConfig || processedConfig === '{}') {
    print.error('Invalid configuration format after processing.');
    print.error(`Original config_json: ${configJson}`);
    print.error(`Processed config: ${processedConfig}`);
    process.exit(1);
  }
  
  // Add debug logs environment variable if enabled
  const envVars = [`RECORDING=${recordingMode}`];
  if (debugLogs) {
    envVars.push('DEBUG_LOGS=true');
    print.info('🐛 DEBUG logs enabled - verbose speakers logging activated');
  }
  
  return await runBotProcess(processedConfig, containerArgs, envVars, outputDir);
}

/**
 * Specialized Run Functions
 */
async function runDebug(configFile, overrideMeetingUrl) {
  print.info('🐛 Starting DEBUG mode - speakers debug logs + VNC enabled');
  
  // Force enable debug modes
  process.env.DEBUG_LOGS = 'true';
  process.env.DEBUG = 'true';
  
  return await runWithConfig(configFile, overrideMeetingUrl);
}

async function runWithJson(jsonInput) {
  const recordingMode = process.env.RECORDING || 'true';
  const debugMode = process.env.DEBUG === 'true';
  const debugLogs = process.env.DEBUG_LOGS === 'true';
  const outputDir = createOutputDir();
  const processedConfig = processConfig(jsonInput);
  
  print.info('Running Meet Teams Bot with provided JSON configuration');
  print.info(`Recording enabled: ${recordingMode}`);
  print.info('Recording mode: screen (direct capture)');
  print.info(`Output directory: ${outputDir}`);
  
  // Debug mode with VNC
  const containerArgs = createContainerArgs(debugMode);
  if (debugMode) {
    print.info('🔍 DEBUG MODE: VNC enabled on port 5900');
    print.info('💻 Connect with VNC viewer to: localhost:5900');
    print.info('📱 On Mac, you can use: open vnc://localhost:5900');
  }
  
  // Debug: Show what we're sending to container (first 200 chars)
  const preview = processedConfig.slice(0, 200);
  print.info(`Config preview: ${preview}...`);
  
  // Validate JSON is not empty
  if (!processedConfig || processedConfig === '{}') {
    print.error('Processed configuration is empty or invalid');
    print.info(`Original config: ${jsonInput}`);
    process.exit(1);
  }
  
  // Add debug logs environment variable if enabled
  const envVars = [`RECORDING=${recordingMode}`];
  if (debugLogs) {
    envVars.push('DEBUG_LOGS=true');
    print.info('🐛 DEBUG logs enabled - verbose speakers logging activated');
  }
  
  const containerCmd = createContainerCommand(containerArgs, envVars, outputDir);
  
  // Run the bot with inherit stdio for JSON mode
  const containerProcess = spawn(containerCmd[0], containerCmd.slice(1), {
    stdio: ['pipe', 'inherit', 'inherit']
  });
  
  containerProcess.stdin.write(processedConfig);
  containerProcess.stdin.end();
  
  return new Promise((resolve) => {
    containerProcess.on('close', (code) => {
      print.success('Bot execution completed');
      print.info(`Recordings saved to: ${outputDir}`);
      
      // List generated files
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir, { recursive: true })
          .filter(file => file.endsWith('.mp4') || file.endsWith('.wav'))
          .map(file => path.join(outputDir, file));
        
        if (files.length > 0) {
          print.success('Generated files:');
          for (const file of files) {
            const stats = fs.statSync(file);
            const size = (stats.size / (1024 * 1024)).toFixed(1) + 'M';
            console.log(`  ${COLORS.GREEN}📁 ${file}${COLORS.NC} (${size})`);
          }
        }
      }
      resolve(code);
    });
  });
}

/**
 * Utility Functions
 */
function cleanRecordings() {
  const outputDir = './recordings';
  if (fs.existsSync(outputDir)) {
    print.warning(`This will delete all files in ${outputDir}`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Are you sure? (y/N): ', (answer) => {
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          const filePath = path.join(outputDir, file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
        print.success('Recordings directory cleaned');
      } else {
        print.info('Operation cancelled');
      }
      rl.close();
    });
  } else {
    print.info('No recordings directory to clean');
  }
}

/**
 * Testing Functions
 */
function analyzeTestLogs(logContent) {
  let successCount = 0;
  const totalTests = 5;
  
  // Test 1: Virtual display
  if (logContent.includes('Virtual display started')) {
    print.success('✅ Virtual display working');
    successCount++;
  } else {
    print.warning('⚠️ Virtual display may have issues');
  }
  
  // Test 2: PulseAudio
  if (logContent.includes('PulseAudio started')) {
    print.success('✅ PulseAudio working');
    successCount++;
  } else {
    print.warning('⚠️ PulseAudio may have issues');
  }
  
  // Test 3: Virtual audio devices
  if (logContent.includes('Virtual audio devices created')) {
    print.success('✅ Audio devices created');
    successCount++;
  } else {
    print.warning('⚠️ Audio devices may have issues');
  }
  
  // Test 4: Application started
  if (/Starting application|Running in serverless mode|Running on http/.test(logContent)) {
    print.success('✅ Application started');
    successCount++;
  } else {
    print.warning('⚠️ Application may not have started');
  }
  
  // Test 5: Configuration parsed
  if (!logContent.includes('Failed to parse JSON from stdin')) {
    print.success('✅ Configuration parsed successfully');
    successCount++;
  } else {
    print.warning('⚠️ Configuration parsing failed');
  }
  
  return { successCount, totalTests };
}

function checkGeneratedFiles() {
  const outputDir = './recordings';
  const recordingFiles = fs.existsSync(outputDir) 
    ? fs.readdirSync(outputDir, { recursive: true })
        .filter(file => file.endsWith('.mp4') || file.endsWith('.wav'))
    : [];
  
  if (recordingFiles.length > 0) {
    print.success('✅ Recording files were generated');
    print.info('Generated files:');
    recordingFiles.slice(0, 5).forEach(file => console.log(`  ${file}`));
  } else {
    print.info('ℹ️ No recording files (normal for short test)');
  }
}

function analyzeCriticalErrors(logContent) {
  const criticalErrors = logContent.split('\n')
    .filter(line => /error|Error|ERROR/.test(line))
    .filter(line => !/Console logger|redis url|Failed to parse JSON|info.*error|redis.*undefined/.test(line))
    .length;
  
  if (criticalErrors === 0) {
    print.success('✅ No critical errors detected');
  } else {
    print.warning(`⚠️ ${criticalErrors} critical error(s) found:`);
    const errorLines = logContent.split('\n')
      .filter(line => /error|Error|ERROR/.test(line))
      .filter(line => !/Console logger|redis url|Failed to parse JSON|info.*error|redis.*undefined/.test(line))
      .slice(0, 3);
    errorLines.forEach(line => console.log(`  ${line}`));
  }
  
  return criticalErrors;
}

async function testRecording(duration = 30) {
  const debugMode = process.env.DEBUG === 'true';
  
  print.info('🧪 Testing screen recording system');
  print.info(`📅 Test duration: ${duration}s`);
  print.info('📄 Using normal run command with params.json');
  if (debugMode) {
    print.info('🔍 DEBUG MODE: VNC will be available on port 5900');
    print.info('💻 Connect with: open vnc://localhost:5900');
  }
  
  checkDocker();
  
  if (!fs.existsSync('params.json')) {
    print.error('params.json not found!');
    print.info('Please create params.json with your meeting configuration');
    return 1;
  }
  
  // Build image if necessary
  const engine = getContainerEngine();
  try {
    execSync(`${engine} images | grep -q "${getDockerImage().split(':')[0]}"`, { stdio: 'ignore' });
  } catch (error) {
    print.info(`Container image not found, building...`);
    buildImage();
  }
  
  print.info('🚀 Starting normal bot run with screen recording...');
  print.info(`ℹ️ Will automatically stop after ${duration}s`);
  
  const logFile = `/tmp/test-run-${Date.now()}.log`;
  const envVars = debugMode ? { ...process.env, DEBUG: 'true' } : process.env;
  
  return new Promise((resolve) => {
    const botProcess = spawn('./run_bot.js', ['run', 'params.json'], {
      env: envVars,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const logStream = fs.createWriteStream(logFile);
    botProcess.stdout.pipe(logStream);
    botProcess.stderr.pipe(logStream);
    
    const timeout = setTimeout(() => {
      print.info(`⏰ Test timeout reached (${duration}s), stopping...`);
      botProcess.kill('SIGTERM');
      setTimeout(() => botProcess.kill('SIGKILL'), 5000);
    }, duration * 1000);
    
    botProcess.on('close', (code) => {
      clearTimeout(timeout);
      logStream.end();
      
      if (code === 0 || code === null) {
        print.success('✅ Test completed successfully');
      } else {
        print.info('ℹ️ Test stopped after timeout (this is expected)');
      }
      
      print.info('📊 Analyzing test results...');
      
      const logContent = fs.readFileSync(logFile, 'utf8');
      
      // Show key system messages
      print.info('🔍 Key system messages:');
      const keyLines = logContent.split('\n')
        .filter(line => /Virtual display|PulseAudio|audio devices|ScreenRecorder|Screen recording|Application|Bot execution|Generated files/.test(line))
        .slice(0, 10);
      keyLines.forEach(line => console.log(`  ${line}`));
      
      const { successCount, totalTests } = analyzeTestLogs(logContent);
      checkGeneratedFiles();
      const criticalErrors = analyzeCriticalErrors(logContent);
      
      // Final summary
      const successRate = Math.floor((successCount * 100) / totalTests);
      print.success('🎯 Test completed for screen recording');
      print.info(`Duration: ${duration}s`);
      print.info(`Success rate: ${successCount}/${totalTests} tests passed (${successRate}%)`);
      print.info(`Critical errors: ${criticalErrors}`);
      print.info(`Full log available at: ${logFile}`);
      
      if (successRate >= 80 && criticalErrors === 0) {
        print.success('🎉 Test passed! Screen recording system is working correctly');
        resolve(0);
      } else if (successRate >= 60) {
        print.warning('⚠️ Test passed with warnings. System mostly working.');
        resolve(0);
      } else {
        print.error('❌ Test failed. Multiple issues detected.');
        print.info(`Check the full log for details: ${logFile}`);
        resolve(1);
      }
    });
  });
}

/**
 * Help and Documentation
 */
function showHelp() {
  console.log(`${COLORS.BLUE}Meet Teams Bot - Serverless Runner${COLORS.NC}`);
  console.log();
  console.log('Usage:');
  console.log('  node run_bot.js build                     - Build the container image');
  console.log('  node run_bot.js run <config_file> [url]   - Run bot with configuration file (optional meeting URL override)');
  console.log('  node run_bot.js debug <config_file> [url] - Run bot in DEBUG mode (speakers logs + VNC enabled)');
  console.log('  node run_bot.js run-json \'<json>\'         - Run bot with JSON configuration');
  console.log('  node run_bot.js test [duration]           - Test screen recording system (duration in seconds)');
  console.log('  node run_bot.js clean                     - Clean recordings directory');
  console.log('  node run_bot.js help                      - Show this help message');
  console.log();
  console.log('Environment Variables:');
  console.log('  RECORDING=true|false         - Enable/disable video recording (default: true)');
  console.log('  DEBUG=true|false            - Enable/disable debug mode with VNC (default: false)');
  console.log('  DEBUG_LOGS=true|false       - Enable/disable speakers debug logs (default: false)');
  console.log('  CONTAINER_ENGINE=docker|podman - Force specific container engine (auto-detected if not set)');
  console.log();
  console.log('Examples:');
  console.log('  node run_bot.js build');
  console.log('  node run_bot.js run params.json');
  console.log('  node run_bot.js debug params.json                            # Debug mode: speakers logs + VNC');
  console.log('  node run_bot.js run params.json \'https://meet.google.com/new-meeting-url\'');
  console.log('  node run_bot.js debug params.json \'https://meet.google.com/new-url\'  # Debug with URL override');
  console.log('  RECORDING=false node run_bot.js run params.json  # Run without video recording');
  console.log('  RECORDING=false node run_bot.js debug params.json  # Debug without video recording');
  console.log('  DEBUG=true node run_bot.js run params.json       # Run with VNC debug access only');
  console.log('  DEBUG_LOGS=true node run_bot.js run params.json  # Run with speakers debug logs only');
  console.log('  node run_bot.js run-json \'{"meeting_url":"https://meet.google.com/abc-def-ghi", "bot_name":"RecordingBot"}\'');
  console.log('  RECORDING=false node run_bot.js run-json \'{...}\'  # Run JSON config without recording');
  console.log('  DEBUG=true node run_bot.js run-json \'{...}\'      # Run JSON config with VNC debug');
  console.log('  node run_bot.js test 60  # Test screen recording for 60 seconds');
  console.log('  DEBUG=true node run_bot.js test 60              # Test with VNC debug access');
  console.log('  node run_bot.js clean');
  console.log();
  console.log('Container Engine Support:');
  console.log('  • Docker (preferred) - Standard container runtime');
  console.log('  • Podman - Docker alternative, automatically detected if Docker unavailable');
  console.log('  • Use CONTAINER_ENGINE=podman to force Podman usage');
  console.log();
  console.log('Recording Modes:');
  console.log('  • screen (default)    - Direct screen capture via FFmpeg (recommended)');
  console.log();
  console.log('Features:');
  console.log('  • Automatically generates bot_uuid if not provided');
  console.log('  • Override meeting URL by passing it as last argument');
  console.log('  • Control video recording with RECORDING environment variable');
  console.log('  • DEBUG mode: One command to enable speakers debug logs + VNC access');
  console.log('  • Debug logs: Show detailed speakers detection (DEBUG_LOGS=true)');
  console.log('  • VNC access: View bot screen remotely (DEBUG=true) - localhost:5900');
  console.log('  • Test recording system with different modes');
  console.log('  • Saves recordings to ./recordings directory (when recording enabled)');
  console.log('  • Lists generated files after completion');
  console.log('  • Automatic Docker/Podman detection and compatibility');
  console.log();
  console.log('For configuration format, see bot.config.json');
}

/**
 * Main Application Logic
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  switch (command) {
    case 'build':
      checkDocker();
      buildImage();
      break;
      
    case 'run':
      await handleRunCommand(args);
      break;
      
    case 'debug':
      await handleDebugCommand(args);
      break;
      
    case 'run-json':
      await handleRunJsonCommand(args);
      break;
      
    case 'test':
      const duration = parseInt(args[1]) || 30;
      await testRecording(duration);
      break;
      
    case 'clean':
      cleanRecordings();
      break;
      
    case 'help':
    case '-h':
    case '--help':
    default:
      showHelp();
      break;
  }
}

/**
 * Command Handlers
 */
async function handleRunCommand(args) {
  const defaultConfig = 'bot.config.json';
  let configFile = defaultConfig;
  let overrides = [];
  
  if (args[1] && fs.existsSync(args[1])) {
    configFile = args[1];
    overrides = args.slice(2);
  } else {
    overrides = args.slice(1);
  }
  
  if (!fs.existsSync(configFile)) {
    print.error(`Configuration file not found: ${configFile}`);
    print.info(`Please create ${configFile} or specify a config file.`);
    process.exit(1);
  }
  
  print.info(`Using config file: ${configFile}`);
  await runWithConfigAndOverrides(configFile, overrides);
}

async function handleDebugCommand(args) {
  if (!args[1]) {
    print.error('Please specify a configuration file');
    print.info('Usage: node run_bot.js debug <config_file> [meeting_url]');
    process.exit(1);
  }
  checkDocker();
  await runDebug(args[1], args[2]);
}

async function handleRunJsonCommand(args) {
  if (!args[1]) {
    print.error('Please provide JSON configuration');
    print.info('Usage: node run_bot.js run-json \'<json_config>\'');
    process.exit(1);
  }
  checkDocker();
  await runWithJson(args[1]);
}

/**
 * Module Entry Point
 */
if (require.main === module) {
  main().catch((error) => {
    print.error(`Unexpected error: ${error.message}`);
    process.exit(1);
  });
}

/**
 * Module Exports
 */
module.exports = {
  // Core utilities
  generateUuid,
  getContainerEngine,
  checkDocker,
  createOutputDir,
  getDockerImage,
  
  // Configuration processing
  applyOverrides,
  processConfig,
  
  // Container operations
  buildImage,
  createContainerArgs,
  createContainerCommand,
  handleContainerOutput,
  runBotProcess,
  
  // Main functions
  runWithConfig,
  runWithConfigAndOverrides,
  runDebug,
  runWithJson,
  
  // Utility functions
  cleanRecordings,
  testRecording,
  showHelp,
  
  // Testing utilities
  analyzeTestLogs,
  checkGeneratedFiles,
  analyzeCriticalErrors
};