#!/usr/bin/env bash
set -e

echo -e "\033[1;36m"
echo "======================================================"
echo "          CORELABS TUNNEL INSTANT INSTALLER           "
echo "======================================================"
echo -e "\033[0m"

INSTALL_DIR="$HOME/.corelabs-tunnel"
BIN_DIR="/usr/local/bin"

echo "[+] Préparation de l'environnement CoreLabs Tunnel dans $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

if command -v node >/dev/null 2>&1; then
    echo "[+] Node.js détecté."
else
    echo "[!] Node.js est nécessaire pour exécuter le CLI."
fi

echo "[+] Téléchargement du CLI CoreLabs Tunnel depuis le serveur..."
curl -fsSL https://tunnel.corelabs.network/cli.js -o "$INSTALL_DIR/cli.js" || wget -q https://tunnel.corelabs.network/cli.js -O "$INSTALL_DIR/cli.js"

echo "[+] Création du raccourci système 'corelabs-tunnel'..."
cat << 'EOF' > "$INSTALL_DIR/corelabs-tunnel"
#!/usr/bin/env bash
node "$HOME/.corelabs-tunnel/cli.js" "$@"
EOF
chmod +x "$INSTALL_DIR/corelabs-tunnel"

if [ -w "$BIN_DIR" ]; then
    cp "$INSTALL_DIR/corelabs-tunnel" "$BIN_DIR/corelabs-tunnel"
    echo "[+] Commande 'corelabs-tunnel' installée dans $BIN_DIR/corelabs-tunnel !"
fi

echo -e "\033[1;32m[✓] Installation terminée ! Lancement de CoreLabs Tunnel...\033[0m\n"
node "$INSTALL_DIR/cli.js" "$@"
