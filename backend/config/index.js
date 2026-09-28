import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || String(value).trim() === '' ? fallback : String(value).trim();
}

const env = readEnv('NODE_ENV', 'development');
const port = Number(readEnv('PORT', '5001'));
const isProduction = env === 'production';
const isTest = env === 'test';
const isDevelopment = !isProduction && !isTest;

const config = {
  root,
  env,
  isProduction,
  isTest,
  isDevelopment,
  port,
  mongoUrl: readEnv('MONGODB_URL', 'mongodb://127.0.0.1:27017/cipher'),
  frontendUrl: readEnv('FRONTEND_URL', 'http://localhost:5173'),
  jwtSecret: readEnv('JWT_SECRET', isProduction ? '' : 'cipher-dev-only-secret-not-for-prod'),
  jwtTtlDays: Number(readEnv('JWT_TTL_DAYS', '7')),
  googleClientId: readEnv('GOOGLE_CLIENT_ID'),
  googleClientSecret: readEnv('GOOGLE_CLIENT_SECRET'),
  bodyLimitBytes: 96 * 1024,
  messageLimitBytes: 64 * 1024,
  firefoxCspFallback: true
};

if (isProduction && !config.jwtSecret) {
  throw new Error('Production requires JWT_SECRET');
}
if (config.googleClientId || config.googleClientSecret) {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error('Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required together');
  }
}

export default config;