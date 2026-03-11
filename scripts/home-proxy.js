/**
 * THG Home Proxy — Chạy trên Windows để route VPS traffic qua IP nhà bạn
 * 
 * Usage:
 *   1. Mở PowerShell trên Windows, chạy: node scripts/home-proxy.js
 *   2. Mở PowerShell khác, chạy: ssh -R 8888:localhost:8888 -p 2018 root@61.14.233.242 -N
 *   3. VPS sẽ dùng localhost:8888 làm proxy → traffic đi qua IP nhà bạn
 * 
 * Ctrl+C để tắt proxy.
 */
const net = require('net');
const http = require('http');

const PORT = 8888;
let connections = 0;

const server = http.createServer((req, res) => {
    // Simple HTTP forward (không dùng cho Facebook vì FB dùng HTTPS)
    res.writeHead(502);
    res.end('Use HTTPS CONNECT tunnel');
});

// HTTPS CONNECT tunneling — đây là phần chính
server.on('connect', (req, clientSocket, head) => {
    const [hostname, port] = req.url.split(':');
    const targetPort = parseInt(port) || 443;
    connections++;
    const connId = connections;

    console.log(`[${connId}] 🔗 CONNECT ${hostname}:${targetPort}`);

    const serverSocket = net.connect(targetPort, hostname, () => {
        clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n' +
            'Proxy-Agent: THG-Home-Proxy\r\n' +
            '\r\n'
        );
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
        console.log(`[${connId}] ❌ ${hostname}: ${err.message}`);
        clientSocket.end();
    });
    clientSocket.on('error', () => serverSocket.end());
    serverSocket.on('close', () => {
        console.log(`[${connId}] ✓ ${hostname} closed`);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} đang bị dùng! Tắt process khác hoặc đổi port.`);
        process.exit(1);
    }
    console.error('Server error:', err.message);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  🏠 THG Home Proxy — Running on localhost:${PORT}      ║
║                                                      ║
║  Bước tiếp: mở PowerShell MỚI, chạy:               ║
║  ssh -R 8888:localhost:8888 -p 2018                  ║
║      root@61.14.233.242 -N                           ║
║                                                      ║
║  Ctrl+C để tắt proxy                                ║
╚══════════════════════════════════════════════════════╝
`);
});
