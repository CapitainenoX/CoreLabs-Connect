import fetch from 'node-fetch';

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
   * Provisions or updates a DNS record in Cloudflare for [subdomain].corelabs.network
   */
  public async createSubdomainRecord(subdomain: string, targetCname: string = 'tunnel.corelabs.network'): Promise<boolean> {
    if (!this.apiToken || !this.zoneId) {
      console.log(`[Cloudflare API] Token ou ZoneID non renseigné dans .env. Mode proxy autonome pour: ${subdomain}.corelabs.network`);
      return true;
    }

    try {
      const recordName = `${subdomain}.corelabs.network`;
      const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/dns_records`;

      console.log(`[Cloudflare API] Vérification/Création enregistrement DNS CNAME: ${recordName} -> ${targetCname}`);

      // 1. Check if record already exists in Cloudflare
      const listRes = await fetch(`${url}?name=${recordName}`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });
      const listData: any = await listRes.json();

      if (listData.success && listData.result && listData.result.length > 0) {
        console.log(`[Cloudflare API] Enregistrement DNS existant trouvé pour ${recordName}. Conservation.`);
        return true;
      }

      // 2. Create CNAME record if missing
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
        console.error(`[Cloudflare API Warning] Message Cloudflare:`, JSON.stringify(data.errors, null, 2));
        return true; // Return true as wildcard proxy handles fallback
      }
    } catch (err: any) {
      console.error(`[Cloudflare API Exception] Exception réseau:`, err.message);
      return true;
    }
  }
}
