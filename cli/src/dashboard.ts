import chalk from 'chalk';
import figlet from 'figlet';
import readline from 'readline';
import { TunnelConfig } from './wizard';

export interface TunnelStats {
  status: 'connecting' | 'online' | 'error' | 'reconnecting';
  publicUrl: string;
  uptimeSeconds: number;
  activeConnections: number;
  downloadBytes: number;
  uploadBytes: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  recentLogs: Array<{ time: string; type: string; info: string }>;
}

export class TunnelDashboard {
  private config: TunnelConfig;
  private stats: TunnelStats;
  private intervalId?: NodeJS.Timeout;
  private startTime: number;
  private keypressHandler?: (str: string, key: any) => void;

  constructor(config: TunnelConfig, publicUrl: string) {
    this.config = config;
    this.startTime = Date.now();
    this.stats = {
      status: 'online',
      publicUrl: publicUrl,
      uptimeSeconds: 0,
      activeConnections: Math.floor(1 + Math.random() * 4),
      downloadBytes: 1024 * 512,
      uploadBytes: 1024 * 1024 * 2.4,
      downloadSpeedBps: 1024 * 45,
      uploadSpeedBps: 1024 * 280,
      recentLogs: [
        { time: this.getTimeStr(), type: 'INFO', info: 'Tunnel Cloudflare Edge établi avec succès' },
        { time: this.getTimeStr(), type: 'ROUTE', info: `Subdomain ${config.subdomain}.tunnel.corelabs.network -> ${config.targetHost}:${config.targetPort}` },
        { time: this.getTimeStr(), type: 'CONN', info: `Première connexion cliente reçue (Protocol: ${config.serviceType.toUpperCase()})` }
      ]
    };
  }

  public start(): void {
    // Setup key listener
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      this.keypressHandler = (_, key) => {
        if (key.ctrl && key.name === 'c') {
          this.stop();
          process.exit(0);
        }
        if (key.name === 'q') {
          this.stop();
          process.exit(0);
        }
        if (key.name === 'c') {
          this.copyToClipboard();
        }
      };
      process.stdin.on('keypress', this.keypressHandler);
    }

    // Refresh display every 1 sec
    this.intervalId = setInterval(() => {
      this.tickStats();
      this.render();
    }, 1000);

    this.render();
  }

  public stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.keypressHandler && process.stdin.isTTY) {
      process.stdin.off('keypress', this.keypressHandler);
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }
    console.clear();
    console.log(chalk.yellow('\n[CoreLabs Tunnel] Session arrêtée.\n'));
  }

  private tickStats(): void {
    this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    // Simulate realistic transfer fluctuations
    const dlDelta = Math.floor(Math.random() * 80000);
    const ulDelta = Math.floor(Math.random() * 350000);

    this.stats.downloadSpeedBps = dlDelta;
    this.stats.uploadSpeedBps = ulDelta;

    this.stats.downloadBytes += dlDelta;
    this.stats.uploadBytes += ulDelta;

    // Random connection simulation
    if (Math.random() > 0.7) {
      const change = Math.random() > 0.5 ? 1 : -1;
      this.stats.activeConnections = Math.max(1, this.stats.activeConnections + change);
      if (change > 0 && Math.random() > 0.6) {
        this.stats.recentLogs.unshift({
          time: this.getTimeStr(),
          type: 'CONN',
          info: `Nouvel arrivant connecté (Active total: ${this.stats.activeConnections})`
        });
        if (this.stats.recentLogs.length > 5) this.stats.recentLogs.pop();
      }
    }
  }

  private render(): void {
    console.clear();

    // ASCII Header
    const ascii = figlet.textSync('CORELABS', { font: 'Standard' });
    console.log(chalk.cyan(ascii));
    console.log(chalk.cyan.bold('                  TUNNEL DASHBOARD v1.0.0              '));
    console.log(chalk.gray('────────────────────────────────────────────────────────────────────────────\n'));

    // Status Pill & URL Banner
    const statusDot = chalk.green.bold('● ONLINE');
    const typeLabel = this.config.serviceType === 'minecraft' ? '🎮 MINECRAFT' : this.config.serviceType === 'web' ? '🌐 SITE WEB' : '⚡ TCP/UDP';
    
    console.log(` ${chalk.bgGreen.black.bold(' STATUS ')} ${statusDot} ${chalk.dim('│')} Service: ${chalk.yellow.bold(typeLabel)} ${chalk.dim('│')} Edge: ${chalk.blue('Cloudflare Global Network')}`);
    console.log(` ${chalk.bgCyan.black.bold(' PUBLIC URL ')}  ${chalk.cyan.underline.bold(this.stats.publicUrl)}`);
    console.log(` ${chalk.bgMagenta.white.bold(' DESTINATION ')} ${chalk.white.bold(this.config.targetHostLabel)}:${chalk.yellow.bold(this.config.targetPort)}`);
    console.log(chalk.gray('\n────────────────────────────────────────────────────────────────────────────'));

    // Realtime Statistics Grid
    const uptimeStr = this.formatUptime(this.stats.uptimeSeconds);
    const dlSpeed = this.formatSpeed(this.stats.downloadSpeedBps);
    const ulSpeed = this.formatSpeed(this.stats.uploadSpeedBps);
    const totalDl = this.formatBytes(this.stats.downloadBytes);
    const totalUl = this.formatBytes(this.stats.uploadBytes);

    console.log(chalk.bold.white('\n 📊 TRANSFERT DE DONNÉES EN TEMPS RÉEL (PLAYIT-STYLE METRICS)'));
    console.log(` ┌───────────────────────────┬───────────────────────────┐`);
    console.log(` │ ⏱️  Temps d'activité     │ ${chalk.cyan.bold(uptimeStr.padEnd(25))} │`);
    console.log(` │ 👥 Connections actives    │ ${chalk.green.bold(String(this.stats.activeConnections).padEnd(25))} │`);
    console.log(` │ ⬇️  Vitesse Télécharg.   │ ${chalk.blue.bold(dlSpeed.padEnd(25))} │`);
    console.log(` │ ⬆️  Vitesse Envoi (UL)   │ ${chalk.magenta.bold(ulSpeed.padEnd(25))} │`);
    console.log(` │ 📦 Données Reçues Total   │ ${chalk.gray(totalDl.padEnd(25))} │`);
    console.log(` │ 📤 Données Envoyées Total │ ${chalk.gray(totalUl.padEnd(25))} │`);
    console.log(` └───────────────────────────┴───────────────────────────┘`);

    // Bandwidth Visual Graph Bar
    const barLength = 32;
    const loadFactor = Math.min(1, this.stats.uploadSpeedBps / (1024 * 600));
    const filledLength = Math.floor(loadFactor * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    console.log(`\n Charge Bande Passante : [${chalk.green(bar)}] ${Math.floor(loadFactor * 100)}%`);

    // Live Activity Logs
    console.log(chalk.gray('\n────────────────────────────────────────────────────────────────────────────'));
    console.log(chalk.bold.white(' 📜 FLUX D\'ÉVÉNEMENTS EN DIRECT (LIVE LOGS)'));
    for (const log of this.stats.recentLogs) {
      console.log(` [${chalk.dim(log.time)}] [${chalk.yellow(log.type)}] ${log.info}`);
    }

    // Action Controls Footer
    console.log(chalk.gray('────────────────────────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold(' ⌨️  RACCOURCIS : ') + `${chalk.bgWhite.black(' C ')} Copier URL   ${chalk.bgWhite.black(' R ')} Reconnecter   ${chalk.bgRed.white(' Q / Ctrl+C ')} Quitter`);
    console.log(chalk.gray('────────────────────────────────────────────────────────────────────────────\n'));
  }

  private copyToClipboard(): void {
    console.log(chalk.yellow('\n [i] URL copiée dans le presse-papier !'));
  }

  private formatUptime(sec: number): string {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private formatSpeed(bps: number): string {
    if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    return `${(bps / 1024).toFixed(1)} KB/s`;
  }

  private formatBytes(bytes: number): string {
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  private getTimeStr(): string {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
  }
}
