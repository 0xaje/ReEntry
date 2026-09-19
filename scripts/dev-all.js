import { spawn } from 'child_process';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log(`${BOLD}🚀 Starting Project Re-entry (Discord Bot + Web Dashboard)...${RESET}\n`);

// 1. Spawn Discord Bot
const botProcess = spawn('npx', ['tsx', 'watch', 'src/main.ts'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

botProcess.stdout?.on('data', (data) => {
  process.stdout.write(`${CYAN}[BOT]${RESET} ${data}`);
});

botProcess.stderr?.on('data', (data) => {
  process.stderr.write(`${CYAN}[BOT]${RESET} ${data}`);
});

// 2. Spawn Next.js Web App
const webProcess = spawn('npm', ['--prefix', 'web', 'run', 'dev'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

webProcess.stdout?.on('data', (data) => {
  process.stdout.write(`${GREEN}[WEB]${RESET} ${data}`);
});

webProcess.stderr?.on('data', (data) => {
  process.stderr.write(`${GREEN}[WEB]${RESET} ${data}`);
});

// Clean shutdown on Ctrl+C (SIGINT / SIGTERM)
function handleShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Gracefully stopping all processes...`);
  try {
    botProcess.kill('SIGTERM');
  } catch {}
  try {
    webProcess.kill('SIGTERM');
  } catch {}
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

botProcess.on('close', (code) => {
  console.log(`${CYAN}[BOT] exited with code ${code}${RESET}`);
});

webProcess.on('close', (code) => {
  console.log(`${GREEN}[WEB] exited with code ${code}${RESET}`);
});
