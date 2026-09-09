import { spawn } from 'node:child_process';

export class CommandError extends Error {
  constructor(command, code, stdout, stderr) {
    super(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'CommandError';
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    if (options.inherit) {
      child.once('error', reject);
      child.once('close', code => code === 0
        ? resolve({ code, stdout: '', stderr: '' })
        : reject(new CommandError([command, ...args].join(' '), code, '', '')));
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve({ code, stdout, stderr })
      : reject(new CommandError([command, ...args].join(' '), code, stdout, stderr)));
  });
}

export function spawnDetached(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return child.pid;
}
