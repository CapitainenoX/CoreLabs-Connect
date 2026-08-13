import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { CloudflareManager } from './cloudflare';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/tunnel-bridge' });

const PORT = process.env.PORT || 5080;
const DOMAIN = process.env.DOMAIN_NAME || 'tunnel.corelabs.network';
const BASE_DOMAIN = 'corelabs.network';
const cfManager = new CloudflareManager();

function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, detail?: any) {
  const time = new Date().toISOString();
  const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'DEBUG' ? '\x1b[35m' : '\x1b[32m';
  const detailStr = detail ? ` | ${typeof detail === 'object' ? JSON.stringify(detail, null, 2) : detail}` : '';
  console.log(`[${time}] ${color}[${level}]\x1b[0m ${message}${detailStr}`);
}

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, '../public');

interface PendingRequest {
  res: express.Response;
  timeoutId: NodeJS.Timeout;
}

interface TunnelSession {
  subdomain: string;
  ws: WebSocket;
  targetHost: string;
  targetPort: number;
  serviceType: string;
  connectedAt: Date;
  pendingRequests: Map<string, PendingRequest>;
}

const activeTunnels = new Map<string, TunnelSession>();
const activeTcpSockets = new Map<string, net.Socket>();

function parseMinecraftHandshakeHost(buffer: Buffer): string | null {
  try {
    let offset = 0;

    function readVarInt(): number {
      let value = 0;
      let size = 0;
      let b: number;
      do {
        if (offset >= buffer.length) return -1;
        b = buffer[offset++];
        value |= (b & 0x7f) << (size * 7);
        size++;
        if (size > 5) return -1;
      } while ((b & 0x80) === 0x80);
      return value;
    }

    const packetLength = readVarInt();
    const packetId = readVarInt();
    if (packetId !== 0x00) return null;

    const protocolVersion = readVarInt();
    const stringLength = readVarInt();

    if (stringLength <= 0 || offset + stringLength > buffer.length) return null;

    const host = buffer.toString('utf-8', offset, offset + stringLength);
    return host;
  } catch (err) {
    return null;
  }
}

// 1. WILDCARD SUBDOMAIN MULTI-PAGE HTTP PROXY
app.use((req, res, next) => {
  const host = req.headers.host || '';
  
  const subdomainMatch = host.match(/^([a-z0-9-]+)-tunnel\.corelabs\.network/i) || 
                         host.match(/^([a-z0-9-]+)\.tunnel\.corelabs\.network/i);

  if (subdomainMatch) {
    const sub = subdomainMatch[1].toLowerCase();
    
    if (sub !== 'tunnel') {
      const requestPath = req.originalUrl || req.url || '/';
      log('INFO', `[Multi-Page Request] Subdomain: ${sub} Path: ${requestPath} (Method: ${req.method})`);
      const session = activeTunnels.get(sub);

      if (session && session.ws.readyState === WebSocket.OPEN) {
        const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

        const timeoutId = setTimeout(() => {
          if (session.pendingRequests.has(requestId)) {
            session.pendingRequests.delete(requestId);
            log('WARN', `Timeout 504 pour la requête ${requestId} sur ${sub}${requestPath}`);
            res.status(504).send(`
              <html>
                <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
                  <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:8px;">
                    <h3 style="color:#ef4444;">⚠️ CoreLabs Tunnel Timeout (504)</h3>
                    <p style="color:#aaa;">Le service local ${session.targetHost}:${session.targetPort} n'a pas répondu à la page ${requestPath}.</p>
                  </div>
                </body>
              </html>
            `);
          }
        }, 12000);

        session.pendingRequests.set(requestId, { res, timeoutId });

        // Forward full HTTP request with original URL
        session.ws.send(JSON.stringify({
          type: 'HTTP_REQUEST',
          requestId,
          method: req.method,
          path: requestPath,
          headers: req.headers,
          subdomain: sub
        }));

        return;
      } else {
        log('WARN', `Sous-domaine inactif pour la page: ${sub}${requestPath}`);
        return res.status(404).send(`
          <html>
            <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
              <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:8px;">
                <h3 style="color:#eab308;">⚠️ Tunnel Non Connecté</h3>
                <p style="color:#aaa;">Le tunnel <b>${sub}</b> n'est actuellement pas connecté.</p>
                <p style="color:#8a8a9a; font-size:0.85rem;">Lancez la commande <code>corelabs-tunnel</code> sur votre ordinateur pour ouvrir ce sous-domaine.</p>
              </div>
            </body>
          </html>
        `);
      }
    }
  }

  next();
});

// 2. STATIC LANDING PAGE
app.use(express.static(publicPath, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.get('/', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(indexPath);
  }

  return res.send(`
    <html>
      <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
        <h2>⚡ CoreLabs Tunnel Server</h2>
      </body>
    </html>
  `);
});

// Installers
app.get(['/install.sh', '/install'], (req, res) => {
  log('INFO', 'Distribution du script install.sh');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');

  res.send(`#!/usr/bin/env bash
set -e

echo -e "\\033[1;36m"
echo "======================================================"
echo "          CORELABS TUNNEL INSTANT INSTALLER           "
echo "======================================================"
echo -e "\\033[0m"

if command -v cygpath >/dev/null 2>&1 && [ -n "$USERPROFILE" ]; then
    INSTALL_DIR="$(cygpath -u "$USERPROFILE")/.corelabs-tunnel"
else
    INSTALL_DIR="$HOME/.corelabs-tunnel"
fi

if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
fi
mkdir -p "$INSTALL_DIR"

NODE_CMD="node"
if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
    NODE_CMD="node.exe"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
    NODE_CMD="/c/Program Files/nodejs/node.exe"
fi

echo "[+] Téléchargement de la dernière version..."
curl -fsSL "https://${DOMAIN}/cli.js?v=$(date +%s)" -o "$INSTALL_DIR/cli.js" || wget -q "https://${DOMAIN}/cli.js" -O "$INSTALL_DIR/cli.js"

CLI_FILE="$INSTALL_DIR/cli.js"
if command -v cygpath >/dev/null 2>&1; then
    CLI_FILE="$(cygpath -w "$INSTALL_DIR/cli.js")"
fi

echo -e "\\033[1;32m[✓] Lancement de CoreLabs Tunnel...\\033[0m\\n"
"$NODE_CMD" "$CLI_FILE" "$@"
`);
});

app.get(['/install.ps1', '/ps1'], (req, res) => {
  log('INFO', 'Distribution du script install.ps1');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');

  res.send(`# CoreLabs Tunnel PowerShell Installer
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          CORELABS TUNNEL INSTANT INSTALLER           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$InstallDir = "$env:USERPROFILE\\.corelabs-tunnel"
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

$NodePath = "node"
$PossiblePaths = @(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    "$env:LOCALAPPDATA\\Programs\\node\\node.exe",
    "$env:LOCALAPPDATA\\Microsoft\\WinGet\\Links\\node.exe"
)

foreach ($p in $PossiblePaths) {
    if (Test-Path $p) {
        $NodePath = $p
        break
    }
}

if (-not $NodePath) {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $NodePath = "node"
    } else {
        Write-Host "[!] Node.js non détecté. Installation automatique..." -ForegroundColor Yellow
        winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements --silent
        foreach ($p in $PossiblePaths) {
            if (Test-Path $p) {
                $NodePath = $p
                break
            }
        }
        if (-not $NodePath) { $NodePath = "node" }
    }
}

Write-Host "[+] Téléchargement de la dernière version..." -ForegroundColor Green
$CliPath = "$InstallDir\\cli.js"
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri "https://${DOMAIN}/cli.js?v=$Timestamp" -OutFile $CliPath

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir"
}

Write-Host "[✓] Lancement de CoreLabs Tunnel..." -ForegroundColor Yellow
& "$NodePath" "$CliPath" $args
`);
});

// WEBSOCKET BRIDGE
wss.on('connection', (ws: WebSocket, req) => {
  log('INFO', `Connexion WebSocket client reçue depuis ${req.socket.remoteAddress}`);
  let assignedSubdomain: string | null = null;

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'REGISTER_TUNNEL') {
        const { subdomain, serviceType, targetHost, targetPort } = msg;
        const cleanSubdomain = (subdomain || `core-${Math.floor(1000 + Math.random() * 9000)}`).toLowerCase();

        await cfManager.createSubdomainRecord(`${cleanSubdomain}-tunnel`);

        assignedSubdomain = cleanSubdomain;
        activeTunnels.set(cleanSubdomain, {
          subdomain: cleanSubdomain,
          ws,
          targetHost,
          targetPort,
          serviceType,
          connectedAt: new Date(),
          pendingRequests: new Map()
        });

        let publicUrl = `https://${cleanSubdomain}-tunnel.${BASE_DOMAIN}`;
        if (serviceType.startsWith('minecraft')) {
          publicUrl = `${cleanSubdomain}-tunnel.${BASE_DOMAIN}:25565`;
        }

        log('INFO', `[Tunnel Enregistré] Subdomain: ${cleanSubdomain} -> Public URL: ${publicUrl}`);

        ws.send(JSON.stringify({
          type: 'TUNNEL_READY',
          subdomain: cleanSubdomain,
          publicUrl,
          domain: BASE_DOMAIN
        }));
      }

      if (msg.type === 'HTTP_RESPONSE') {
        const { requestId, statusCode, headers, body, isBase64, subdomain } = msg;
        const session = activeTunnels.get(subdomain || assignedSubdomain || '');

        if (session) {
          const pending = session.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            session.pendingRequests.delete(requestId);

            if (headers) {
              Object.keys(headers).forEach(k => {
                const lowerK = k.toLowerCase();
                if (lowerK !== 'transfer-encoding' && lowerK !== 'content-length' && lowerK !== 'content-encoding') {
                  pending.res.setHeader(k, headers[k]);
                }
              });
            }

            const responseBuffer = isBase64 ? Buffer.from(body || '', 'base64') : Buffer.from(body || '');
            pending.res.setHeader('content-length', responseBuffer.length);
            pending.res.status(statusCode || 200).send(responseBuffer);
          }
        }
      }

      if (msg.type === 'TCP_DATA') {
        const { connectionId, data: b64Data } = msg;
        const tcpSocket = activeTcpSockets.get(connectionId);
        if (tcpSocket && !tcpSocket.destroyed) {
          tcpSocket.write(Buffer.from(b64Data, 'base64'));
        }
      }

      if (msg.type === 'TCP_CLOSE') {
        const { connectionId } = msg;
        const tcpSocket = activeTcpSockets.get(connectionId);
        if (tcpSocket) {
          tcpSocket.destroy();
          activeTcpSockets.delete(connectionId);
        }
      }

    } catch (err: any) {
      log('ERROR', 'Erreur traitement WebSocket', { error: err.message, stack: err.stack });
    }
  });

  ws.on('close', () => {
    if (assignedSubdomain) {
      activeTunnels.delete(assignedSubdomain);
      log('INFO', `Tunnel fermé: ${assignedSubdomain}-tunnel.${BASE_DOMAIN}`);
    }
  });
});

app.post('/api/tunnel/create', async (req, res) => {
  const { subdomain, serviceType, targetHost, targetPort } = req.body;
  if (!subdomain) return res.status(400).json({ error: 'Sous-domaine manquant.' });

  const cleanSubdomain = subdomain.toLowerCase();
  const fullSubdomain = `${cleanSubdomain}-tunnel`;
  await cfManager.createSubdomainRecord(fullSubdomain);

  let publicUrl = `https://${fullSubdomain}.${BASE_DOMAIN}`;
  if (serviceType.startsWith('minecraft')) {
    publicUrl = `${fullSubdomain}.${BASE_DOMAIN}:25565`;
  }

  return res.json({
    success: true,
    subdomain: cleanSubdomain,
    publicUrl,
    domain: BASE_DOMAIN,
    message: `Tunnel prêt sur ${publicUrl}`
  });
});

// 3. MINECRAFT TCP ENGINE (Port 25565)
const MC_TCP_PORT = 25565;
const mcTcpServer = net.createServer((socket) => {
  const connectionId = `mc_tcp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  activeTcpSockets.set(connectionId, socket);

  let handshakeParsed = false;
  let targetSession: TunnelSession | null = null;

  socket.on('data', (firstChunk) => {
    if (!handshakeParsed) {
      handshakeParsed = true;

      const rawHost = parseMinecraftHandshakeHost(firstChunk);
      log('INFO', `[Minecraft Handshake Entrant] Host: "${rawHost}" (${socket.remoteAddress})`);

      if (rawHost) {
        const cleanHost = rawHost.split('\0')[0].split(':')[0].toLowerCase();
        const match = cleanHost.match(/^([a-z0-9-]+)-tunnel/i) || cleanHost.match(/^([a-z0-9-]+)\.tunnel/i) || cleanHost.match(/^([a-z0-9-]+)/i);

        if (match) {
          const sub = match[1].toLowerCase();
          targetSession = activeTunnels.get(sub) || null;
        }
      }

      if (!targetSession) {
        for (const session of activeTunnels.values()) {
          if (session.serviceType.startsWith('minecraft') && session.ws.readyState === WebSocket.OPEN) {
            targetSession = session;
            break;
          }
        }
      }

      if (!targetSession) {
        log('WARN', `Joueur Minecraft refusé: Aucun tunnel Minecraft trouvé.`);
        socket.destroy();
        activeTcpSockets.delete(connectionId);
        return;
      }

      log('INFO', `[Minecraft Router] Joueur connecté au tunnel: ${targetSession.subdomain} -> ${targetSession.targetHost}:${targetSession.targetPort}`);

      targetSession.ws.send(JSON.stringify({
        type: 'TCP_CONNECT',
        connectionId,
        subdomain: targetSession.subdomain
      }));

      targetSession.ws.send(JSON.stringify({
        type: 'TCP_DATA',
        connectionId,
        data: firstChunk.toString('base64')
      }));

    } else {
      if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
        targetSession.ws.send(JSON.stringify({
          type: 'TCP_DATA',
          connectionId,
          data: firstChunk.toString('base64')
        }));
      }
    }
  });

  socket.on('close', () => {
    activeTcpSockets.delete(connectionId);
    if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
      targetSession.ws.send(JSON.stringify({
        type: 'TCP_CLOSE',
        connectionId
      }));
    }
  });

  socket.on('error', () => {
    activeTcpSockets.delete(connectionId);
  });
});

mcTcpServer.listen(MC_TCP_PORT, () => {
  log('INFO', `[Minecraft TCP Engine] Écoute des joueurs Minecraft sur le port TCP ${MC_TCP_PORT}`);
});

server.listen(PORT, () => {
  log('INFO', `======================================================`);
  log('INFO', `  CORELABS TUNNEL SERVER — Port ${PORT}`);
  log('INFO', `  Domain: ${DOMAIN}`);
  log('INFO', `======================================================`);
});
