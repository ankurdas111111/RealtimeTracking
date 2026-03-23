#!/usr/bin/env node

/**
 * start-v3.js - Unified startup script for Kinnect V3 with monitoring
 *
 * This script starts all components needed for local V3 development:
 * 1. Backend (Go) on port 3001 with monitoring on port 9090
 * 2. Frontend (Vite) on port 5173
 * 3. Shows the monitoring dashboard URL when ready
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`),
};

/**
 * Check if port is available
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Wait for a service to be healthy
 */
async function waitForService(port, endpoint = '', maxRetries = 60, delayMs = 1000) {
  const url = `http://localhost:${port}${endpoint}`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, { timeout: 2000 });
      if (response.ok) {
        return true;
      }
    } catch (e) {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return false;
}

/**
 * Load environment variables from .env
 */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, value] = trimmed.split('=');
        if (key && !process.env[key]) {
          process.env[key] = value?.trim().replace(/^["']|["']$/g, '') || '';
        }
      }
    });
  }
}

/**
 * Start a child process
 */
function startProcess(name, cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: options.stdio || 'inherit',
      shell: true,
    });

    proc.on('error', (err) => {
      log.error(`Failed to start ${name}: ${err.message}`);
      reject(err);
    });

    // For async processes, resolve immediately
    if (options.async) {
      setTimeout(() => resolve(proc), 500);
    }
  });
}

/**
 * Main startup orchestration
 */
async function main() {
  log.info('Starting Kinnect V3 with monitoring dashboard...\n');

  // Load environment
  loadEnv();

  // Set defaults
  process.env.PORT = process.env.PORT || '3001';
  process.env.MONITORING_PORT = process.env.MONITORING_PORT || '9090';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.VITE_REALTIME_PROTOCOL = 'ws';

  // Verify .env exists and has DATABASE_URL
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    log.warn('No .env file found. Using DATABASE_URL from environment.');
  }
  if (!process.env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Please set it in .env or environment.');
    process.exit(1);
  }

  // Check if ports are available
  const port = parseInt(process.env.PORT);
  const monitoringPort = parseInt(process.env.MONITORING_PORT);
  const frontendPort = 5173;

  log.info(`Checking port availability...`);
  const backendAvailable = await checkPort(port);
  const monitoringAvailable = await checkPort(monitoringPort);
  const frontendAvailable = await checkPort(frontendPort);

  if (!backendAvailable) {
    log.error(`Backend port ${port} is already in use`);
    process.exit(1);
  }
  if (!monitoringAvailable) {
    log.error(`Monitoring port ${monitoringPort} is already in use`);
    process.exit(1);
  }
  if (!frontendAvailable) {
    log.error(`Frontend port ${frontendPort} is already in use`);
    process.exit(1);
  }
  log.success('All ports are available\n');

  // Build frontend first
  log.info('Building frontend...');
  try {
    await new Promise((resolve, reject) => {
      const build = spawn('npm', ['run', 'build:frontend'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      build.on('close', (code) => {
        if (code === 0) {
          log.success('Frontend build complete\n');
          resolve();
        } else {
          reject(new Error(`Frontend build failed with code ${code}`));
        }
      });
    });
  } catch (err) {
    log.error(`Frontend build failed: ${err.message}`);
    process.exit(1);
  }

  // Start backend
  log.info(`Starting backend on port ${port}...`);
  const backendDir = path.join(__dirname, '..', 'backend');
  const backendArgs = [];

  const backendProc = spawn('go', ['run', '.'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: port.toString(),
      MONITORING_PORT: monitoringPort.toString(),
    },
    stdio: 'pipe',
  });

  // Capture backend output
  let backendReady = false;
  backendProc.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`${colors.cyan}[backend]${colors.reset} ${output}`);
    if (output.includes('started') || output.includes('listening')) {
      backendReady = true;
    }
  });
  backendProc.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`${colors.cyan}[backend]${colors.reset} ${output}`);
  });

  backendProc.on('error', (err) => {
    log.error(`Backend error: ${err.message}`);
    process.exit(1);
  });

  // Wait for backend to be ready
  log.info(`Waiting for backend to be ready (max 60s)...`);
  let backendHealthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`, { timeout: 1000 });
      if (response.ok) {
        log.success(`Backend is ready on port ${port}`);
        backendHealthy = true;
        break;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!backendHealthy) {
    log.warn(`Backend didn't respond to health check, but continuing...`);
  }

  // Wait a bit more for monitoring to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if monitoring is ready
  let monitoringHealthy = false;
  log.info(`Checking monitoring endpoint on port ${monitoringPort}...`);
  for (let i = 0; i < 10; i++) {
    try {
      const response = await fetch(`http://localhost:${monitoringPort}/health`, { timeout: 1000 });
      if (response.ok) {
        log.success(`Monitoring endpoint is ready on port ${monitoringPort}`);
        monitoringHealthy = true;
        break;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!monitoringHealthy) {
    log.warn(`Monitoring endpoint not responding on port ${monitoringPort}`);
  }

  // Start frontend dev server
  log.info(`\nStarting frontend dev server on port ${frontendPort}...`);
  const frontendProc = spawn('npm', ['run', 'dev:fe'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  frontendProc.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`${colors.yellow}[frontend]${colors.reset} ${output}`);
  });
  frontendProc.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`${colors.yellow}[frontend]${colors.reset} ${output}`);
  });

  frontendProc.on('error', (err) => {
    log.error(`Frontend error: ${err.message}`);
    process.exit(1);
  });

  // Wait for frontend to be ready
  log.info(`Waiting for frontend to be ready (max 30s)...`);
  let frontendHealthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`http://localhost:${frontendPort}`, { timeout: 1000 });
      if (response.ok) {
        log.success(`Frontend is ready on port ${frontendPort}`);
        frontendHealthy = true;
        break;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Print success summary
  console.log('\n' + '='.repeat(70));
  log.success('Kinnect V3 is running!');
  console.log('='.repeat(70) + '\n');

  console.log(`${colors.bright}Services:${colors.reset}`);
  console.log(`  • Backend:    http://localhost:${port}`);
  console.log(`  • Frontend:   http://localhost:${frontendPort}`);
  console.log(`  • Monitoring: http://localhost:${monitoringPort}`);
  console.log(`\n${colors.bright}Dashboard URLs:${colors.reset}`);
  console.log(`  • App:         ${colors.cyan}http://localhost:${frontendPort}${colors.reset}`);
  console.log(`  • Monitoring:  ${colors.cyan}http://localhost:${frontendPort}/#/monitoring${colors.reset}`);
  console.log(`\n${colors.bright}API Endpoints:${colors.reset}`);
  console.log(`  • Health:      ${colors.cyan}http://localhost:${port}/api/health${colors.reset}`);
  console.log(`  • Diagnostics: ${colors.cyan}http://localhost:${port}/api/diagnostics${colors.reset}`);
  console.log(`  • Metrics:     ${colors.cyan}http://localhost:${monitoringPort}/metrics${colors.reset}`);
  console.log(`\n${colors.bright}To stop:${colors.reset} Press Ctrl+C\n`);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log.info('Shutting down...');
    backendProc.kill();
    frontendProc.kill();
    setTimeout(() => process.exit(0), 1000);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
