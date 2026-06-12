const { createServer } = require('http');
const { Server } = require('socket.io');
const { writeFile, mkdir, rm } = require('fs/promises');
const { existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');

let pty = null;
let ptyAvailable = false;
try {
  pty = require('node-pty');
  ptyAvailable = true;
  console.log('node-pty loaded successfully');
} catch (e) {
  console.warn('node-pty NOT available:', e.message);
}

const activeExecutions = new Map();

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('execute', async (data) => {
    const { code, language, requestId, rows, cols } = data;
    console.log(`Execute: ${requestId}, language=${language}`);
    
    const tempDir = join(tmpdir(), `exec_${randomUUID().slice(0, 8)}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'main.py'), code, 'utf-8');
    
    const startTime = Date.now();
    const execution = { ptyProcess: null, tempDir, startTime, killed: false, socketId: socket.id };
    activeExecutions.set(requestId, execution);
    
    socket.emit('started', { requestId, timestamp: startTime });
    
    if (ptyAvailable && pty) {
      const ptyProcess = pty.spawn('python3', ['-u', join(tempDir, 'main.py')], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: tempDir,
        env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1' },
      });
      execution.ptyProcess = ptyProcess;
      
      ptyProcess.onData((data) => {
        socket.emit('output', { requestId, data });
      });
      
      ptyProcess.onExit(({ exitCode }) => {
        socket.emit('exit', { requestId, exitCode, executionTime: Date.now() - startTime });
        activeExecutions.delete(requestId);
      });
    }
  });
  
  socket.on('stdin', (data, ack) => {
    const execution = activeExecutions.get(data.requestId);
    console.log(`stdin: requestId=${data.requestId}, data=${JSON.stringify(data.data)}, found=${!!execution}`);
    if (execution?.ptyProcess) {
      execution.ptyProcess.write(data.data);
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, error: 'No execution found' });
    }
  });
  
  socket.on('kill', (data) => {
    const execution = activeExecutions.get(data.requestId);
    if (execution) {
      execution.killed = true;
      try { execution.ptyProcess?.kill('SIGKILL'); } catch {}
      activeExecutions.delete(data.requestId);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const [requestId, execution] of activeExecutions.entries()) {
      if (execution.socketId === socket.id && !execution.killed) {
        execution.killed = true;
        try { execution.ptyProcess?.kill('SIGKILL'); } catch {}
        activeExecutions.delete(requestId);
      }
    }
  });
});

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`Minimal terminal service (no pipeline) listening on port ${PORT}`);
  console.log(`PTY available: ${ptyAvailable}`);
});
