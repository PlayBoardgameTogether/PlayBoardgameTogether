import { spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';

// Only fixed categories leave this boundary. Never publish raw command output:
// maintenance tools may print connection strings or other inherited secrets.
export function commandReason(output) {
  if (/Applied migration changed:/i.test(output)) return 'migration_changed';
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|command not found|not recognized as an internal/i.test(output)) return 'build_tool_missing';
  if (/error TS\d{4}:|Build failed with|failed to resolve import/i.test(output)) return 'compilation';
  if (/ENOSPC|No space left on device/i.test(output)) return 'disk_full';
  if (/EACCES|EPERM|Permission denied/i.test(output)) return 'permission';
  if (/Authentication failed|could not read Username|Repository not found|HTTP 40[13]/i.test(output)) return 'authentication';
  if (/ENOTFOUND|EAI_AGAIN|Could not resolve|unable to access|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(output)) return 'network';
  if (/ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_LOCKFILE_BREAKING_CHANGE|frozen.lockfile/i.test(output)) return 'lockfile';
  if (/couldn't find remote ref/i.test(output)) return 'branch_missing';
  return 'command_failed';
}

export function runUpdateCommand(executable, args, { cwd, env, timeout = 600000 }) {
  return new Promise((accept, reject) => {
    if (executable === 'pnpm') {
      const entry = env.UPDATE_PNPM_CLI || env.npm_execpath;
      if (entry && /pnpm/i.test(entry)) {
        args = [entry, ...args];
        executable = process.execPath;
      } else if (process.platform === 'win32') {
        reject(Object.assign(new Error('pnpm launcher unavailable'), { reason: 'pnpm_unavailable' }));
        return;
      }
    }
    const task = spawn(executable, args, {
      cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let diagnostics = '';
    let timedOut = false;
    task.stdout.on('data', data => {
      output = (output + data.toString()).slice(-65536);
      diagnostics = (diagnostics + data.toString()).slice(-65536);
    });
    task.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-65536); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!task.pid) return;
      if (process.platform === 'win32') {
        const terminator = spawn('taskkill', ['/PID', String(task.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        terminator.on('error', () => task.kill());
        terminator.on('exit', code => { if (code !== 0) task.kill(); });
      } else {
        try { process.kill(-task.pid, 'SIGKILL'); } catch { task.kill(); }
      }
    }, timeout);
    task.once('error', error => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Update command could not start'), {
        reason: error.code === 'ENOENT' ? 'command_missing' : 'permission', exitCode: null,
      }));
    });
    // close waits for both output streams, unlike exit.
    task.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) accept(output.trim());
      else reject(Object.assign(new Error('Update command failed'), {
        reason: timedOut ? 'timeout' : commandReason(diagnostics), exitCode: code,
      }));
    });
  });
}

export async function buildRelease(command, path, stage = () => {}) {
  stage('install');
  await command('pnpm', ['install', '--frozen-lockfile', '--prod=false'], path);
  stage('build');
  await command('pnpm', ['build'], path);
}

export async function prepareReleaseDatabase(command, release, stage = () => {}) {
  stage('migrate');
  await command('pnpm', ['db:migrate'], release.path);
  stage('sync');
  await command('pnpm', ['games:sync'], release.path);
}
