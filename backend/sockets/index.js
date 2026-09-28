import { verifyToken } from '../utils/token.js';

export default function initSockets(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = typeof token === 'string' ? verifyToken(token) : null;
    if (!payload) return next(new Error('You must be signed in'));
    socket.userId = payload.sub;
    next();
  });

  io.on('connection', (socket) => {
    const room = `user:${socket.userId}`;
    socket.join(room);

    socket.on('typing', ({ to, state } = {}) => {
      if (!to || !state) return;
      socket.to(`user:${to}`).emit('typing', { from: socket.userId, state: Boolean(state) });
    });
  });
}