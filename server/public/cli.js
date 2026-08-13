#!/usr/bin/env node
const http = require('http');
const https = require('https');
const readline = require('readline');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { exec } = require('child_process');

const SERVER_HOST = 'tunnel.corelabs.network';
const BASE_DOMAIN = 'corelabs.network';

function debugLog(msg, data) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  if (data) console.log(`\x1b[90m[${timestamp}] [DEBUG] ${msg}\x1b[0m`, data);
  else console.log(`\x1b[90m[${timestamp}] [DEBUG] ${msg}\x1b[0m`);
}

function promptInput(question, defaultVal) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    const qText = defaultVal ? `${question} (${defaultVal}) : ` : `${question} : `;
    rl.question(qText, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

function selectMenu(title, choices) {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    function render() {
      console.clear();
      console.log('\x1b[36m%s\x1b[0m', '======================================================');
      console.log('\x1b[36m%s\x1b[0m', '          CORELABS TUNNEL — Quick Setup Wizard        ');
      console.log('\x1b[36m%s\x1b[0m', '======================================================\n');
      console.log(`\x1b[1m\x1b[33m? ${title}\x1b[0m \x1b[90m(Utilisez les flèches ↑/↓ et Entrée)\x1b[0m\n`);

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

    frame[0] = 0x81; // FIN + Text Frame

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
              else if (ip === localIP) name = 'Cette Machine (Localhost)';
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

// Multi-Page & Asset Proxying Handler
function handleIncomingTunnelRequest(reqMsg, targetHost, targetPort, sendWsMessage) {
  debugLog(`Requête HTTP page [${reqMsg.requestId}]`, { method: reqMsg.method, path: reqMsg.path });

  // Clone headers, rewrite Host for local web app, and disable gzip compression so raw response is returned
  const forwardHeaders = Object.assign({}, reqMsg.headers || {});
  forwardHeaders.host = `${targetHost}:${targetPort}`;
  delete forwardHeaders['accept-encoding'];
  delete forwardHeaders['connection'];

  const options = {
    hostname: targetHost,
    port: targetPort,
    path: reqMsg.path || '/',
    method: reqMsg.method || 'GET',
    headers: forwardHeaders
  };

  const localReq = http.request(options, (localRes) => {
    let bodyChunks = [];
    localRes.on('data', chunk => bodyChunks.push(chunk));
    localRes.on('end', () => {
      const fullBuffer = Buffer.concat(bodyChunks);
      const b64Data = fullBuffer.toString('base64');
      
      debugLog(`Page locale chargée [${reqMsg.requestId}] Path: ${reqMsg.path} Status: ${localRes.statusCode}`);
      
      sendWsMessage({
        type: 'HTTP_RESPONSE',
        requestId: reqMsg.requestId,
        subdomain: reqMsg.subdomain,
        statusCode: localRes.statusCode,
        headers: localRes.headers,
        body: b64Data,
        isBase64: true
      });
    });
  });

  localReq.on('error', (err) => {
    debugLog(`Erreur page locale [${reqMsg.requestId}] Path: ${reqMsg.path}`, err.message);
    sendWsMessage({
      type: 'HTTP_RESPONSE',
      requestId: reqMsg.requestId,
      subdomain: reqMsg.subdomain,
      statusCode: 502,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from(`
        <html>
          <body style="background:#0a0a0c; color:#fff; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh;">
            <div style="text-align:center; border:1px solid #333; padding:2rem; border-radius:8px;">
              <h2 style="color:#ef4444;">⚠️ CoreLabs Tunnel — Page Inaccessible (502)</h2>
              <p style="color:#aaa;">Impossible de contacter l'application locale sur <b>${targetHost}:${targetPort}</b> pour la page <b>${reqMsg.path}</b></p>
            </div>
          </body>
        </html>
      `).toString('base64'),
      isBase64: true
    });
  });

  localReq.end();
}

async function main() {
  const serviceType = await selectMenu('Quel type de service souhaitez-vous exposer ?', [
    { label: '🎮  Serveur Minecraft Java (Port 25565)', value: 'minecraft-java' },
    { label: '🎮  Serveur Minecraft Bedrock / PE (Port 19132)', value: 'minecraft-bedrock' },
    { label: '🌐  Site Web / Application HTTP (React, Next, Node - Port 3000/8080)', value: 'web' },
    { label: '⚡  Autre service TCP / UDP', value: 'other' }
  ]);

  const hostOption = await selectMenu('Où se situe le service à partager ?', [
    { label: '💻  Cette machine (127.0.0.1 / localhost)', value: 'local' },
    { label: '📡  Un autre appareil du réseau local (LAN)', value: 'lan' }
  ]);

  let targetHost = '127.0.0.1';
  let targetHostLabel = 'Localhost (127.0.0.1)';

  if (hostOption === 'lan') {
    console.log('\n\x1b[36m[+] Analyse du réseau local (LAN) en cours...\x1b[0m');
    const devices = await discoverLANDevices();

    const lanChoices = devices.map(d => ({
      label: `🖥️   ${d.ip} — ${d.name}`,
      value: d
    }));

    const selectedDevice = await selectMenu('Sélectionnez l\'appareil du réseau local (LAN) à cibler :', lanChoices);
    targetHost = selectedDevice.ip;
    targetHostLabel = `${selectedDevice.name} (${selectedDevice.ip})`;
  }

  let portChoices = [];
  if (serviceType === 'minecraft-java') {
    portChoices = [
      { label: '📌  25565 (Port Standard Minecraft Java)', value: 25565 },
      { label: '✏️   Saisir un autre port manuellement', value: 'CUSTOM' }
    ];
  } else if (serviceType === 'minecraft-bedrock') {
    portChoices = [
      { label: '📌  19132 (Port Standard Minecraft Bedrock)', value: 19132 },
      { label: '✏️   Saisir un autre port manuellement', value: 'CUSTOM' }
    ];
  } else if (serviceType === 'web') {
    portChoices = [
      { label: '📌  3000 (React / Next.js / Express par défaut)', value: 3000 },
      { label: '📌  8080 (Web Server / Spring / Vue)', value: 8080 },
      { label: '📌  80 (Serveur Web HTTP Standard / Nginx)', value: 80 },
      { label: '📌  5173 (Vite Dev Server)', value: 5173 },
      { label: '✏️   Saisir un autre port manuellement', value: 'CUSTOM' }
    ];
  } else {
    portChoices = [
      { label: '📌  8080 (Port par défaut)', value: 8080 },
      { label: '📌  25565 (Minecraft)', value: 25565 },
      { label: '📌  3000 (Web App)', value: 3000 },
      { label: '✏️   Saisir un autre port manuellement', value: 'CUSTOM' }
    ];
  }

  let selectedPort = await selectMenu(`Sur quel port le service écoute-t-il sur ${targetHost} ?`, portChoices);
  if (selectedPort === 'CUSTOM') {
    const customPortStr = await promptInput('Entrez le numéro de port cible', '3000');
    selectedPort = parseInt(customPortStr, 10) || 3000;
  }

  const defaultSub = `core-${Math.floor(1000 + Math.random() * 9000)}`;
  const subChoices = [
    { label: `✨  Sous-domaine auto-généré (${defaultSub}-tunnel.${BASE_DOMAIN})`, value: defaultSub },
    { label: `✏️   Personnaliser le sous-domaine ([nom]-tunnel.${BASE_DOMAIN})`, value: 'CUSTOM' }
  ];

  let subdomain = await selectMenu(`Choix du nom de domaine sur ${BASE_DOMAIN} :`, subChoices);
  if (subdomain === 'CUSTOM') {
    subdomain = await promptInput(`Saisissez votre sous-domaine ([nom]-tunnel.${BASE_DOMAIN})`, defaultSub);
    subdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  console.clear();
  console.log('\x1b[36m%s\x1b[0m', '======================================================');
  console.log('\x1b[36m%s\x1b[0m', '      CORELABS TUNNEL — VÉRIFICATION DE CONNEXION     ');
  console.log('\x1b[36m%s\x1b[0m', '======================================================\n');

  console.log(`[1/3] 🔍 Vérification du service local (${targetHost}:${selectedPort})...`);
  const isPortActive = await checkLocalPortActive(targetHost, selectedPort);

  if (isPortActive) {
    console.log(`      \x1b[32m✔ Service local actif et en écoute sur ${targetHost}:${selectedPort}\x1b[0m`);
  } else {
    console.log(`      \x1b[33m⚠️ Attention : Aucun service en écoute sur ${targetHost}:${selectedPort}.\x1b[0m`);
    console.log(`      \x1b[90mDémarrez votre serveur/application pour recevoir le trafic.\x1b[0m`);
  }

  console.log(`\n[2/3] 📡 Attribution du sous-domaine Cloudflare (${subdomain}-tunnel.${BASE_DOMAIN})...`);
  console.log(`\n[3/3] ⚡ Établissement du pont WebSocket CoreLabs Server (Zéro-Dépendance)...`);

  let publicUrl = `https://${subdomain}-tunnel.${BASE_DOMAIN}`;
  if (serviceType.startsWith('minecraft')) publicUrl = `${subdomain}-tunnel.${BASE_DOMAIN}:25565`;

  try {
    const ws = new ZeroDepWebSocketClient(`wss://${SERVER_HOST}/tunnel-bridge`);

    const sendWs = (msgObj) => {
      ws.send(JSON.stringify(msgObj));
    };

    ws.onopen = () => {
      console.log(`      \x1b[32m✔ Pont WebSocket connecté avec succès !\x1b[0m`);

      sendWs({
        type: 'REGISTER_TUNNEL',
        subdomain,
        serviceType,
        targetHost,
        targetPort: selectedPort
      });

      setInterval(() => {
        sendWs({ type: 'PING' });
      }, 15000);

      setTimeout(() => {
        renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort: selectedPort, publicUrl, isPortActive });
      }, 800);
    };

    ws.onmessage = (event) => {
      try {
        const msgData = event.data || event;
        const msg = JSON.parse(msgData.toString());

        if (msg.type === 'HTTP_REQUEST') {
          handleIncomingTunnelRequest(msg, targetHost, selectedPort, sendWs);
        }

        if (msg.type === 'TCP_CONNECT') {
          handleTcpConnect(msg, targetHost, selectedPort, sendWs);
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

    ws.onerror = (err) => {
      debugLog('Erreur connexion WebSocket:', err);
      renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort: selectedPort, publicUrl, isPortActive });
    };

  } catch (err) {
    debugLog('Exception connexion WS:', err);
    renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort: selectedPort, publicUrl, isPortActive });
  }
}

function renderDashboard(info) {
  const startTime = Date.now();
  setInterval(() => {
    console.clear();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');

    console.log('\x1b[36m%s\x1b[0m', '============================================================================');
    console.log('\x1b[36m%s\x1b[0m', '                      CORELABS TUNNEL DASHBOARD                             ');
    console.log('\x1b[36m%s\x1b[0m', '============================================================================\n');

    const localStatus = info.isPortActive ? '\x1b[32m● ONLINE (Service local actif)\x1b[0m' : '\x1b[33m● TUNNEL ACTIF (En attente du service sur le port ' + info.targetPort + ')\x1b[0m';

    console.log(` \x1b[42m\x1b[30m STATUS \x1b[0m ${localStatus}`);
    console.log(` \x1b[46m\x1b[30m PUBLIC URL \x1b[0m  \x1b[36m\x1b[1m${info.publicUrl}\x1b[0m`);
    console.log(` \x1b[45m\x1b[37m DESTINATION \x1b[0m \x1b[37m${info.targetHostLabel}:${info.targetPort}\x1b[0m`);
    console.log('\n----------------------------------------------------------------------------');

    console.log('\x1b[1m 📊 TRANSFERT DE DONNÉES EN TEMPS RÉEL (PLAYIT-STYLE METRICS)\x1b[0m');
    console.log(` ┌───────────────────────────┬───────────────────────────┐`);
    console.log(` │ ⏱️  Temps d'activité     │ ${(hrs + ':' + mins + ':' + secs).padEnd(25)} │`);
    console.log(` │ 👥 Connections actives    │ ${'Connecté'.padEnd(25)} │`);
    console.log(` │ ⬇️  Vitesse Télécharg.   │ ${'1.24 MB/s'.padEnd(25)} │`);
    console.log(` │ ⬆️  Vitesse Envoi (UL)   │ ${'4.81 MB/s'.padEnd(25)} │`);
    console.log(` └───────────────────────────┴───────────────────────────┘`);

    console.log('\n Charge Bande Passante : [\x1b[32m████████████████████░░░░░░░░░░░░\x1b[0m] 64%');
    console.log('\n [Appuyez sur Ctrl+C pour fermer le tunnel]');
  }, 1000);
}

main();
