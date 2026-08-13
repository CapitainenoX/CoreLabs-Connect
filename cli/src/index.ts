#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { runSetupWizard } from './wizard';
import { startTunnel } from './tunnel-client';

const program = new Command();

program
  .name('corelabs-tunnel')
  .description('CoreLabs Tunnel - Solution ultra rapide pour exposer Web, Minecraft et services TCP/UDP')
  .version('1.0.0')
  .option('-t, --type <serviceType>', 'Type de service (minecraft, web, other)')
  .option('-h, --host <targetHost>', 'IP de la machine cible (ex: 127.0.0.1 ou 192.168.1.45)')
  .option('-p, --port <targetPort>', 'Port cible (ex: 25565, 8080, 3000)', parseInt)
  .option('-s, --subdomain <subdomain>', 'Sous-domaine personnalisé (*.tunnel.corelabs.network)')
  .option('--server <serverUrl>', 'URL du serveur CoreLabs Backend', 'http://localhost:4000')
  .action(async (options) => {
    let config;

    if (options.type && options.port && options.subdomain) {
      config = {
        serviceType: options.type as any,
        targetHost: options.host || '127.0.0.1',
        targetHostLabel: options.host || '127.0.0.1',
        targetPort: options.port,
        subdomain: options.subdomain
      };
    } else {
      config = await runSetupWizard();
    }

    await startTunnel(config, options.server);
  });

program.parse(process.argv);
