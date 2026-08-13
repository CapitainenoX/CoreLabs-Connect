# Guide de Déploiement Raspberry Pi (SSH) — CoreLabs Tunnel Server

Ce guide vous accompagne pas à pas pour installer et exécuter le serveur **CoreLabs Tunnel** sur votre **Raspberry Pi** via SSH, avec **démarrage automatique au démarrage du Raspberry Pi**.

---

## 📋 Résumé des Étapes

1. Préparer Node.js et PM2 sur le Raspberry Pi
2. Transférer le projet sur le Raspberry Pi via SSH
3. Configurer les variables d'environnement (`.env`)
4. Activer le démarrage automatique avec PM2
5. Rendre le serveur accessible depuis Internet

---

## 🚀 Étape 1 : Installer Node.js et PM2 sur le Raspberry Pi

Dans votre terminal SSH connecté à votre Raspberry Pi, lancez les commandes suivantes :

```bash
# 1. Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# 2. Installer Node.js 20 LTS (compatible ARM32 / ARM64)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# 3. Vérifier que Node et NPM sont bien installés
node -v
npm -v

# 4. Installer PM2 (gestionnaire de processus avec auto-redémarrage)
sudo npm install -g pm2
```

---

## 📦 Étape 2 : Transférer le projet CoreLabs Server sur le Pi

### Option A : Transférer depuis votre PC Windows vers le Raspberry Pi (Via SCP)
Depuis le terminal de votre PC Windows (remplacez `pi` et `192.168.1.XX` par l'utilisateur et l'IP de votre Pi) :

```powershell
scp -r "c:\Users\capit\Desktop\CoreLabs Tunnel\server" pi@192.168.1.XX:~/corelabs-server
```

---

## ⚙️ Étape 3 : Installer les dépendances et créer le fichier `.env`

Sur le Raspberry Pi (en SSH) :

```bash
# 1. Se déplacer dans le dossier
cd ~/corelabs-server

# 2. Installer les dépendances et compiler en JavaScript
npm install
npm run build

# 3. Créer le fichier de configuration .env
nano .env
```

Dans le fichier `.env`, collez le contenu suivant :

```env
PORT=4000
DOMAIN_NAME=tunnel.corelabs.network
CLOUDFLARE_API_TOKEN=votre_token_secret_cloudflare
CLOUDFLARE_ZONE_ID=votre_zone_id_cloudflare
```

*(Appuyez sur `Ctrl + O` puis `Entrée` pour sauvegarder, et `Ctrl + X` pour quitter nano)*.

---

## 🔄 Étape 4 : Activer le Démarrage Automatique (PM2)

Pour que le serveur fonctionne 24h/24 et **redémarre automatiquement si le Raspberry Pi s'éteint ou redémarre** :

```bash
# 1. Démarrer le serveur avec PM2
pm2 start dist/server.js --name "corelabs-server"

# 2. Générer le service de démarrage au boot
pm2 startup
```

⚠️ **ATTENTION** : La commande `pm2 startup` va vous afficher une ligne de commande à copier-coller qui ressemble à ceci :
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u pi --hp /home/pi
```
Exécutez cette commande fournie par PM2.

```bash
# 3. Sauvegarder la liste des processus actifs
pm2 save
```

🎉 **C'est prêt !** Votre serveur CoreLabs tourne désormais en arrière-plan et redémarrera tout seul à chaque fois que le Raspberry Pi s'allume.

---

## 📊 Commandes Utiles PM2 sur Raspberry Pi

- **Voir le statut du serveur** : `pm2 status`
- **Voir les logs en direct** : `pm2 logs corelabs-server`
- **Redémarrer le serveur** : `pm2 restart corelabs-server`
- **Arrêter le serveur** : `pm2 stop corelabs-server`

---

## 🌐 Étape 5 : Exposer le port 4000 du Raspberry Pi sur Internet

Pour que les utilisateurs distants puissent contacter votre Raspberry Pi via `tunnel.corelabs.network` :

### Option 1 (Redirection de Port sur votre Box Internet / Routeur)
1. Accédez à l'interface de votre box (ex: `192.168.1.1` ou `192.168.0.1`).
2. Dans la section **Redirection de Ports (NAT/PAT)**, ajoutez une règle :
   - **Port externe** : `4000` (ou `80` / `443`)
   - **Port interne** : `4000`
   - **IP interne** : L'IP de votre Raspberry Pi (ex: `192.168.1.XX`)
   - **Protocole** : `TCP`

### Option 2 (Cloudflare Tunnel gratuit sur le Pi - Zéro Port à ouvrir !)
Si vous ne voulez pas ouvrir de port sur votre box :
```bash
# Installer cloudflared sur le Raspberry Pi
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /etc/apt/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```
Puis connectez votre tunnel Cloudflare avec votre token de tunnel de domaine.
