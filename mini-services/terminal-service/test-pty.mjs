import { createServer } from 'http';
import { Server } from 'socket.io';

// Test node-pty import
let pty = null;
try {
  pty = require('node-pty');
  console.log('node-pty loaded successfully');
} catch (e) {
  console.warn('node-pty NOT available:', e.message);
}

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`Test server with PTY listening on port ${PORT}`);
});
