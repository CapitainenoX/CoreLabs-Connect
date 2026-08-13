# CoreLabs-Connect (CoreLabs Tunnel)

> Solution de tunnel terminal épurée, ultra-rapide et Zero-Config pour serveurs Minecraft, sites Web et applications TCP/UDP avec sous-domaines sur `*.tunnel.corelabs.network`.

---

## ⚡ Fonctionnalités
- **Zero-Config Client** : Aucun token Cloudflare ou clé API n'est demandé à l'utilisateur. Le serveur central gère la réservation de manière 100% sécurisée.
- **Scan Réseau Local (LAN)** : Détecte automatiquement les appareils du réseau local (IP et noms d'hôtes) pour exposer un serveur sans configuration.
- **Dashboard TUI Style Playit.gg** : Métriques en temps réel (débit d'envoi/téléchargement, horloge d'activité, jauge graphique ASCII de bande passante, journal des requêtes).
- **Landing Page Sombre (OpenCode style)** : Page d'accueil moderne avec snippets de commandes interactifs (`curl`, `powershell`, `npm`, `bun`, `brew`).
- **Support Multi-Services** : Minecraft Java & Bedrock (25565), HTTP/HTTPS Web Apps (3000, 80), TCP/UDP.

---

## 🚀 Installation & Utilisation Client

### Linux / macOS / GitBash :
```bash
curl -fsSL https://tunnel.corelabs.network/install.sh | bash
```

### Windows (PowerShell) :
```powershell
iwr -useb https://tunnel.corelabs.network/install.ps1 | iex
```

---

## 🛠️ Déploiement du Serveur (Raspberry Pi / VPS)

Consultez le guide détaillé de déploiement dans [`docs/RASPBERRY_PI_GUIDE.md`](docs/RASPBERRY_PI_GUIDE.md).

```bash
cd server
npm install
npm run build
pm2 start dist/server.js --name "corelabs-server"
```
