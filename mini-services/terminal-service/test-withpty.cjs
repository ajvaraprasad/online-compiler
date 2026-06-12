const { createServer } = require('http');
const { Server } = require('socket.io');

let pty = null;
try {
  pty = require('node-pty');
  console.log('node-pty loaded');
} catch (e) {
  console.warn('node-pty NOT available:', e.message);
}

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

httpServer.listen(3002, () => {
  console.log('Server with PTY on port 3002');
});
