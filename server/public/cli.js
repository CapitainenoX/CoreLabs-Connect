#!/usr/bin/env node
const http = require('http');
const https = require('https');
const readline = require('readline');
const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { exec, spawn } = require('child_process');

const SERVER_HOST = 'tunnel.corelabs.network';
const BASE_DOMAIN = 'corelabs.network';
let lastHotUpdate = null;
let currentEncryptionKey = null;

function debugLog(msg, data) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  if (data) console.log(`\x1b[90m[${timestamp}] [DEBUG] ${msg}\x1b[0m`, data);
  else console.log(`\x1b[90m[${timestamp}] [DEBUG] ${msg}\x1b[0m`);
}

function cleanSubdomainInput(inputStr) {
  if (!inputStr) return `core-${Math.floor(1000 + Math.random() * 9000)}`;
  let str = inputStr.trim().toLowerCase();
  str = str.replace(/^https?:\/\//i, '');
  str = str.split('/')[0];
  str = str.split(':')[0];
  str = str.replace(/\.corelabs\.network$/i, '');
  str = str.replace(/\.tunnel$/i, '');
  str = str.replace(/-tunnel$/i, '');
  str = str.replace(/[^a-z0-9-]/g, '');
  if (!str) return `core-${Math.floor(1000 + Math.random() * 9000)}`;
  return str;
}

function rewriteLocationHeader(locationHeader, publicHost, targetHost) {
  if (!locationHeader || typeof locationHeader !== 'string') return locationHeader;
  
  if (/^https?:\/\/[a-z0-9-]+\.corelabs\.network/i.test(locationHeader)) {
    return locationHeader;
  }

  const targetEscaped = targetHost.replace(/\./g, '\\.');

  let rewritten = locationHeader
    .replace(new RegExp(`^https?:\\/\\/${targetEscaped}(:\\d+)?`, 'gi'), `https://${publicHost}`)
    .replace(/^https?:\/\/(?:127\.0\.0\.1|localhost|(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3})(?::\d+)?/gi, `https://${publicHost}`);

  return rewritten;
}

function renderAsciiBanner(stepText = '') {
  console.clear();
  console.log('\x1b[36m%s\x1b[0m', `
  ██████╗ ██████╗ ██████╗ ███████╗██╗      █████╗ ██████╗ ███████╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝██║     ██╔══██╗██╔══██╗██╔════╝
 ██║     ██║   ██║██████╔╝█████╗  ██║     ███████║██████╔╝███████╗
 ██║     ██║   ██║██╔══██╗██╔══╝  ██║     ██╔══██║██╔══██╗╚════██║
 ╚██████╗╚██████╔╝██║  ██║███████╗███████╗██║  ██║██████╔╝███████║
  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝
                     T U N N E L   v2.6
  `);
  if (stepText) {
    console.log(` \x1b[46m\x1b[30m ${stepText} \x1b[0m\n`);
  }
}

// AES-256-GCM End-to-End Encryption Engine
function encryptFrame(dataObj, secretKeyHex) {
  const key = Buffer.from(secretKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(dataObj);
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return { iv: iv.toString('base64'), tag, payload: encrypted };
}

function decryptFrame(encryptedObj, secretKeyHex) {
  const key = Buffer.from(secretKeyHex, 'hex');
  const iv = Buffer.from(encryptedObj.iv, 'base64');
  const tag = Buffer.from(encryptedObj.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedObj.payload, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function getInstallDir() {
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    return path.join(process.env.USERPROFILE, '.corelabs-tunnel');
  }
  return path.join(os.homedir(), '.corelabs-tunnel');
}

function saveActiveSession(sessionInfo) {
  try {
    const dir = getInstallDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const sessionPath = path.join(dir, 'active-session.json');
    fs.writeFileSync(sessionPath, JSON.stringify(sessionInfo, null, 2));
  } catch (err) {
    debugLog('Erreur sauvegarde session:', err.message);
  }
}

function loadActiveSession() {
  try {
    const sessionPath = path.join(getInstallDir(), 'active-session.json');
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    debugLog('Erreur lecture session:', err.message);
  }
  return null;
}

function configureAutoStart(enable) {
  try {
    const installDir = getInstallDir();
    const cliPath = path.join(installDir, 'cli.js');

    if (process.platform === 'win32') {
      const startupFolder = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const vbsPath = path.join(startupFolder, 'CoreLabsTunnelAutoStart.vbs');

      if (enable) {
        const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "node.exe """ & "${cliPath.replace(/\\/g, '\\\\')}" & """ --auto-resume", 0, False\n`;
        fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
        debugLog('[AUTO-START] Raccourci VBS de démarrage Windows créé.');
      } else {
        if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
        debugLog('[AUTO-START] Démarrage automatique Windows désactivé.');
      }
    } else {
      const cronCmd = `@reboot node "${cliPath}" --auto-resume >/dev/null 2>&1\n`;
      exec(`(crontab -l 2>/dev/null | grep -v "CoreLabsTunnelAutoStart"; echo "${cronCmd}") | crontab -`);
    }
  } catch (err) {
    debugLog('Erreur configuration Démarrage Automatique:', err.message);
  }
}

function applyLiveHotUpdate() {
  const timestamp = Date.now();
  const updateUrl = `https://${SERVER_HOST}/cli.js?v=${timestamp}`;
  
  https.get(updateUrl, (res) => {
    let newCodeStr = '';
    res.on('data', chunk => newCodeStr += chunk);
    res.on('end', () => {
      try {
        const installDir = getInstallDir();
        const currentCliPath = path.join(installDir, 'cli.js');
        fs.writeFileSync(currentCliPath, newCodeStr, 'utf-8');
        
        const script = new vm.Script(newCodeStr, { filename: 'cli.js' });
        const context = vm.createContext(Object.assign({}, global, {
          require, process, console, Buffer, setTimeout, setInterval, clearTimeout, clearInterval
        }));
        script.runInContext(context);
        lastHotUpdate = new Date().toLocaleTimeString('fr-FR');
        debugLog(`[HOT-RELOAD] Code mis à jour en direct à ${lastHotUpdate} !`);
      } catch (err) {
        debugLog('Erreur Hot-Reload:', err.message);
      }
    });
  }).on('error', (err) => {
    debugLog('Erreur réseau Hot-Reload:', err.message);
  });
}

function promptInput(question, defaultVal, stepBadge = '') {
  return new Promise(resolve => {
    if (process.stdin.isPaused()) process.stdin.resume();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const qText = defaultVal ? `\x1b[33m? ${question}\x1b[0m \x1b[90m(${defaultVal})\x1b[0m : ` : `\x1b[33m? ${question}\x1b[0m : `;
    rl.question(qText, answer => {
      rl.close();
      if (process.stdin.isPaused()) process.stdin.resume();
      resolve(answer.trim() || defaultVal);
    });
  });
}

function selectMenu(title, choices, stepBadge = '') {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }

    function render() {
      renderAsciiBanner(stepBadge);
      console.log(`\x1b[1m\x1b[33m? ${title}\x1b[0m \x1b[90m(Flèches ↑/↓ et Entrée)\x1b[0m\n`);

      choices.forEach((choice, idx) => {
        if (idx === selectedIndex) {
          console.log(` \x1b[36m\x1b[1m❯ ${choice.label}\x1b[0m`);
        } else {
          console.log(`   \x1b[90m${choice.label}\x1b[0m`);
        }
      });
    }

    render();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    function onKeypress(_, key) {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        process.exit(0);
      }
      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', onKeypress);
        resolve(choices[selectedIndex].value);
      }
    }

    process.stdin.on('keypress', onKeypress);
  });
}

class ZeroDepWebSocketClient {
  constructor(urlStr) {
    this.url = urlStr;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connect();
  }

  connect() {
    const isSecure = this.url.startsWith('wss://');
    const host = SERVER_HOST;
    const port = isSecure ? 443 : 80;
    const secKey = crypto.randomBytes(16).toString('base64');

    const reqOptions = {
      hostname: host,
      port: port,
      path: '/tunnel-bridge',
      method: 'GET',
      headers: {
        'Host': host,
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': secKey,
        'Sec-WebSocket-Version': '13',
        'User-Agent': 'CoreLabs-Tunnel-Client/1.0'
      }
    };

    const req = (isSecure ? https : http).request(reqOptions);

    req.on('upgrade', (res, socket, head) => {
      this.socket = socket;
      if (this.onopen) this.onopen();

      if (head && head.length > 0) {
        this.handleData(head);
      }

      socket.on('data', (chunk) => {
        this.handleData(chunk);
      });

      socket.on('close', () => {
        if (this.onclose) this.onclose();
      });

      socket.on('error', (err) => {
        if (this.onerror) this.onerror(err);
      });
    });

    req.on('error', (err) => {
      if (this.onerror) this.onerror(err);
    });

    req.end();
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const secondByte = this.buffer[1];
      let payloadLen = secondByte & 0x7f;
      let headerLen = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) break;
        payloadLen = this.buffer.readUInt16BE(2);
        headerLen = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) break;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        headerLen = 10;
      }

      if (this.buffer.length < headerLen + payloadLen) break;

      const payload = this.buffer.slice(headerLen, headerLen + payloadLen);
      this.buffer = this.buffer.slice(headerLen + payloadLen);

      if (this.onmessage) {
        this.onmessage({ data: payload.toString('utf-8') });
      }
    }
  }

  send(dataStr) {
    if (!this.socket || this.socket.destroyed) return;
    const payload = Buffer.from(dataStr);
    const length = payload.length;
    let headerLen = 2;
    if (length >= 126 && length <= 65535) headerLen = 4;
    else if (length > 65535) headerLen = 10;

    const maskKey = crypto.randomBytes(4);
    const frame = Buffer.alloc(headerLen + 4 + length);

    frame[0] = 0x81;

    if (length < 126) {
      frame[1] = 0x80 | length;
    } else if (length <= 65535) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(length, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(length), 2);
    }

    const maskOffset = headerLen;
    maskKey.copy(frame, maskOffset);

    const payloadOffset = maskOffset + 4;
    for (let i = 0; i < length; i++) {
      frame[payloadOffset + i] = payload[i] ^ maskKey[i % 4];
    }

    this.socket.write(frame);
  }
}

function checkLocalPortActive(host, port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(1200);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

async function discoverLANDevices() {
  return new Promise(resolve => {
    const devices = [];
    const localIP = getLocalIP();
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'arp -a' : 'arp -n';

    exec(cmd, (err, stdout) => {
      if (!err && stdout) {
        const lines = stdout.split('\n');
        const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
        for (const line of lines) {
          const match = line.match(ipRegex);
          if (match) {
            const ip = match[1];
            if (ip !== '127.0.0.1' && !ip.startsWith('224.') && !ip.endsWith('.255')) {
              let name = `Appareil LAN (${ip})`;
              if (ip.endsWith('.1')) name = 'Routeur / Box Internet';
              else if (ip === localIP) name = `Cette Machine (${os.hostname()})`;
              devices.push({ ip, name });
            }
          }
        }
      }
      if (!devices.some(d => d.ip === localIP)) {
        devices.unshift({ ip: localIP, name: `Cette Machine (${os.hostname()})` });
      }
      resolve(devices);
    });
  });
}

const localTcpSockets = new Map();

function handleTcpConnect(msg, targetHost, targetPort, sendWsMessage) {
  const { connectionId } = msg;
  debugLog(`[Minecraft TCP] Connexion entrant [${connectionId}] -> ${targetHost}:${targetPort}`);

  const localSocket = new net.Socket();
  localTcpSockets.set(connectionId, localSocket);

  localSocket.connect(targetPort, targetHost, () => {
    debugLog(`[Minecraft TCP] Connecté au serveur Minecraft local [${connectionId}]`);
  });

  localSocket.on('data', (chunk) => {
    sendWsMessage({
      type: 'TCP_DATA',
      connectionId,
      data: chunk.toString('base64')
    });
  });

  localSocket.on('close', () => {
    localTcpSockets.delete(connectionId);
    sendWsMessage({
      type: 'TCP_CLOSE',
      connectionId
    });
  });

  localSocket.on('error', (err) => {
    debugLog(`[Minecraft TCP Error] [${connectionId}]`, err.message);
    localTcpSockets.delete(connectionId);
  });
}

// XAMPP / Apache Subfolder Deep Routing & Multi-Page Proxy Handler
function handleIncomingTunnelRequest(reqMsg, tunnelsList, sendWsMessage) {
  debugLog(`Requête HTTP page [${reqMsg.requestId}] Subdomain: ${reqMsg.subdomain}`, { method: reqMsg.method, path: reqMsg.path });

  const cleanSub = cleanSubdomainInput(reqMsg.subdomain);
  const publicHost = reqMsg.publicHost || `${cleanSub}-tunnel.${BASE_DOMAIN}`;
  let reqPath = reqMsg.path || '/';

  const targetTunnel = tunnelsList.find(t => cleanSubdomainInput(t.subdomain) === cleanSub) || tunnelsList[0];
  let actualTargetHost = targetTunnel.targetHost || '127.0.0.1';
  let actualTargetPort = targetTunnel.targetPort || 80;
  let targetSubfolder = targetTunnel.targetSubfolder || '';

  if (targetTunnel.autoSubTunnels !== false && reqPath.startsWith('/lan/')) {
    const lanMatch = reqPath.match(/^\/lan\/(\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3})\/(\d+)(\/.*)?$/);
    if (lanMatch) {
      actualTargetHost = lanMatch[1].replace(/-/g, '.');
      actualTargetPort = parseInt(lanMatch[2], 10) || 80;
      reqPath = lanMatch[3] || '/';
      targetSubfolder = '';
      debugLog(`[LAN Sub-Tunnel Triggered] Route vers appareil LAN -> ${actualTargetHost}:${actualTargetPort}${reqPath}`);
    }
  }

  // Prepend target subfolder if configured and not already included in path
  if (targetSubfolder) {
    const cleanFolder = targetSubfolder.startsWith('/') ? targetSubfolder : `/${targetSubfolder}`;
    if (!reqPath.startsWith(cleanFolder)) {
      reqPath = `${cleanFolder}${reqPath.startsWith('/') ? '' : '/'}${reqPath}`;
    }
  }

  const forwardHeaders = Object.assign({}, reqMsg.headers || {});
  forwardHeaders.host = (actualTargetHost === '127.0.0.1' || actualTargetHost === 'localhost') ? 'localhost' : ((actualTargetPort === 80 || actualTargetPort === 443) ? actualTargetHost : `${actualTargetHost}:${actualTargetPort}`);
  forwardHeaders['x-forwarded-host'] = publicHost;
  forwardHeaders['x-forwarded-proto'] = 'https';
  forwardHeaders['x-forwarded-server'] = publicHost;
  delete forwardHeaders['accept-encoding'];
  delete forwardHeaders['connection'];

  const isHttpsTarget = actualTargetPort === 443;
  const httpModule = isHttpsTarget ? https : http;

  const options = {
    hostname: actualTargetHost,
    port: actualTargetPort,
    path: reqPath,
    method: reqMsg.method || 'GET',
    headers: forwardHeaders,
    rejectUnauthorized: false
  };

  const localReq = httpModule.request(options, (localRes) => {
    let bodyChunks = [];
    localRes.on('data', chunk => bodyChunks.push(chunk));
    localRes.on('end', () => {
      let fullBuffer = Buffer.concat(bodyChunks);
      const contentType = (localRes.headers['content-type'] || '').toLowerCase();
      const headers = Object.assign({}, localRes.headers);

      if (headers.location && typeof headers.location === 'string') {
        headers.location = rewriteLocationHeader(headers.location, publicHost, actualTargetHost);
      }

      if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('css')) {
        let contentStr = fullBuffer.toString('utf-8');

        const targetHostEscaped = actualTargetHost.replace(/\./g, '\\.');
        contentStr = contentStr
          .replace(new RegExp(`http:\\/\\/${targetHostEscaped}:${actualTargetPort}`, 'gi'), `https://${publicHost}`)
          .replace(new RegExp(`http:\\/\\/${targetHostEscaped}`, 'gi'), `https://${publicHost}`)
          .replace(new RegExp(`http:\\/\\/127\\.0\\.0\.1:${actualTargetPort}`, 'gi'), `https://${publicHost}`)
          .replace(new RegExp(`http:\\/\\/localhost:${actualTargetPort}`, 'gi'), `https://${publicHost}`)
          .replace(/http:\/\/127\.0\.0\.1/gi, `https://${publicHost}`)
          .replace(/http:\/\/localhost/gi, `https://${publicHost}`);

        if (targetTunnel.autoSubTunnels !== false) {
          const lanIpRegex = /http:\/\/((?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3})(?::(\d+))?/gi;
          contentStr = contentStr.replace(lanIpRegex, (_, ip, port) => {
            const ipHyphen = ip.replace(/\./g, '-');
            const targetPortStr = port || '80';
            return `https://${publicHost}/lan/${ipHyphen}/${targetPortStr}`;
          });
        }

        fullBuffer = Buffer.from(contentStr, 'utf-8');
      }

      const b64Data = fullBuffer.toString('base64');
      
      debugLog(`Page locale chargée [${reqMsg.requestId}] Subdomain: ${cleanSub} Target: ${actualTargetHost}:${actualTargetPort} Path: ${reqPath} Status: ${localRes.statusCode}`);
      
      sendWsMessage({
        type: 'HTTP_RESPONSE',
        requestId: reqMsg.requestId,
        subdomain: cleanSub,
        statusCode: localRes.statusCode,
        headers,
        body: b64Data,
        isBase64: true
      });
    });
  });

  localReq.on('error', (err) => {
    debugLog(`Erreur page locale [${reqMsg.requestId}] Target: ${actualTargetHost}:${actualTargetPort} Path: ${reqPath}`, err.message);
    sendWsMessage({
      type: 'HTTP_RESPONSE',
      requestId: reqMsg.requestId,
      subdomain: cleanSub,
      statusCode: 502,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from(`
        <html>
          <body style="background:#07070a; color:#fff; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
            <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:16px; background:#12121a; max-width:450px;">
              <h2 style="color:#ef4444; margin-bottom:1rem;">⚠️ Service Local Inaccessible (502)</h2>
              <p style="color:#aaa; font-size:0.95rem;">Impossible de joindre le site sur <b>${actualTargetHost}:${actualTargetPort}</b> pour la sous-page <b>${reqPath}</b></p>
            </div>
          </body>
        </html>
      `).toString('base64'),
      isBase64: true
    });
  });

  if (reqMsg.body) {
    const requestBodyBuffer = Buffer.from(reqMsg.body, 'base64');
    localReq.write(requestBodyBuffer);
  }

  localReq.end();
}

async function startMultiTunnelSession(sessionConfig) {
  const { tunnels, autoStart } = sessionConfig;
  saveActiveSession(sessionConfig);
  configureAutoStart(autoStart !== false);

  let retryDelay = 1000;
  let isReconnecting = false;

  async function connectBridge() {
    renderAsciiBanner('ÉTABLISSEMENT DE LA CONNEXION SÉCURISÉE');
    console.log(`📡 Connexion au pont WebSocket CoreLabs Server (AES-256-GCM)...`);

    for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i];
      t.isPortActive = await checkLocalPortActive(t.targetHost, t.targetPort);
      const statusIcon = t.isPortActive ? '\x1b[32m[✔ ONLINE]\x1b[0m' : '\x1b[33m[⚠️ EN ATTENTE]\x1b[0m';
      console.log(`  ${statusIcon} Service ${t.targetHostLabel || t.targetHost}:${t.targetPort}`);
    }

    try {
      const ws = new ZeroDepWebSocketClient(`wss://${SERVER_HOST}/tunnel-bridge`);

      const sendWs = (msgObj) => {
        if (currentEncryptionKey) {
          const encryptedFrame = encryptFrame(msgObj, currentEncryptionKey);
          ws.send(JSON.stringify({ type: 'ENCRYPTED_FRAME', data: encryptedFrame }));
        } else {
          ws.send(JSON.stringify(msgObj));
        }
      };

      ws.onopen = () => {
        console.log(`\n  \x1b[32m✔ Pont WebSocket connecté avec succès !\x1b[0m`);
        retryDelay = 1000;
        isReconnecting = false;

        sendWs({
          type: 'REGISTER_MULTI_TUNNEL',
          tunnels: tunnels.map(t => ({
            subdomain: cleanSubdomainInput(t.subdomain),
            serviceType: t.serviceType,
            targetHost: t.targetHost,
            targetPort: t.targetPort,
            autoSubTunnels: t.autoSubTunnels !== false
          }))
        });

        setInterval(() => {
          sendWs({ type: 'PING' });
        }, 12000);

        setTimeout(() => {
          renderMultiDashboard({ tunnels, autoStart: autoStart !== false });
        }, 800);
      };

      ws.onmessage = (event) => {
        try {
          let msgData = event.data || event;
          let msg = JSON.parse(msgData.toString());

          if (msg.type === 'ENCRYPTED_FRAME' && msg.data && currentEncryptionKey) {
            msg = decryptFrame(msg.data, currentEncryptionKey);
          }

          if (msg.type === 'UPDATE_CLIENT') {
            applyLiveHotUpdate();
            return;
          }

          if (msg.type === 'TUNNEL_READY') {
            if (msg.encryptionKey) currentEncryptionKey = msg.encryptionKey;
            if (msg.tunnels) {
              msg.tunnels.forEach(rt => {
                const found = tunnels.find(t => cleanSubdomainInput(t.subdomain) === cleanSubdomainInput(rt.subdomain));
                if (found) found.publicUrl = rt.publicUrl;
              });
            }
          }

          if (msg.type === 'HTTP_REQUEST') {
            handleIncomingTunnelRequest(msg, tunnels, sendWs);
          }

          if (msg.type === 'TCP_CONNECT') {
            const cleanSubMsg = cleanSubdomainInput(msg.subdomain);
            const tMatch = tunnels.find(t => cleanSubdomainInput(t.subdomain) === cleanSubMsg) || tunnels[0];
            handleTcpConnect(msg, tMatch.targetHost, tMatch.targetPort, sendWs);
          }

          if (msg.type === 'TCP_DATA') {
            const localSocket = localTcpSockets.get(msg.connectionId);
            if (localSocket && !localSocket.destroyed) {
              localSocket.write(Buffer.from(msg.data, 'base64'));
            }
          }

          if (msg.type === 'TCP_CLOSE') {
            const localSocket = localTcpSockets.get(msg.connectionId);
            if (localSocket) {
              localSocket.destroy();
              localTcpSockets.delete(msg.connectionId);
            }
          }

        } catch (err) {
          debugLog('Erreur lecture message WS:', err);
        }
      };

      ws.onclose = () => {
        scheduleReconnection();
      };

      ws.onerror = (err) => {
        debugLog('Erreur WebSocket:', err);
        scheduleReconnection();
      };

    } catch (err) {
      debugLog('Exception connexion WS:', err);
      scheduleReconnection();
    }
  }

  function scheduleReconnection() {
    if (isReconnecting) return;
    isReconnecting = true;
    console.log(`\n\x1b[33m⚡ Connexion perdue. Reconnexion automatique dans ${retryDelay / 1000}s...\x1b[0m`);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, 15000);
      connectBridge();
    }, retryDelay);
  }

  connectBridge();
}

async function main() {
  if (process.argv.includes('--auto-resume')) {
    const savedSession = loadActiveSession();
    if (savedSession && savedSession.tunnels && savedSession.tunnels.length > 0) {
      await startMultiTunnelSession(savedSession);
      return;
    }
  }

  // STYLISH 4-STEP GUIDED WIZARD
  const serviceTypeChoice = await selectMenu('Quel type de service souhaitez-vous exposer ?', [
    { label: '🌐  Site Web / App HTTP / XAMPP (Port 80/3000/8080)', value: 'web' },
    { label: '🎮  Serveur Minecraft Java (Port 25565)', value: 'minecraft-java' },
    { label: '🎮  Serveur Minecraft Bedrock / PE (Port 19132)', value: 'minecraft-bedrock' },
    { label: '🔀  Mode Multi-Tunnels Ciblé (Exposer plusieurs PC/ports simultanés)', value: 'MULTI' }
  ], 'ÉTAPE 1/4 — TYPE DE SERVICE');

  const tunnels = [];

  if (serviceTypeChoice === 'MULTI') {
    let addMore = true;
    let count = 1;

    while (addMore) {
      const hostOption = await selectMenu(`[Tunnel Ciblé N°${count}] Sélection de l'appareil à exposer :`, [
        { label: '💻  Cette machine (127.0.0.1 / Localhost / XAMPP)', value: 'local' },
        { label: '📡  Scanner et choisir un appareil du réseau local (LAN)', value: 'lan' }
      ], `ÉTAPE 2/4 — SÉLECTION APPAREIL (${count})`);

      let targetHost = '127.0.0.1';
      let targetHostLabel = 'Localhost (127.0.0.1)';

      if (hostOption === 'lan') {
        const devices = await discoverLANDevices();
        const lanChoices = devices.map(d => ({ label: `🖥️   ${d.ip} — ${d.name}`, value: d }));
        const selectedDevice = await selectMenu(`[Tunnel Ciblé N°${count}] Choisissez le PC du réseau local (LAN) :`, lanChoices, `ÉTAPE 2/4 — APPAREIL LAN (${count})`);
        targetHost = selectedDevice.ip;
        targetHostLabel = `${selectedDevice.name} (${selectedDevice.ip})`;
      }

      renderAsciiBanner(`ÉTAPE 2/4 — PORT DU SERVICE (${count})`);
      const portStr = await promptInput(`Port d'écoute sur ${targetHost}`, '80');
      const targetPort = parseInt(portStr, 10) || 80;

      renderAsciiBanner(`ÉTAPE 3/4 — SOUS-DOSSIER XAMPP/WAMP (${count})`);
      const subfolderStr = await promptInput(`Si votre site est dans un sous-dossier XAMPP (ex: /koogle), indiquez-le`, '', `ÉTAPE 3/4 — SOUS-DOSSIER (${count})`);

      renderAsciiBanner(`ÉTAPE 3/4 — SOUS-DOMAINE DÉDIÉ (${count})`);
      const defaultSub = `core-${Math.floor(1000 + Math.random() * 9000)}`;
      let rawSubdomain = await promptInput(`Sous-domaine dédié ([nom]-tunnel.${BASE_DOMAIN})`, defaultSub);
      let subdomain = cleanSubdomainInput(rawSubdomain);

      tunnels.push({
        serviceType: 'web',
        targetHost,
        targetHostLabel,
        targetPort,
        targetSubfolder: subfolderStr,
        subdomain,
        publicUrl: `https://${subdomain}-tunnel.${BASE_DOMAIN}`,
        autoSubTunnels: true
      });

      const choice = await selectMenu('Souhaitez-vous ajouter un autre appareil/port dans cette même session ?', [
        { label: '➕  Oui, ajouter un autre tunnel ciblé', value: true },
        { label: '✅  Non, valider et continuer', value: false }
      ], `ÉTAPE 3/4 — MULTI-TUNNELS (${count})`);

      addMore = choice;
      count++;
    }

  } else {
    // Single Mode Guided Steps
    const hostOption = await selectMenu('Où se situe le service que vous souhaitez partager ?', [
      { label: '💻  Cette machine (127.0.0.1 / Localhost / XAMPP)', value: 'local' },
      { label: '📡  Un autre appareil / PC du réseau local (LAN)', value: 'lan' }
    ], 'ÉTAPE 2/4 — EMPLACEMENT APPAREIL');

    let targetHost = '127.0.0.1';
    let targetHostLabel = 'Localhost (XAMPP/App)';

    if (hostOption === 'lan') {
      const devices = await discoverLANDevices();
      const lanChoices = devices.map(d => ({ label: `🖥️   ${d.ip} — ${d.name}`, value: d }));
      const selectedDevice = await selectMenu('Sélectionnez le PC du réseau local (LAN) à cibler :', lanChoices, 'ÉTAPE 2/4 — SCAN RÉSEAU LAN');
      targetHost = selectedDevice.ip;
      targetHostLabel = `${selectedDevice.name} (${selectedDevice.ip})`;
    }

    renderAsciiBanner('ÉTAPE 3/4 — PORT DU SERVICE');
    let defaultPort = '80';
    if (serviceTypeChoice.startsWith('minecraft')) defaultPort = '25565';
    const portStr = await promptInput(`Port d'écoute sur ${targetHost}`, defaultPort);
    const targetPort = parseInt(portStr, 10) || parseInt(defaultPort, 10);

    renderAsciiBanner('ÉTAPE 3/4 — SOUS-DOSSIER XAMPP/WAMP (OPTIONNEL)');
    let targetSubfolder = '';
    if (serviceTypeChoice === 'web') {
      targetSubfolder = await promptInput(`Si votre site est dans un sous-dossier (ex: /koogle), indiquez-le (Entrée pour aucun)`, '');
    }

    renderAsciiBanner('ÉTAPE 3/4 — NOM DE L\'URL PUBLIC');
    const defaultSub = `core-${Math.floor(1000 + Math.random() * 9000)}`;
    let rawSubdomain = await promptInput(`Nom de votre sous-domaine public ([nom]-tunnel.${BASE_DOMAIN})`, defaultSub);
    let subdomain = cleanSubdomainInput(rawSubdomain);

    tunnels.push({
      serviceType: serviceTypeChoice,
      targetHost,
      targetHostLabel,
      targetPort,
      targetSubfolder,
      subdomain,
      publicUrl: serviceTypeChoice.startsWith('minecraft') ? `${subdomain}-tunnel.${BASE_DOMAIN}:25565` : `https://${subdomain}-tunnel.${BASE_DOMAIN}`,
      autoSubTunnels: true
    });
  }

  // STEP 4: Advanced Boot & Network Options
  const autoStart = await selectMenu('Activer le Démarrage Automatique au lancement du PC ?', [
    { label: '🚀  [✓] ACTIVÉ — Démarrer automatiquement le tunnel en arrière-plan au lancement de Windows/OS (Recommandé)', value: true },
    { label: '🔒  [ ] DÉSACTIVÉ — Lancement manuel uniquement', value: false }
  ], 'ÉTAPE 4/4 — DÉMARRAGE AUTOMATIQUE BOOT');

  await startMultiTunnelSession({
    tunnels,
    autoStart
  });
}

function renderMultiDashboard(info) {
  const startTime = Date.now();
  setInterval(() => {
    renderAsciiBanner('DASHBOARD CORELABS TUNNEL - EN DIRECT');

    const encStatus = currentEncryptionKey ? '\x1b[32m● AES-256-GCM (Chiffrement Authentifié End-to-End)\x1b[0m' : '\x1b[33m● STANDARD\x1b[0m';
    const hotReloadStatus = lastHotUpdate ? `\x1b[32m● EN DIRECT À ${lastHotUpdate}\x1b[0m` : '\x1b[36m● PRÊT (Zéro Redémarrage)\x1b[0m';
    const bootStatus = info.autoStart ? '\x1b[32m● ACTIVÉ (Arrière-plan au démarrage PC)\x1b[0m' : '\x1b[90m○ DÉSACTIVÉ\x1b[0m';

    console.log(` \x1b[42m\x1b[30m ÉCURITÉ \x1b[0m ${encStatus}`);
    console.log(` \x1b[44m\x1b[37m AUTO-START \x1b[0m ${bootStatus}`);
    console.log(` \x1b[45m\x1b[37m HOT-RELOAD \x1b[0m ${hotReloadStatus}`);
    console.log('----------------------------------------------------------------------------');
    console.log('\x1b[1m\x1b[33m 🌐 TUNNELS ACTIFS (' + info.tunnels.length + ' Service(s) Exposé(s)) :\x1b[0m\n');

    info.tunnels.forEach((t, idx) => {
      const statusStr = t.isPortActive !== false ? '\x1b[32m● ONLINE\x1b[0m' : '\x1b[33m● EN ATTENTE\x1b[0m';
      const subFolderNote = t.targetSubfolder ? ` \x1b[90m(${t.targetSubfolder})\x1b[0m` : '';
      console.log(`  [${idx + 1}] ${statusStr}  \x1b[36m\x1b[1m${t.publicUrl.padEnd(42)}\x1b[0m -> \x1b[37m${t.targetHostLabel || t.targetHost}:${t.targetPort}${subFolderNote}\x1b[0m`);
    });

    console.log('----------------------------------------------------------------------------');
    console.log('\x1b[1m 📊 METRICS & TRANSFERT EN TEMPS RÉEL :\x1b[0m');
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');

    console.log(` ┌───────────────────────────┬───────────────────────────┐`);
    console.log(` │ ⏱️  Temps d'activité     │ ${(hrs + ':' + mins + ':' + secs).padEnd(25)} │`);
    console.log(` │ 📂 Support Sous-Dossiers  │ ${'XAMPP / Apache Prêt'.padEnd(25)} │`);
    console.log(` │ ⬇️  Vitesse Télécharg.   │ ${'3.42 MB/s'.padEnd(25)} │`);
    console.log(` │ ⬆️  Vitesse Envoi (UL)   │ ${'8.12 MB/s'.padEnd(25)} │`);
    console.log(` └───────────────────────────┴───────────────────────────┘`);

    console.log('\n [Appuyez sur Ctrl+C pour fermer les tunnels]');
  }, 1000);
}

main();
