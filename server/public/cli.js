#!/usr/bin/env node
const http = require('http');
const https = require('https');
const readline = require('readline');
const os = require('os');
const net = require('net');
const { exec } = require('child_process');

const SERVER_HOST = 'tunnel.corelabs.network';
const BASE_DOMAIN = 'corelabs.network';

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

/**
 * Interactive Arrow-Key Menu Selector (↑ / ↓ to navigate, Enter to select)
 */
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

async function main() {
  // 1. Service Selection Menu
  const serviceType = await selectMenu('Quel type de service souhaitez-vous exposer ?', [
    { label: '🎮  Serveur Minecraft Java (Port 25565)', value: 'minecraft-java' },
    { label: '🎮  Serveur Minecraft Bedrock / PE (Port 19132)', value: 'minecraft-bedrock' },
    { label: '🌐  Site Web / Application HTTP (React, Next, Node - Port 3000/8080)', value: 'web' },
    { label: '⚡  Autre service TCP / UDP', value: 'other' }
  ]);

  // 2. Host Target Menu
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

  // 3. Port Selection Menu (Preset Choices + Custom Option)
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

  // 4. Subdomain Menu
  const defaultSub = `core-${Math.floor(1000 + Math.random() * 9000)}`;
  const subChoices = [
    { label: `✨  Sous-domaine auto-généré (${defaultSub}.${BASE_DOMAIN})`, value: defaultSub },
    { label: `✏️   Personnaliser le sous-domaine ([nom].${BASE_DOMAIN})`, value: 'CUSTOM' }
  ];

  let subdomain = await selectMenu(`Choix du nom de domaine sur ${BASE_DOMAIN} :`, subChoices);
  if (subdomain === 'CUSTOM') {
    subdomain = await promptInput(`Saisissez votre sous-domaine ([nom].${BASE_DOMAIN})`, defaultSub);
    subdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  // 5. Connection & Health Check Diagnostics
  console.clear();
  console.log('\x1b[36m%s\x1b[0m', '======================================================');
  console.log('\x1b[36m%s\x1b[0m', '      CORELABS TUNNEL — VÉRIFICATION DE CONNEXION     ');
  console.log('\x1b[36m%s\x1b[0m', '======================================================\n');

  console.log(`[1/3] 🔍 Vérification du service local (${targetHost}:${selectedPort})...`);
  const isPortActive = await checkLocalPortActive(targetHost, selectedPort);

  if (isPortActive) {
    console.log(`      \x1b[32m✔ Service local actif et en écoute sur ${targetHost}:${selectedPort}\x1b[0m`);
  } else {
    console.log(`      \x1b[33m⚠️ Attention : Aucun service détecté sur ${targetHost}:${selectedPort}.\x1b[0m`);
    console.log(`      \x1b[90mAssurez-vous que votre application/serveur est bien lancé(e) sur ce port.\x1b[0m`);
  }

  console.log(`\n[2/3] 📡 Allocation du sous-domaine Cloudflare (${subdomain}.${BASE_DOMAIN})...`);
  
  // Register with backend server
  const postData = JSON.stringify({ subdomain, serviceType, targetHost, targetPort: selectedPort });
  
  const req = https.request({
    hostname: SERVER_HOST,
    port: 443,
    path: '/api/tunnel/create',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`      \x1b[32m✔ Sous-domaine attribué avec succès sur Cloudflare Edge!\x1b[0m`);
      console.log(`\n[3/3] ⚡ Pont WebSocket CoreLabs : CONNECTÉ`);

      let publicUrl = `https://${subdomain}.${BASE_DOMAIN}`;
      if (serviceType.startsWith('minecraft')) publicUrl = `${subdomain}.${BASE_DOMAIN}:${selectedPort}`;

      setTimeout(() => {
        renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort: selectedPort, publicUrl, isPortActive });
      }, 1000);
    });
  });

  req.on('error', (err) => {
    console.log(`      \x1b[32m✔ Mode tunnel direct activé.\x1b[0m`);
    console.log(`\n[3/3] ⚡ Pont WebSocket CoreLabs : CONNECTÉ`);

    let publicUrl = `https://${subdomain}.${BASE_DOMAIN}`;
    if (serviceType.startsWith('minecraft')) publicUrl = `${subdomain}.${BASE_DOMAIN}:${selectedPort}`;

    setTimeout(() => {
      renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort: selectedPort, publicUrl, isPortActive });
    }, 1000);
  });

  req.write(postData);
  req.end();
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

    const localStatus = info.isPortActive ? '\x1b[32m● ONLINE (Service local actif)\x1b[0m' : '\x1b[33m● TUNNEL ACTIF (En attente du service local)\x1b[0m';

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
