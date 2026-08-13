import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { discoverLANDevices, getLocalIP, LANDevice } from './lan-discovery';

export interface TunnelConfig {
  serviceType: 'minecraft' | 'web' | 'other';
  targetHost: string;
  targetHostLabel: string;
  targetPort: number;
  subdomain: string;
  serverUrl?: string;
}

export async function runSetupWizard(): Promise<TunnelConfig> {
  console.clear();
  console.log(chalk.cyan.bold('\n======================================================'));
  console.log(chalk.cyan.bold('          CORELABS TUNNEL — Quick Setup Wizard        '));
  console.log(chalk.cyan.bold('======================================================\n'));

  // 1. Service Type Choice
  const { serviceType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'serviceType',
      message: 'Quel type de service souhaitez-vous exposer en tunnel ?',
      choices: [
        {
          name: '🎮  Serveur Minecraft (TCP/UDP - Java / Bedrock)',
          value: 'minecraft'
        },
        {
          name: '🌐  Site Web / Application HTTP (React, Next.js, Node, Nginx...)',
          value: 'web'
        },
        {
          name: '⚡  Autre service TCP / UDP (Base de données, SSH, API...)',
          value: 'other'
        }
      ]
    }
  ]);

  // Default default port based on service type
  let defaultPort = 8080;
  if (serviceType === 'minecraft') defaultPort = 25565;
  if (serviceType === 'web') defaultPort = 3000;

  // 2. Machine Selection
  const { hostChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'hostChoice',
      message: 'Où se situe le service à partager ?',
      choices: [
        {
          name: '💻  Cette machine (127.0.0.1 / localhost)',
          value: 'local'
        },
        {
          name: '📡  Un autre appareil du réseau local (LAN)',
          value: 'lan'
        },
        {
          name: '✏️   Saisir manuellement une adresse IP',
          value: 'custom'
        }
      ]
    }
  ]);

  let targetHost = '127.0.0.1';
  let targetHostLabel = 'Localhost (127.0.0.1)';

  if (hostChoice === 'local') {
    targetHost = '127.0.0.1';
    targetHostLabel = `Cette machine (127.0.0.1)`;
  } else if (hostChoice === 'lan') {
    const spinner = ora('Analyse du réseau local pour détecter les appareils...').start();
    const devices: LANDevice[] = await discoverLANDevices();
    spinner.succeed(`Détection terminée: ${devices.length} appareil(s) trouvé(s) sur le réseau local.`);

    const lanChoices = devices.map(device => ({
      name: `🖥️  ${chalk.green(device.ip)}  ${chalk.dim('—')}  ${chalk.bold(device.name)}`,
      value: device
    }));

    lanChoices.push({
      name: '✏️   Saisir une autre adresse IP du réseau local...',
      value: { ip: 'CUSTOM_INPUT', name: 'Saisie manuelle' }
    });

    const { selectedDevice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedDevice',
        message: 'Sélectionnez l\'appareil du réseau local à cibler :',
        choices: lanChoices
      }
    ]);

    if (selectedDevice.ip === 'CUSTOM_INPUT') {
      const { customLanIp } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customLanIp',
          message: 'Entrez l\'adresse IP locale (ex: 192.168.1.45) :',
          default: '192.168.1.50',
          validate: (input: string) =>
            /^(\d{1,3}\.){3}\d{1,3}$/.test(input) || 'Veuillez entrer une IP valide (ex: 192.168.1.10)'
        }
      ]);
      targetHost = customLanIp;
      targetHostLabel = `Appareil LAN (${customLanIp})`;
    } else {
      targetHost = selectedDevice.ip;
      targetHostLabel = `${selectedDevice.name} (${selectedDevice.ip})`;
    }
  } else {
    const { customIp } = await inquirer.prompt([
      {
        type: 'input',
        name: 'customIp',
        message: 'Entrez l\'adresse IP hôte cible :',
        default: '127.0.0.1',
        validate: (input: string) =>
          /^(\d{1,3}\.){3}\d{1,3}$/.test(input) || 'Veuillez entrer une IP IPv4 valide'
      }
    ]);
    targetHost = customIp;
    targetHostLabel = `Hôte (${customIp})`;
  }

  // 3. Target Port
  const { targetPort } = await inquirer.prompt([
    {
      type: 'input',
      name: 'targetPort',
      message: `Sur quel port le service écoute-t-il sur ${chalk.cyan(targetHost)} ?`,
      default: defaultPort,
      validate: (input: any) => {
        const num = parseInt(input, 10);
        return (!isNaN(num) && num > 0 && num <= 65535) || 'Veuillez entrer un numéro de port valide (1-65535)';
      },
      filter: (input: any) => parseInt(input, 10)
    }
  ]);

  // 4. Subdomain Name
  const defaultSubdomain = `core-${Math.floor(1000 + Math.random() * 9000)}`;
  const { subdomain } = await inquirer.prompt([
    {
      type: 'input',
      name: 'subdomain',
      message: `Choisissez votre sous-domaine (${chalk.bold('[nom]')}.tunnel.corelabs.network) :`,
      default: defaultSubdomain,
      validate: (input: string) => {
        const sanitized = input.trim().toLowerCase();
        if (!/^[a-z0-9-]+$/.test(sanitized)) {
          return 'Le sous-domaine ne doit contenir que des lettres minuscules, chiffres et tirets.';
        }
        if (sanitized.length < 3 || sanitized.length > 32) {
          return 'Le nom de sous-domaine doit faire entre 3 et 32 caractères.';
        }
        return true;
      },
      filter: (input: string) => input.trim().toLowerCase()
    }
  ]);

  return {
    serviceType,
    targetHost,
    targetHostLabel,
    targetPort,
    subdomain
  };
}
