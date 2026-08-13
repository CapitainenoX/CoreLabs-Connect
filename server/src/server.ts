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

// Auto-Update & Clean Reinstall Installer for Linux / macOS / GitBash
app.get(['/install.sh', '/install'], (req, res) => {
  log('INFO', 'Distribution du script d\'installation/mise-à-jour install.sh');
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

# 1. Auto-Clean / Uninstall previous versions
if [ -d "$INSTALL_DIR" ]; then
    echo "[+] Nettoyage de l'ancienne version CoreLabs Tunnel..."
    rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"

# 2. Check Node.js or Auto-Install
NODE_CMD="node"
if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
    NODE_CMD="node.exe"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
    NODE_CMD="/c/Program Files/nodejs/node.exe"
else
    echo "[!] Node.js n'est pas détecté. Tentative d'installation automatique..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y nodejs
    elif command -v brew >/dev/null 2>&1; then
        brew install node
    fi
fi

# 3. Download fresh CLI directly from CoreLabs Server
echo "[+] Téléchargement de la dernière version du CLI depuis ${DOMAIN}..."
curl -fsSL "https://${DOMAIN}/cli.js?v=$(date +%s)" -o "$INSTALL_DIR/cli.js" || wget -q "https://${DOMAIN}/cli.js" -O "$INSTALL_DIR/cli.js"

# 4. Create global 'corelabs-tunnel' executable command
echo "[+] Configuration de la commande globale 'corelabs-tunnel'..."
cat << 'EOF' > "$INSTALL_DIR/corelabs-tunnel"
#!/usr/bin/env bash
curl -fsSL "https://${DOMAIN}/install.sh?v=$(date +%s)" | bash "$@"
EOF
chmod +x "$INSTALL_DIR/corelabs-tunnel"

BIN_DIR="/usr/local/bin"
if [ -w "$BIN_DIR" ]; then
    cp "$INSTALL_DIR/corelabs-tunnel" "$BIN_DIR/corelabs-tunnel" 2>/dev/null || true
fi

echo -e "\\033[1;32m[✓] Mise à jour terminée ! Lancement de CoreLabs Tunnel...\\033[0m\\n"
"$NODE_CMD" "$INSTALL_DIR/cli.js" "$@"
`);
});

// Auto-Update & Clean Reinstall Installer for Windows PowerShell
app.get(['/install.ps1', '/ps1'], (req, res) => {
  log('INFO', 'Distribution du script d\'installation/mise-à-jour install.ps1');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.send(`# CoreLabs Tunnel PowerShell Auto-Update & Clean Installer
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          CORELABS TUNNEL INSTANT INSTALLER           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$InstallDir = "$env:USERPROFILE\\.corelabs-tunnel"

# 1. Clean previous installation
if (Test-Path $InstallDir) {
    Write-Host "[+] Suppression et nettoyage de l'ancienne version..." -ForegroundColor Yellow
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $InstallDir | Out-Null

# 2. Check Node.js and Auto-Install if missing via winget
$NodePath = "node"
if (Get-Command node -ErrorAction SilentlyContinue) {
    $NodePath = "node"
} elseif (Test-Path "C:\\Program Files\\nodejs\\node.exe") {
    $NodePath = "C:\\Program Files\\nodejs\\node.exe"
} else {
    Write-Host "[!] Node.js non détecté. Installation automatique via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements --silent
    $NodePath = "node"
}

# 3. Download fresh CLI bundle directly from CoreLabs Server
Write-Host "[+] Téléchargement de la dernière version..." -ForegroundColor Green
$CliPath = "$InstallDir\\cli.js"
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
Invoke-WebRequest -Uri "https://${DOMAIN}/cli.js?v=$Timestamp" -OutFile $CliPath

# 4. Register global system command 'corelabs-tunnel' in Windows Path
$BinDir = "$env:LOCALAPPDATA\\Microsoft\\WindowsApps"
$BatchFile = "$BinDir\\corelabs-tunnel.cmd"
$BatchContent = @"
@echo off
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://${DOMAIN}/install.ps1 | iex" %*
"@
Set-Content -Path $BatchFile -Value $BatchContent -ErrorAction SilentlyContinue

Write-Host "[✓] Commande 'corelabs-tunnel' prête !" -ForegroundColor Green
Write-Host "[✓] Lancement de CoreLabs Tunnel..." -ForegroundColor Yellow

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
