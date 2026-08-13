import { exec } from 'child_process';
import os from 'os';
import dns from 'dns';
import { promisify } from 'util';

const execAsync = promisify(exec);
const reverseDnsAsync = promisify(dns.reverse);

export interface LANDevice {
  ip: string;
  mac?: string;
  name: string;
}

/**
 * Get current machine local network interface IP address
 */
export function getLocalIP(): string {
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

/**
 * Scans the ARP table and attempts hostname resolution for devices on the LAN.
 */
export async function discoverLANDevices(): Promise<LANDevice[]> {
  const devices: LANDevice[] = [];
  const localIP = getLocalIP();

  // Add gateway and common broadcast defaults
  const isWindows = process.platform === 'win32';

  try {
    const command = isWindows ? 'arp -a' : 'arp -n || ip neighbor';
    const { stdout } = await execAsync(command);

    const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
    const macRegex = /([0-9a-fa-f]{2}[:-]){5}([0-9a-fa-f]{2})/i;

    const lines = stdout.split('\n');
    const scannedIPs = new Set<string>();

    for (const line of lines) {
      const ipMatch = line.match(ipRegex);
      if (!ipMatch) continue;

      const ip = ipMatch[1];
      // Skip loopback, multicast, broadcast
      if (
        ip === '127.0.0.1' ||
        ip.startsWith('224.') ||
        ip.startsWith('239.') ||
        ip.endsWith('.255') ||
        scannedIPs.has(ip)
      ) {
        continue;
      }

      scannedIPs.add(ip);
      const macMatch = line.match(macRegex);
      const mac = macMatch ? macMatch[0] : undefined;

      let name = `Appareil LAN (${ip})`;

      // Attempt reverse DNS lookup
      try {
        const hostnames = await Promise.race([
          reverseDnsAsync(ip),
          new Promise<string[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 300)
          )
        ]);
        if (hostnames && hostnames.length > 0) {
          name = hostnames[0].replace(/\.local$/i, '').replace(/\.lan$/i, '');
        }
      } catch {
        // Fallback names for common IP roles
        if (ip.endsWith('.1')) name = 'Routeur / Box Internet (Gateway)';
        else if (ip === localIP) name = 'Cette Machine (Localhost)';
        else name = `Serveur / PC (${ip})`;
      }

      devices.push({ ip, mac, name });
    }
  } catch (err) {
    // If ARP scan fails, provide default local fallback
  }

  // Ensure default items if list is minimal
  if (!devices.some(d => d.ip === localIP)) {
    devices.unshift({
      ip: localIP,
      name: `Machine Actuelle (${os.hostname()})`
    });
  }

  return devices;
}
