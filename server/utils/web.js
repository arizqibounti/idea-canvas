const { Resolver } = require('dns').promises ? require('dns') : {};
const dnsResolve = require('dns').promises?.resolve4;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; IdeaGraphBot/1.0)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// Private/reserved IPv4 CIDR ranges that must never be reached via SSRF
const BLOCKED_IPV4_RANGES = [
  // Loopback
  [0x7f000000, 0xff000000], // 127.0.0.0/8
  // Link-local (AWS/GCP/Azure metadata)
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
  // Private
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  // Unspecified / broadcast
  [0x00000000, 0xff000000], // 0.0.0.0/8
  [0xe0000000, 0xe0000000], // 224.0.0.0+ (multicast)
  [0xffffffff, 0xffffffff], // 255.255.255.255
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
}

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([net, mask]) => (n & mask) === (net & mask));
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
]);

/**
 * Returns true if the URL is safe to fetch (public internet only).
 * Blocks: non-http(s) schemes, private/loopback IPv4, cloud metadata hosts,
 * and common internal hostnames.
 */
async function isSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // Only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;

  // Block IPv6 loopback / link-local literals
  if (hostname === '::1' || hostname === '[::1]') return false;
  if (/^fe80:/i.test(hostname) || /^\[fe80:/i.test(hostname)) return false;

  // If hostname is a bare IPv4 address, check directly
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) return false;
    return true;
  }

  // Resolve hostname to IP(s) and check each (guards against DNS rebinding)
  if (dnsResolve) {
    try {
      const addresses = await dnsResolve(hostname);
      if (!addresses || addresses.length === 0) return false;
      for (const addr of addresses) {
        if (isBlockedIPv4(addr)) return false;
      }
    } catch {
      // DNS resolution failed — treat as unsafe to be conservative
      return false;
    }
  }

  return true;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInternalLinks(html, baseUrl) {
  const { origin } = new URL(baseUrl);
  const linkRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
  const seen = new Set();
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      // Skip mailto, tel, javascript, anchors, external links, assets
      if (/^(mailto:|tel:|javascript:)/.test(href)) continue;
      const resolved = new URL(href, baseUrl).href.split('#')[0].split('?')[0];
      if (!resolved.startsWith(origin)) continue;
      if (seen.has(resolved)) continue;
      if (/\.(png|jpg|jpeg|gif|svg|css|js|ico|pdf|zip|mp4|webp|woff|ttf)$/i.test(resolved)) continue;
      seen.add(resolved);
      links.push(resolved);
    } catch { /* skip malformed URLs */ }
  }
  return links;
}

async function fetchPage(url, maxChars = 12000) {
  try {
    if (!(await isSafeUrl(url))) return null;
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) return null;
    const html = await response.text();
    const text = stripHtml(html).slice(0, maxChars);
    return { url, text, html };
  } catch {
    return null;
  }
}

const PRIORITY_PATTERNS = [
  /\/(about|company|team)/i,
  /\/(solution|product|service|feature)/i,
  /\/(pricing|plan)/i,
  /\/(platform|technology|how-it-works)/i,
  /\/(integrat|partner|api)/i,
  /\/(case-stud|customer|testimonial|success)/i,
  /\/(blog|resource|whitepaper)/i,
  /\/(contact|demo|trial)/i,
];

const HUB_PATTERNS = [
  /\/(blog|blogs|articles|news|press|updates)\/?$/i,
  /\/(docs|documentation|guides|tutorials|learn|help)\/?$/i,
  /\/(resources|whitepapers|case-stud|success-stor)\/?$/i,
  /\/(solutions|products|features|services|tools)\/?$/i,
];

function scoreLinks(links, fetched) {
  return links
    .filter(link => !fetched.has(link))
    .map(link => {
      let score = 0;
      for (const p of PRIORITY_PATTERNS) {
        if (p.test(link)) { score += 10; break; }
      }
      const pathDepth = (new URL(link).pathname.match(/\//g) || []).length;
      score -= pathDepth;
      return { link, score };
    })
    .sort((a, b) => b.score - a.score);
}

async function enrichEntities(gemini, idea, existingUrls = []) {
  const existingDomains = existingUrls.map(u => {
    try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
  }).filter(Boolean);

  try {
    const userMessage = `Extract company, organization, or product names from this text that would benefit from website research. Only include names where visiting their website would provide useful context. Do NOT include any entity whose website domain is already in this list: ${existingDomains.join(', ')}

Text: "${idea}"

Return ONLY a JSON array of objects: [{"name": "Entity Name", "url": "https://likely-website.com"}]
If no entities need research, return []. No explanation, just the JSON array.`;

    const response = await gemini.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: userMessage,
      config: {
        maxOutputTokens: 300,
      },
    });

    const text = (response.text || '[]').trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const entities = JSON.parse(cleaned);
    if (!Array.isArray(entities)) return [];
    return entities.filter(e => e.url && e.name);
  } catch (err) {
    console.error('Entity enrichment error:', err.message);
    return [];
  }
}

module.exports = {
  FETCH_HEADERS,
  stripHtml,
  extractInternalLinks,
  fetchPage,
  scoreLinks,
  PRIORITY_PATTERNS,
  HUB_PATTERNS,
  enrichEntities,
  isSafeUrl,
};
