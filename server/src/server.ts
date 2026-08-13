import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { CloudflareManager } from './cloudflare';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/tunnel-bridge' });

const PORT = process.env.PORT || 5080;
const DOMAIN = process.env.DOMAIN_NAME || 'tunnel.corelabs.network';
const BASE_DOMAIN = 'corelabs.network';
const SERVER_VERSION = '2.1.0';
const cfManager = new CloudflareManager();

function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, detail?: any) {
  const time = new Date().toISOString();
  const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'DEBUG' ? '\x1b[35m' : '\x1b[32m';
  const detailStr = detail ? ` | ${typeof detail === 'object' ? JSON.stringify(detail, null, 2) : detail}` : '';
  console.log(`[${time}] ${color}[${level}]\x1b[0m ${message}${detailStr}`);
}

// AES-256-GCM End-to-End Encryption Engine
function encryptFrame(dataObj: any, secretKeyHex: string): { iv: string; tag: string; payload: string } {
  const key = Buffer.from(secretKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(dataObj);
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return { iv: iv.toString('base64'), tag, payload: encrypted };
}

function decryptFrame(encryptedObj: { iv: string; tag: string; payload: string }, secretKeyHex: string): any {
  const key = Buffer.from(secretKeyHex, 'hex');
  const iv = Buffer.from(encryptedObj.iv, 'base64');
  const tag = Buffer.from(encryptedObj.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedObj.payload, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

app.use(cors());

app.use((req, res, next) => {
  const chunks: Buffer[] = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
});

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
  autoSubTunnels: boolean;
  encryptionKey: string;
  connectedAt: Date;
  pendingRequests: Map<string, PendingRequest>;
}

const activeTunnels = new Map<string, TunnelSession>();
const activeTcpSockets = new Map<string, net.Socket>();

function renderPremiumErrorPage(title: string, subtitle: string, message: string, code: number = 404): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${code} - ${title} | CoreLabs Tunnel</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background-color: #07070a;
      color: #e2e8f0;
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      position: relative;
    }
    .gradient-bg {
      position: absolute;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(168, 85, 247, 0.08) 40%, rgba(0,0,0,0) 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 0;
      pointer-events: none;
      animation: pulseGlow 8s infinite alternate ease-in-out;
    }
    @keyframes pulseGlow {
      0% { opacity: 0.5; transform: translate(-50%, -50%) scale(0.9); }
      100% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
    }
    .card {
      position: relative;
      z-index: 1;
      background: rgba(18, 18, 26, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 3rem 2.5rem;
      max-width: 520px;
      width: 90%;
      text-align: center;
      box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #f87171;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 99px;
      margin-bottom: 1.5rem;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      background: #ef4444;
      border-radius: 50%;
      box-shadow: 0 0 10px #ef4444;
      animation: blink 1.5s infinite;
    }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    h1 {
      font-size: 2.2rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.5rem;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      color: #94a3b8;
      font-size: 1.05rem;
      margin-bottom: 1.5rem;
    }
    .info-box {
      background: rgba(10, 10, 15, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      text-align: left;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.88rem;
      color: #cbd5e1;
      line-height: 1.6;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      color: #ffffff;
      font-weight: 600;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 12px;
      transition: all 0.3s ease;
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 25px rgba(99, 102, 241, 0.4);
    }
    .footer {
      margin-top: 2rem;
      font-size: 0.8rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="gradient-bg"></div>
  <div class="card">
    <div class="badge">
      <div class="badge-dot"></div>
      HTTP ${code} ${title}
    </div>
    <h1>${subtitle}</h1>
    <p class="subtitle">${message}</p>

    <div class="info-box">
      <div>🔒 <b>Sécurité :</b> Chiffrement AES-256-GCM</div>
      <div>⚡ <b>Moteur :</b> CoreLabs Tunnel v${SERVER_VERSION}</div>
      <div>📂 <b>Routage :</b> Support XAMPP / WAMP & Sous-Dossiers</div>
    </div>

    <a href="https://${DOMAIN}" class="btn">Consulter CoreLabs Network</a>

    <div class="footer">
      CoreLabs Tunnel Engine &bull; Support Sous-Dossiers & XAMPP Intégré
    </div>
  </div>
</body>
</html>`;
}

function broadcastClientUpdate(reason: string = 'Mise à jour du serveur') {
  log('INFO', `[Auto-Update Broadcast] Signal envoyé aux clients. Raison: ${reason}`);
  const updatePayload = JSON.stringify({
    type: 'UPDATE_CLIENT',
    version: SERVER_VERSION,
    reason
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(updatePayload);
      } catch (err) {}
    }
  });
}

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

// 1. WILDCARD SUBDOMAIN MULTI-TUNNEL, XAMPP SUBFOLDER & DEEP ROUTER
app.use((req, res, next) => {
  const host = req.headers.host || '';
  
  const subdomainMatch = host.match(/^([a-z0-9-]+)-tunnel\.corelabs\.network/i) || 
                         host.match(/^([a-z0-9-]+)\.tunnel\.corelabs\.network/i);

  if (subdomainMatch) {
    const sub = subdomainMatch[1].toLowerCase();
    
    if (sub !== 'tunnel') {
      const requestPath = req.originalUrl || req.url || '/';
      log('INFO', `[Proxy HTTP Stream] Subdomain: ${sub} Path: ${requestPath} (Method: ${req.method})`);
      const session = activeTunnels.get(sub);

      if (session && session.ws.readyState === WebSocket.OPEN) {
        const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

        const timeoutId = setTimeout(() => {
          if (session.pendingRequests.has(requestId)) {
            session.pendingRequests.delete(requestId);
            log('WARN', `Timeout 504 pour la requête ${requestId} sur ${sub}${requestPath}`);
            res.status(504).send(renderPremiumErrorPage(
              'Gateway Timeout',
              'Service Inaccessible (504)',
              `L'application sur ${session.targetHost}:${session.targetPort} n'a pas répondu à la sous-page <b>${requestPath}</b>.`,
              504
            ));
          }
        }, 15000);

        session.pendingRequests.set(requestId, { res, timeoutId });

        const forwardedHeaders = Object.assign({}, req.headers);
        forwardedHeaders['x-forwarded-host'] = host;
        forwardedHeaders['x-forwarded-proto'] = 'https';
        forwardedHeaders['x-forwarded-server'] = host;

        const rawBodyBuf: Buffer = (req as any).rawBody;
        const requestBodyB64 = rawBodyBuf && rawBodyBuf.length > 0 ? rawBodyBuf.toString('base64') : '';

        const payloadObj = {
          type: 'HTTP_REQUEST',
          requestId,
          method: req.method,
          path: requestPath,
          headers: forwardedHeaders,
          body: requestBodyB64,
          subdomain: sub,
          publicHost: host
        };

        try {
          if (session.encryptionKey) {
            const encryptedFrame = encryptFrame(payloadObj, session.encryptionKey);
            session.ws.send(JSON.stringify({ type: 'ENCRYPTED_FRAME', data: encryptedFrame }));
          } else {
            session.ws.send(JSON.stringify(payloadObj));
          }
        } catch (wsErr: any) {
          log('ERROR', 'Erreur envoi WebSocket HTTP_REQUEST', wsErr.message);
        }

        return;
      } else {
        log('WARN', `Sous-domaine inactif pour la page: ${sub}${requestPath}`);
        return res.status(404).send(renderPremiumErrorPage(
          'Page Inaccessible',
          'Tunnel Non Connecté',
          `Le tunnel <b>${sub}-tunnel.${BASE_DOMAIN}</b> n'est actuellement pas connecté.`,
          404
        ));
      }
    }
  }

  next();
});

// Admin update broadcast trigger API
app.post('/api/admin/broadcast-update', (req, res) => {
  broadcastClientUpdate((req.body && req.body.reason) || 'Mise à jour déclenchée par administrateur');
  return res.json({ success: true, message: 'Signal de mise à jour envoyé à tous les clients.' });
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
        <h2>⚡ CoreLabs Tunnel Server v${SERVER_VERSION}</h2>
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
  const registeredSubdomains: string[] = [];

  ws.on('message', async (data: string) => {
    try {
      let msg = JSON.parse(data.toString());

      if (msg.type === 'ENCRYPTED_FRAME' && msg.data) {
        const anySub = registeredSubdomains[0];
        const session = anySub ? activeTunnels.get(anySub) : null;
        if (session && session.encryptionKey) {
          msg = decryptFrame(msg.data, session.encryptionKey);
        }
      }

      if (msg.type === 'REGISTER_TUNNEL' || msg.type === 'REGISTER_MULTI_TUNNEL') {
        const tunnelsToRegister = msg.tunnels || [{
          subdomain: msg.subdomain,
          serviceType: msg.serviceType,
          targetHost: msg.targetHost,
          targetPort: msg.targetPort,
          autoSubTunnels: msg.autoSubTunnels
        }];

        const sessionEncryptionKey = msg.encryptionKey || crypto.randomBytes(32).toString('hex');
        const registeredResults = [];

        for (const t of tunnelsToRegister) {
          const cleanSubdomain = (t.subdomain || `core-${Math.floor(1000 + Math.random() * 9000)}`).toLowerCase();
          await cfManager.createSubdomainRecord(`${cleanSubdomain}-tunnel`);

          registeredSubdomains.push(cleanSubdomain);
          activeTunnels.set(cleanSubdomain, {
            subdomain: cleanSubdomain,
            ws,
            targetHost: t.targetHost,
            targetPort: t.targetPort,
            serviceType: t.serviceType,
            autoSubTunnels: t.autoSubTunnels !== false,
            encryptionKey: sessionEncryptionKey,
            connectedAt: new Date(),
            pendingRequests: new Map()
          });

          let publicUrl = `https://${cleanSubdomain}-tunnel.${BASE_DOMAIN}`;
          if (t.serviceType && t.serviceType.startsWith('minecraft')) {
            publicUrl = `${cleanSubdomain}-tunnel.${BASE_DOMAIN}:25565`;
          }

          log('INFO', `[Tunnel Registered AES-256-GCM] Subdomain: ${cleanSubdomain} -> ${t.targetHost}:${t.targetPort} -> Public: ${publicUrl}`);

          registeredResults.push({
            subdomain: cleanSubdomain,
            publicUrl,
            targetHost: t.targetHost,
            targetPort: t.targetPort
          });
        }

        ws.send(JSON.stringify({
          type: 'TUNNEL_READY',
          tunnels: registeredResults,
          domain: BASE_DOMAIN,
          serverVersion: SERVER_VERSION,
          encryptionKey: sessionEncryptionKey
        }));
      }

      if (msg.type === 'HTTP_RESPONSE') {
        const { requestId, statusCode, headers, body, isBase64, subdomain } = msg;
        const session = activeTunnels.get(subdomain || '');

        if (session) {
          const pending = session.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            session.pendingRequests.delete(requestId);

            if (headers) {
              Object.keys(headers).forEach(k => {
                const lowerK = k.toLowerCase();
                if (lowerK !== 'transfer-encoding' && lowerK !== 'content-length' && lowerK !== 'content-encoding') {
                  let headerValue = headers[k];

                  if (lowerK === 'location' && typeof headerValue === 'string') {
                    const publicHost = `${session.subdomain}-tunnel.${BASE_DOMAIN}`;
                    const targetHostEscaped = session.targetHost.replace(/\./g, '\\.');

                    headerValue = headerValue
                      .replace(new RegExp(`http:\\/\\/${targetHostEscaped}(:\\d+)?`, 'gi'), `https://${publicHost}`)
                      .replace(/http:\/\/(?:127\.0\.0\.1|localhost|(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3})(?::\d+)?/gi, `https://${publicHost}`);
                    
                    log('INFO', `[Redirect Rewritten 301/302] Location header -> ${headerValue}`);
                  }

                  pending.res.setHeader(k, headerValue);
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

  ws.onclose = () => {
    registeredSubdomains.forEach(sub => {
      activeTunnels.delete(sub);
      log('INFO', `Tunnel fermé: ${sub}-tunnel.${BASE_DOMAIN}`);
    });
  };
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

process.on('SIGTERM', () => {
  broadcastClientUpdate('Redémarrage serveur (SIGTERM)');
  setTimeout(() => process.exit(0), 1500);
});

process.on('SIGINT', () => {
  broadcastClientUpdate('Arrêt serveur (SIGINT)');
  setTimeout(() => process.exit(0), 1500);
});

server.listen(PORT, () => {
  log('INFO', `======================================================`);
  log('INFO', `  CORELABS TUNNEL SERVER v${SERVER_VERSION} — Port ${PORT}`);
  log('INFO', `  Domain: ${DOMAIN}`);
  log('INFO', `======================================================`);
});
