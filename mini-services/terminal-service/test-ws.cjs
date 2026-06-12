const { createServer } = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { writeFile, mkdir, rm } = require('fs/promises');
const { existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { randomUUID } = require('crypto');

let pty = null;
try {
  pty = require('node-pty');
  console.log('node-pty loaded');
} catch (e) {
  console.warn('node-pty NOT available:', e.message);
}

const activeExecutions = new Map();
const server = createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected from:', req.socket.remoteAddress);
  
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    
    if (msg.type === 'execute') {
      const { code, language, requestId, rows, cols } = msg;
      console.log(`Execute: ${requestId}, language=${language}`);
      
      (async () => {
        const tempDir = join(tmpdir(), `exec_${randomUUID().slice(0, 8)}`);
        await mkdir(tempDir, { recursive: true });
        await writeFile(join(tempDir, 'main.py'), code, 'utf-8');
        
        const startTime = Date.now();
        const execution = { ptyProcess: null, tempDir, startTime, killed: false, ws };
        activeExecutions.set(requestId, execution);
        
        ws.send(JSON.stringify({ type: 'started', requestId }));
        
        if (pty) {
          const ptyProcess = pty.spawn('python3', ['-u', join(tempDir, 'main.py')], {
            name: 'xterm-256color',
            cols: cols || 80,
            rows: rows || 24,
            cwd: tempDir,
            env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1', TERM: 'xterm-256color' },
          });
          execution.ptyProcess = ptyProcess;
          
          ptyProcess.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', requestId, data }));
            }
          });
          
          ptyProcess.onExit(({ exitCode }) => {
            ws.send(JSON.stringify({ type: 'exit', requestId, exitCode, executionTime: Date.now() - startTime }));
            activeExecutions.delete(requestId);
          });
        }
      })();
    }
    
    if (msg.type === 'stdin') {
      const execution = activeExecutions.get(msg.requestId);
      if (execution?.ptyProcess) {
        execution.ptyProcess.write(msg.data);
        console.log(`stdin: ${JSON.stringify(msg.data)} for ${msg.requestId}`);
      }
    }
    
    if (msg.type === 'kill') {
      const execution = activeExecutions.get(msg.requestId);
      if (execution) {
        execution.killed = true;
        try { execution.ptyProcess?.kill('SIGKILL'); } catch {}
        activeExecutions.delete(msg.requestId);
      }
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

server.listen(3002, () => {
  console.log('Raw WebSocket terminal service on port 3002');
  console.log('PTY available:', !!pty);
});
