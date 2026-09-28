import http from 'node:http';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import config from './config/index.js';
import { createApp } from './app.js';
import initSockets from './sockets/index.js';

async function main() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 4000 });
  console.log(`[db] connected ${config.mongoUrl}`);

  const app = createApp();
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: config.frontendUrl, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 40_960
  });
  app.set('io', io);
  initSockets(io);

  server.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[api] ${signal} — shutting down`);
    io.close();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});