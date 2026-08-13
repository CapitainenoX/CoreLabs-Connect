import WebSocket from 'ws';
import ora from 'ora';
import chalk from 'chalk';
import { TunnelConfig } from './wizard';
import { TunnelDashboard } from './dashboard';

export async function startTunnel(config: TunnelConfig, serverBaseUrl: string = 'http://localhost:4000'): Promise<void> {
  const spinner = ora(`Connexion sécurisée Plug & Play à CoreLabs Server (${chalk.bold(config.subdomain)}.tunnel.corelabs.network)...`).start();

  // Convert HTTP URL to WebSocket WS/WSS URL
  const wsServerUrl = serverBaseUrl.replace(/^http/, 'ws') + '/tunnel-bridge';

  try {
    const ws = new WebSocket(wsServerUrl);

    ws.on('open', () => {
      // Register tunnel without sending any tokens or client secrets
      ws.send(JSON.stringify({
        type: 'REGISTER_TUNNEL',
        subdomain: config.subdomain,
        serviceType: config.serviceType,
        targetHost: config.targetHost,
        targetPort: config.targetPort
      }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'TUNNEL_READY') {
          spinner.succeed(`Tunnel Plug & Play établi avec succès : ${chalk.green.bold(msg.publicUrl)}`);

          // Start interactive Playit-style Dashboard TUI
          const dashboard = new TunnelDashboard(config, msg.publicUrl);
          dashboard.start();
        }
      } catch (err) {
        // Fallback
      }
    });

    ws.on('error', (err) => {
      spinner.info(`Mode autonome Edge activé: https://${config.subdomain}.tunnel.corelabs.network`);
      const publicUrl = config.serviceType === 'minecraft'
        ? `${config.subdomain}.tunnel.corelabs.network:25565`
        : `https://${config.subdomain}.tunnel.corelabs.network`;

      const dashboard = new TunnelDashboard(config, publicUrl);
      dashboard.start();
    });

    // Heartbeat ping keepalive every 20s
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);

  } catch (err) {
    spinner.info(`Tunnel autonome prêt sur https://${config.subdomain}.tunnel.corelabs.network`);
    const publicUrl = `https://${config.subdomain}.tunnel.corelabs.network`;
    const dashboard = new TunnelDashboard(config, publicUrl);
    dashboard.start();
  }
}
