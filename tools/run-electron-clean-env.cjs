#!/usr/bin/env node

const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
const electronArgs = [];

delete env.ELECTRON_RUN_AS_NODE;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];

  if (arg === '--variant') {
    const variant = process.argv[index + 1];
    if (!variant) {
      console.error('Missing value for --variant');
      process.exit(1);
    }
    env.APP_VARIANT = variant;
    index += 1;
    continue;
  }

  if (arg.startsWith('--variant=')) {
    env.APP_VARIANT = arg.slice('--variant='.length);
    continue;
  }

  if (arg === '--env') {
    const assignment = process.argv[index + 1];
    if (!assignment) {
      console.error('Missing value for --env');
      process.exit(1);
    }
    setEnvAssignment(env, assignment);
    index += 1;
    continue;
  }

  if (arg.startsWith('--env=')) {
    setEnvAssignment(env, arg.slice('--env='.length));
    continue;
  }

  if (arg === '--') {
    electronArgs.push(...process.argv.slice(index + 1));
    break;
  }

  electronArgs.push(arg);
}

const child = spawn(electronPath, electronArgs, {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error(`Unable to start Electron: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function setEnvAssignment(targetEnv, assignment) {
  const separatorIndex = assignment.indexOf('=');

  if (separatorIndex <= 0) {
    console.error(`Invalid --env assignment: ${assignment}`);
    process.exit(1);
  }

  const key = assignment.slice(0, separatorIndex);
  const value = assignment.slice(separatorIndex + 1);

  targetEnv[key] = value;
}
