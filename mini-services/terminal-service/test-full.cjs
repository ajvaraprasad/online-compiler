const { createServer } = require('http');
const { Server } = require('socket.io');

let pty = null;
let ptyAvailable = false;
try {
  pty = require('node-pty');
  ptyAvailable = true;
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
  socket.on('stdin', (data, ack) => {
    console.log(`stdin received: requestId=${data.requestId}, data=${JSON.stringify(data.data)}`);
    ack?.({ ok: true });
  });
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`Full test server listening on port ${PORT}, PTY available: ${ptyAvailable}`);
});
