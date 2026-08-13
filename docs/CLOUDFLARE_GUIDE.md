# Guide d'installation Plug & Play — CoreLabs Tunnel Server

Ce guide vous explique comment déployer le serveur central **CoreLabs Tunnel** sur votre VPS avec votre nom de domaine **`corelabs.network`** et Cloudflare.

Avec cette architecture, **vos utilisateurs n'ont AUCUN token ou clé API à configurer**. Ils lancent juste la commande et le tunnel fonctionne immédiatement !

---

## 🔒 Architecture Sécurisée Zero-Config

```
   [ Utilisateur (Client CLI) ] 
       │ ⚡ Plug & Play (Aucun Token requis !)
       │ 
       ▼ (Connexion WebSocket sécurisée)
   [ Serveur Central CoreLabs VPS ] ──► (Garde le Token Cloudflare de manière 100% sécurisée)
       │
       ▼ (Gestion DNS & Cloudflare Edge)
   [ *.tunnel.corelabs.network ]
```

---

## 🛠️ Étapes de Configuration du Serveur (À faire UNE SEULE FOIS par l'administrateur)

### 1. Obtenir les identifiants Cloudflare

1. Rendez-vous sur votre tableau de bord [Cloudflare](https://dash.cloudflare.com/).
2. Sélectionnez votre nom de domaine **`corelabs.network`**.
3. Dans la section **DNS**, créez un enregistrement CNAME Wildcard :
   - **Nom** : `*.tunnel`
   - **Cible** : `tunnel.corelabs.network` (ou l'IP publique de votre VPS)
   - **Proxy Cloudflare** : 🟠 **Proxifié (Orange)**
4. Générez un Token API Cloudflare :
   - Allez dans **Mon profil** > **Tokens API** (`https://dash.cloudflare.com/profile/api-tokens`).
   - Modèle : **Modifier les DNS de la zone**.
   - Notez votre **Token API** et votre **Zone ID**.

---

### 2. Déployer le Serveur Central CoreLabs sur votre VPS

1. Transférez le dossier `server/` sur votre VPS.
2. Installez les dépendances et compilez le projet :
   ```bash
   cd server
   npm install
   npm run build
   ```
3. Créez un fichier `.env` sur le serveur :
   ```env
   PORT=4000
   DOMAIN_NAME=tunnel.corelabs.network
   CLOUDFLARE_API_TOKEN=votre_token_secret_cloudflare_ici
   CLOUDFLARE_ZONE_ID=votre_zone_id_ici
   ```
4. Démarrez le serveur (avec PM2 pour qu'il fonctionne 24/7) :
   ```bash
   npm install -g pm2
   pm2 start dist/server.js --name "corelabs-server"
   ```

---

### 3. Expérience Utilisateur (Zero-Config / Plug & Play)

Désormais, n'importe quel utilisateur souhaitant ouvrir un tunnel n'a **RIEN À CONFIGURER**.

Il lui suffit de taper :

#### Sur Linux / macOS :
```bash
curl -fsSL https://tunnel.corelabs.network/install.sh | bash
```

#### Sur Windows (PowerShell) :
```powershell
iwr -useb https://tunnel.corelabs.network/install.ps1 | iex
```

#### Ou via NPM :
```bash
npx -y @corelabs/tunnel-cli
```

---

### 🎮 Déroulement côté client :
1. L'utilisateur répond aux 4 questions simples du terminal :
   - **Type** : Serveur Minecraft (25565), Site Web (3000), etc.
   - **Machine** : Cette machine (`127.0.0.1`) OU un autre appareil du réseau local (`192.168.1.42`).
   - **Port** : ex: 25565.
   - **Sous-domaine** : ex: `mon-serveur`.
2. Le CLI se connecte instantanément au serveur CoreLabs via WebSocket.
3. Le tableau de bord Playit.gg s'ouvre avec l'URL finale : **`https://mon-serveur.tunnel.corelabs.network`** (ou **`mon-serveur.tunnel.corelabs.network:25565`**).
4. Le token Cloudflare ne quitte **JAMAIS** votre serveur central.
