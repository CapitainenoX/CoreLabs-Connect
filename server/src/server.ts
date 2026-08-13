import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CloudflareManager } from './cloudflare';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/tunnel-bridge' });

const PORT = process.env.PORT || 4000;
const DOMAIN = process.env.DOMAIN_NAME || 'tunnel.corelabs.network';
const cfManager = new CloudflareManager();

// Logger helper
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, detail?: any) {
  const time = new Date().toISOString();
  const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'DEBUG' ? '\x1b[35m' : '\x1b[32m';
  const detailStr = detail ? ` | ${typeof detail === 'object' ? JSON.stringify(detail, null, 2) : detail}` : '';
  console.log(`[${time}] ${color}[${level}]\x1b[0m ${message}${detailStr}`);
}

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, '../public');

app.use(express.static(publicPath, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

interface TunnelSession {
  subdomain: string;
  ws: WebSocket;
  targetHost: string;
  targetPort: number;
  serviceType: string;
  connectedAt: Date;
}

const activeTunnels = new Map<string, TunnelSession>();

app.get('/', (req, res) => {
  const host = req.headers.host || '';
  const isMainDomain = host === DOMAIN || host === `localhost:${PORT}` || host.startsWith('127.0.0.1');

  if (isMainDomain) {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.sendFile(indexPath);
    }
  }

  return res.send(`
    <html>
      <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
        <h2>⚡ CoreLabs Tunnel — Subdomain Active</h2>
      </body>
    </html>
  `);
});

// Windows GitBash / Linux robust install.sh
app.get(['/install.sh', '/install'], (req, res) => {
  log('INFO', 'Distribution du script d\'installation install.sh');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.send(`#!/usr/bin/env bash
set -e

echo -e "\\033[1;36m"
echo "======================================================"
echo "          CORELABS TUNNEL INSTANT INSTALLER           "
echo "======================================================"
echo -e "\\033[0m"

INSTALL_DIR="$HOME/.corelabs-tunnel"
mkdir -p "$INSTALL_DIR"

NODE_CMD="node"
if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
    NODE_CMD="node.exe"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
    NODE_CMD="/c/Program Files/nodejs/node.exe"
fi

echo "[+] Node.js détecté : $NODE_CMD"
echo "[+] Téléchargement de CoreLabs Tunnel depuis le serveur..."
curl -fsSL "https://${DOMAIN}/cli.js?v=$(date +%s)" -o "$INSTALL_DIR/cli.js" || wget -q "https://${DOMAIN}/cli.js" -O "$INSTALL_DIR/cli.js"

echo -e "\\033[1;32m[✓] Lancement de CoreLabs Tunnel...\\033[0m\\n"
"$NODE_CMD" "$INSTALL_DIR/cli.js" "$@"
`);
});

// Dynamic Installer script for Windows PowerShell
app.get(['/install.ps1', '/ps1'], (req, res) => {
  log('INFO', 'Distribution du script d\'installation install.ps1');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.send(`# CoreLabs Tunnel PowerShell Instant Installer
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          CORELABS TUNNEL INSTANT INSTALLER           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$InstallDir = "$env:USERPROFILE\\.corelabs-tunnel"
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

$NodePath = "node"
if (Get-Command node -ErrorAction SilentlyContinue) {
    $NodePath = "node"
} elseif (Test-Path "C:\\Program Files\\nodejs\\node.exe") {
    $NodePath = "C:\\Program Files\\nodejs\\node.exe"
}

Write-Host "[+] Node.js détecté : $NodePath" -ForegroundColor Green
Write-Host "[+] Téléchargement de CoreLabs Tunnel..." -ForegroundColor Green
$CliPath = "$InstallDir\\cli.js"
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
Invoke-WebRequest -Uri "https://${DOMAIN}/cli.js?v=$Timestamp" -OutFile $CliPath

Write-Host "[✓] Lancement immédiat de CoreLabs Tunnel..." -ForegroundColor Yellow
& $NodePath "$CliPath" $args
`);
});

wss.on('connection', (ws: WebSocket, req) => {
  log('INFO', `Nouvelle connexion WebSocket reçue depuis ${req.socket.remoteAddress}`);
  let assignedSubdomain: string | null = null;

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'REGISTER_TUNNEL') {
        const { subdomain, serviceType, targetHost, targetPort } = msg;
        const cleanSubdomain = (subdomain || `core-${Math.floor(1000 + Math.random() * 9000)}`).toLowerCase();

        await cfManager.createSubdomainRecord(cleanSubdomain);

        assignedSubdomain = cleanSubdomain;
        activeTunnels.set(cleanSubdomain, {
          subdomain: cleanSubdomain,
          ws,
          targetHost,
          targetPort,
          serviceType,
          connectedAt: new Date()
        });

        let publicUrl = `https://${cleanSubdomain}.${DOMAIN}`;
        if (serviceType === 'minecraft') {
          publicUrl = `${cleanSubdomain}.${DOMAIN}:25565`;
        }

        ws.send(JSON.stringify({
          type: 'TUNNEL_READY',
          subdomain: cleanSubdomain,
          publicUrl,
          domain: DOMAIN
        }));
      }

      if (msg.type === 'PONG') {}

    } catch (err: any) {
      log('ERROR', 'Erreur lors du traitement du message WebSocket', { error: err.message });
    }
  });

  ws.on('close', () => {
    if (assignedSubdomain) {
      activeTunnels.delete(assignedSubdomain);
    }
  });
});

app.post('/api/tunnel/create', async (req, res) => {
  const { subdomain, serviceType, targetHost, targetPort } = req.body;
  if (!subdomain) return res.status(400).json({ error: 'Sous-domaine manquant.' });

  await cfManager.createSubdomainRecord(subdomain);

  let publicUrl = `https://${subdomain}.${DOMAIN}`;
  if (serviceType === 'minecraft') {
    publicUrl = `${subdomain}.${DOMAIN}:25565`;
  }

  return res.json({
    success: true,
    subdomain,
    publicUrl,
    domain: DOMAIN,
    message: `Tunnel prêt sur ${publicUrl}`
  });
});

app.use((req, res, next) => {
  const host = req.headers.host || '';
  const subdomainMatch = host.match(/^([a-z0-9-]+)\.tunnel\.corelabs\.network/i);

  if (subdomainMatch) {
    const sub = subdomainMatch[1].toLowerCase();
    const session = activeTunnels.get(sub);

    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'HTTP_REQUEST',
        method: req.method,
        path: req.url,
        headers: req.headers
      }));

      return res.send(`
        <html>
          <head><title>CoreLabs Tunnel — ${sub}.${DOMAIN}</title></head>
          <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:8px; background:#121216;">
              <h2 style="color:#38bdf8;">⚡ CoreLabs Tunnel Connecté</h2>
              <p style="color:#aaa;">Subdomain: <b>${sub}.${DOMAIN}</b></p>
              <p style="color:#22c55e;">● Transfert actif en direct vers client ${session.targetHost}:${session.targetPort}</p>
            </div>
          </body>
        </html>
      `);
    }
  }

  next();
});

server.listen(PORT, () => {
  log('INFO', `======================================================`);
  log('INFO', `  CORELABS ZERO-CONFIG TUNNEL SERVER — Port ${PORT}`);
  log('INFO', `  Domain: ${DOMAIN}`);
  log('INFO', `======================================================`);
});
