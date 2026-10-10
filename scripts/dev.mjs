// Runs the local API (mock AI, in-memory data) and the Vite dev server together.
//   npm run dev        -> http://localhost:5173
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '-w', 'backend'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '8787' },
  }),
  spawn('npm', ['run', 'dev', '-w', 'frontend'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_AUTH_MODE: 'local', VITE_API_URL: 'http://localhost:8787' },
  }),
];

const stop = () => procs.forEach((p) => p.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && code !== 130 && stop()));
