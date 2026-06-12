const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:3002');

const code = `#include <stdio.h>

int main() {
    printf("Hello from C!\\n");
    return 0;
}`;

const messages = [];

ws.on('open', () => {
  console.log('Connected to terminal service');
  
  // Send execute command
  ws.send(JSON.stringify({
    type: 'execute',
    code: code,
    language: 'c',
    requestId: 'test-c-hello-001',
    rows: 24,
    cols: 80
  }));
  
  console.log('Sent execute command for C program');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  messages.push(msg);
  
  if (msg.type === 'phase') {
    console.log(`[PHASE] ${msg.phase}: ${msg.status}`, msg.mode ? `(mode: ${msg.mode})` : '', msg.message || '');
  } else if (msg.type === 'output') {
    process.stdout.write(`[OUTPUT] ${msg.data}`);
  } else if (msg.type === 'exit') {
    console.log(`\n[EXIT] Code: ${msg.exitCode}, Time: ${msg.executionTime}ms`);
    if (msg.summary) {
      console.log(`[SUMMARY] Mode: ${msg.summary.executionMode}, Success: ${msg.summary.success}`);
    }
    ws.close();
  } else if (msg.type === 'started') {
    console.log(`[STARTED] Engine: ${msg.engine}`);
  } else if (msg.type === 'error') {
    console.log(`[ERROR] ${msg.message}`);
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('\nConnection closed');
  process.exit(0);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('\nTimeout - closing');
  ws.close();
  process.exit(1);
}, 30000);
