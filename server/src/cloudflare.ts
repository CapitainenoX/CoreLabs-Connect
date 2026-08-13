import fetch from 'node-fetch';

export interface CloudflareConfig {
  apiToken?: string;
  zoneId?: string;
  domainName: string;
}

export class CloudflareManager {
  private apiToken: string;
  private zoneId: string;
  private domainName: string;

  constructor() {
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.zoneId = process.env.CLOUDFLARE_ZONE_ID || '';
    this.domainName = process.env.DOMAIN_NAME || 'tunnel.corelabs.network';
  }

  /**
   * Automatically provisions a CNAME record in Cloudflare for [subdomain].tunnel.corelabs.network
   */
  public async createSubdomainRecord(subdomain: string, targetCname: string = 'tunnel.corelabs.network'): Promise<boolean> {
    if (!this.apiToken || !this.zoneId) {
      console.log(`[Cloudflare Log] Token ou ZoneID non renseigné dans .env. Mode autonome pour: ${subdomain}.${this.domainName}`);
      return true;
    }

    try {
      const recordName = `${subdomain}.${this.domainName}`;
      const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/dns_records`;

      console.log(`[Cloudflare API] Envoi requête de création DNS CNAME: ${recordName} -> ${targetCname}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'CNAME',
          name: recordName,
          content: targetCname,
          ttl: 1, // Auto TTL
          proxied: true // Cloudflare DDoS protection & HTTPS proxy
        })
      });

      const data: any = await response.json();
      if (data.success) {
        console.log(`[Cloudflare API Success] Enregistrement DNS créé avec succès: ${recordName} -> ${targetCname}`);
        return true;
      } else {
        console.error(`[Cloudflare API Error] Échec de création DNS:`, JSON.stringify(data.errors, null, 2));
        return false;
      }
    } catch (err: any) {
      console.error(`[Cloudflare API Exception] Exception réseau:`, err.message, err.stack);
      return false;
    }
  }
}
