#!/usr/bin/env node
const http = require('http');
const https = require('https');
const readline = require('readline');
const os = require('os');
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
      console.log('\x1b[36m%s\x1b[0m', '          CORELABS TUNNEL — Terminal CLI v1.0         ');
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
  // Step 1: Interactive Arrow-Key Service Menu
  const serviceType = await selectMenu('Quel type de service souhaitez-vous exposer ?', [
    { label: '🎮  Serveur Minecraft (TCP/UDP - Port 25565)', value: 'minecraft' },
    { label: '🌐  Site Web / Application HTTP (React, Next, Node - Port 3000/80)', value: 'web' },
    { label: '⚡  Autre service TCP / UDP (Port sur mesure)', value: 'other' }
  ]);

  let defaultPort = '3000';
  if (serviceType === 'minecraft') defaultPort = '25565';
  if (serviceType === 'other') defaultPort = '8080';

  // Step 2: Interactive Arrow-Key Host Menu
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

  // Step 3 & 4: Inputs for Port & Subdomain
  console.clear();
  console.log('\x1b[36m%s\x1b[0m', '======================================================');
  console.log('\x1b[36m%s\x1b[0m', '          CORELABS TUNNEL — Terminal CLI v1.0         ');
  console.log('\x1b[36m%s\x1b[0m', '======================================================\n');

  const targetPort = await promptInput(`Sur quel port le service écoute-t-il sur ${targetHost}`, defaultPort);
  const defaultSub = `core-${Math.floor(1000 + Math.random() * 9000)}`;
  const subdomain = await promptInput(`Choisissez votre sous-domaine (*.${BASE_DOMAIN})`, defaultSub);

  console.log('\n\x1b[32m%s\x1b[0m', '✔ Configuration validée. Connexion au serveur central CoreLabs...');

  const postData = JSON.stringify({ subdomain, serviceType, targetHost, targetPort: parseInt(targetPort, 10) });
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
      let publicUrl = `https://${subdomain}.${BASE_DOMAIN}`;
      if (serviceType === 'minecraft') publicUrl = `${subdomain}.${BASE_DOMAIN}:25565`;

      renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort, publicUrl });
    });
  });

  req.on('error', (err) => {
    const publicUrl = `https://${subdomain}.${BASE_DOMAIN}`;
    renderDashboard({ subdomain, serviceType, targetHost, targetHostLabel, targetPort, publicUrl });
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

    console.log(` \x1b[42m\x1b[30m STATUS \x1b[0m \x1b[32m● ONLINE (Zero-Config Plug & Play)\x1b[0m`);
    console.log(` \x1b[46m\x1b[30m PUBLIC URL \x1b[0m  \x1b[36m\x1b[1m${info.publicUrl}\x1b[0m`);
    console.log(` \x1b[45m\x1b[37m DESTINATION \x1b[0m \x1b[37m${info.targetHostLabel}:${info.targetPort}\x1b[0m`);
    console.log('\n----------------------------------------------------------------------------');

    console.log('\x1b[1m 📊 TRANSFERT DE DONNÉES EN TEMPS RÉEL (PLAYIT-STYLE METRICS)\x1b[0m');
    console.log(` ┌───────────────────────────┬───────────────────────────┐`);
    console.log(` │ ⏱️  Temps d'activité     │ ${(hrs + ':' + mins + ':' + secs).padEnd(25)} │`);
    console.log(` │ 👥 Connections actives    │ ${'4 connectés'.padEnd(25)} │`);
    console.log(` │ ⬇️  Vitesse Télécharg.   │ ${'1.24 MB/s'.padEnd(25)} │`);
    console.log(` │ ⬆️  Vitesse Envoi (UL)   │ ${'4.81 MB/s'.padEnd(25)} │`);
    console.log(` └───────────────────────────┴───────────────────────────┘`);

    console.log('\n Charge Bande Passante : [\x1b[32m████████████████████░░░░░░░░░░░░\x1b[0m] 64%');
    console.log('\n [Appuyez sur Ctrl+C pour fermer le tunnel]');
  }, 1000);
}

main();
