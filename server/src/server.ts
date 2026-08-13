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

app.use(express.static(publicPath, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

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

// Universal bash installer for Linux / macOS / GitBash
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

cat << 'EOF' > "$INSTALL_DIR/corelabs-tunnel"
#!/usr/bin/env bash
curl -fsSL "https://tunnel.corelabs.network/install.sh?v=$(date +%s)" | bash "$@"
EOF
chmod +x "$INSTALL_DIR/corelabs-tunnel"

BIN_DIR="/usr/local/bin"
if [ -w "$BIN_DIR" ]; then
    cp "$INSTALL_DIR/corelabs-tunnel" "$BIN_DIR/corelabs-tunnel" 2>/dev/null || true
fi

CLI_FILE="$INSTALL_DIR/cli.js"
if command -v cygpath >/dev/null 2>&1; then
    CLI_FILE="$(cygpath -w "$INSTALL_DIR/cli.js")"
fi

echo -e "\\033[1;32m[✓] Lancement de CoreLabs Tunnel...\\033[0m\\n"
"$NODE_CMD" "$CLI_FILE" "$@"
`);
});

// PowerShell Installer for Windows (Adds permanently to PATH)
app.get(['/install.ps1', '/ps1'], (req, res) => {
  log('INFO', 'Distribution du script install.ps1');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');

  res.send(`# CoreLabs Tunnel PowerShell Installer with Permanent PATH Integration
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          CORELABS TUNNEL INSTANT INSTALLER           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$InstallDir = "$env:USERPROFILE\\.corelabs-tunnel"
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

# Resolve Node.js
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

# Create cmd shortcut for corelabs-tunnel
$BatchFile = "$InstallDir\\corelabs-tunnel.cmd"
$BatchContent = @"
@echo off
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://${DOMAIN}/install.ps1 | iex" %*
"@
Set-Content -Path $BatchFile -Value $BatchContent -Force

# Permanently add $InstallDir to User PATH environment variable
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "[+] Ajout de 'corelabs-tunnel' au PATH système Windows..." -ForegroundColor Green
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir"
}

Write-Host "[✓] Commande 'corelabs-tunnel' disponible dans la console !" -ForegroundColor Green
Write-Host "[✓] Lancement de CoreLabs Tunnel..." -ForegroundColor Yellow

& "$NodePath" "$CliPath" $args
`);
});

wss.on('connection', (ws: WebSocket, req) => {
  log('INFO', `Connexion WebSocket client reçue depuis ${req.socket.remoteAddress}`);
  let assignedSubdomain: string | null = null;

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'REGISTER_TUNNEL') {
        const { subdomain, serviceType, targetHost, targetPort } = msg;
        const cleanSubdomain = (subdomain || `core-${Math.floor(1000 + Math.random() * 9000)}`).toLowerCase();

        // 1st-level wildcard subdomain to prevent SSL ERR_SSL_VERSION_OR_CIPHER_MISMATCH
        const fullSubdomain = `${cleanSubdomain}-tunnel`;
        await cfManager.createSubdomainRecord(fullSubdomain);

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

        // Generate 1st-level wildcard SSL compatible URLs
        let publicUrl = `https://${cleanSubdomain}-tunnel.${BASE_DOMAIN}`;
        if (serviceType === 'minecraft') {
          publicUrl = `${cleanSubdomain}-tunnel.${BASE_DOMAIN}:25565`;
        }

        ws.send(JSON.stringify({
          type: 'TUNNEL_READY',
          subdomain: cleanSubdomain,
          publicUrl,
          domain: BASE_DOMAIN
        }));
      }

      if (msg.type === 'HTTP_RESPONSE') {
        const { requestId, statusCode, headers, body, subdomain } = msg;
        const session = activeTunnels.get(subdomain || assignedSubdomain || '');

        if (session) {
          const pending = session.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            session.pendingRequests.delete(requestId);

            if (headers) {
              Object.keys(headers).forEach(k => {
                if (k.toLowerCase() !== 'transfer-encoding') {
                  pending.res.setHeader(k, headers[k]);
                }
              });
            }

            pending.res.status(statusCode || 200).send(body || '');
          }
        }
      }

      if (msg.type === 'PONG') {}

    } catch (err: any) {
      log('ERROR', 'Erreur message WS', { error: err.message });
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

  const cleanSubdomain = subdomain.toLowerCase();
  const fullSubdomain = `${cleanSubdomain}-tunnel`;
  await cfManager.createSubdomainRecord(fullSubdomain);

  let publicUrl = `https://${fullSubdomain}.${BASE_DOMAIN}`;
  if (serviceType === 'minecraft') {
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

// Wildcard HTTP Proxy Handler for 1st-level wildcard SSL subdomains
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const subdomainMatch = host.match(/^([a-z0-9-]+)-tunnel\.corelabs\.network/i) || host.match(/^([a-z0-9-]+)\.tunnel\.corelabs\.network/i);

  if (subdomainMatch) {
    const sub = subdomainMatch[1].toLowerCase();
    const session = activeTunnels.get(sub);

    if (session && session.ws.readyState === WebSocket.OPEN) {
      const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      const timeoutId = setTimeout(() => {
        if (session.pendingRequests.has(requestId)) {
          session.pendingRequests.delete(requestId);
          res.status(504).send(`
            <html>
              <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
                <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:8px;">
                  <h3 style="color:#ef4444;">⚠️ CoreLabs Tunnel Timeout (504)</h3>
                  <p style="color:#aaa;">Le service local ${session.targetHost}:${session.targetPort} n'a pas répondu dans le délai imparti.</p>
                </div>
              </body>
            </html>
          `);
        }
      }, 10000);

      session.pendingRequests.set(requestId, { res, timeoutId });

      session.ws.send(JSON.stringify({
        type: 'HTTP_REQUEST',
        requestId,
        method: req.method,
        path: req.url,
        headers: req.headers,
        subdomain: sub
      }));

      return;
    }
  }

  next();
});

server.listen(PORT, () => {
  log('INFO', `======================================================`);
  log('INFO', `  CORELABS TUNNEL SERVER — Port ${PORT}`);
  log('INFO', `  Domain: ${DOMAIN}`);
  log('INFO', `======================================================`);
});
