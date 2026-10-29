import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import ProxyList from "free-proxy";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/*
 * Public proxy pool for YouTube caption requests.
 *
 * Free public proxies are volatile: many are dead, slow, or already blocked by
 * YouTube. The pool therefore only hands out candidates; the caller tries them
 * one by one and keeps the first one that works.
 */

const LOG_PREFIX = "[proxy-pool]";

const POOL_TTL_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 8_000;
const MAX_POOL_SIZE = 60;
const MAX_CACHED_AGENTS = 80;

// Plain-text lists used when the free-proxy scrape comes back empty.
const LIST_SOURCES = [
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
];

let cachedPool: { proxies: string[]; loadedAt: number } | null = null;
let inFlightLoad: Promise<string[]> | null = null;

const agents = new Map<string, ProxyAgent>();

function poolEnabled(): boolean {
  const flag = (process.env.YOUTUBE_PROXY_POOL ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") return false;
  return true;
}

function normalizeProxy(raw: string): string | null {
  const trimmed = raw.replace(/["'\s]/g, "");
  if (!trimmed) return null;

  const match = /^(?:(https?):\/\/)?([A-Za-z0-9._-]+):(\d{1,5})$/.exec(trimmed);
  if (!match) return null;

  const scheme = (match[1] ?? "http").toLowerCase();
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return `${scheme}://${match[2]}:${port}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function fetchTextDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

  try {
    const response = await undiciFetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "yt2blog-proxy-pool" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// Used when YOUTUBE_PROXY is configured: the list itself is fetched through
// that known-good proxy, which keeps the pool reachable on restricted networks.
async function fetchTextThroughProxy(url: string, proxyUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const agent = new HttpsProxyAgent(proxyUrl);
    const request = https.get(
      url,
      { agent, headers: { "User-Agent": "yt2blog-proxy-pool" }, timeout: LIST_TIMEOUT_MS },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 400) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("timeout", () => request.destroy(new Error("LIST_TIMEOUT")));
    request.on("error", reject);
  });
}

async function loadFromFreeProxy(): Promise<string[]> {
  const list = new ProxyList();
  const rows = await withTimeout(list.get(), LIST_TIMEOUT_MS, "free-proxy");

  const proxies: string[] = [];
  for (const row of rows) {
    const url =
      normalizeProxy(row.url ?? "") ??
      normalizeProxy(`${row.protocol ?? "http"}://${row.ip}:${row.port}`);
    if (url) proxies.push(url);
  }

  return proxies;
}

async function loadPool(): Promise<string[]> {
  const collected = new Set<string>();

  try {
    const fromPackage = await loadFromFreeProxy();
    for (const proxy of fromPackage) collected.add(proxy);
  } catch (caught) {
    console.log(
      `${LOG_PREFIX} free-proxy failed: ${(caught instanceof Error ? caught.message : String(caught)).slice(0, 120)}`
    );
  }

  const bootstrap = process.env.YOUTUBE_PROXY?.trim() ?? "";

  for (const source of LIST_SOURCES) {
    if (collected.size >= MAX_POOL_SIZE) break;
    try {
      const body = bootstrap
        ? await fetchTextThroughProxy(source, bootstrap)
        : await fetchTextDirect(source);

      for (const line of body.split("\n")) {
        const proxy = normalizeProxy(line);
        if (proxy) collected.add(proxy);
        if (collected.size >= MAX_POOL_SIZE) break;
      }
    } catch (caught) {
      console.log(
        `${LOG_PREFIX} source failed host=${new URL(source).host} message=${(caught instanceof Error ? caught.message : String(caught)).slice(0, 120)}`
      );
    }
  }

  const proxies = Array.from(collected);
  console.log(`${LOG_PREFIX} pool loaded count=${proxies.length}`);
  return proxies;
}

async function getPool(): Promise<string[]> {
  if (cachedPool && Date.now() - cachedPool.loadedAt < POOL_TTL_MS) {
    return cachedPool.proxies;
  }

  if (!inFlightLoad) {
    inFlightLoad = loadPool()
      .then((proxies) => {
        cachedPool = { proxies, loadedAt: Date.now() };
        return proxies;
      })
      .finally(() => {
        inFlightLoad = null;
      });
  }

  return inFlightLoad;
}

function shuffle<T>(input: T[]): T[] {
  const items = input.slice();
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Random, de-duplicated proxy candidates. Returns an empty array when the pool
 * is disabled or every list source is unreachable, which tells the caller to
 * fall back to a direct request.
 */
export async function getProxyCandidates(limit: number): Promise<string[]> {
  if (!poolEnabled()) {
    console.log(`${LOG_PREFIX} disabled via YOUTUBE_PROXY_POOL`);
    return [];
  }

  let pool: string[];
  try {
    pool = await getPool();
  } catch (caught) {
    console.log(
      `${LOG_PREFIX} load error: ${(caught instanceof Error ? caught.message : String(caught)).slice(0, 120)}`
    );
    return [];
  }

  const bootstrap = process.env.YOUTUBE_PROXY?.trim();
  const unique = Array.from(new Set(pool.filter((proxy) => proxy !== bootstrap)));

  if (unique.length === 0) return [];

  const picked = shuffle(unique).slice(0, Math.max(1, limit));
  // The configured proxy (if any) goes last: a random free proxy is tried
  // first, then the known-good one as a safety net.
  return bootstrap ? [...picked, bootstrap] : picked;
}

export function createProxyFetch(proxyUrl: string): typeof fetch {
  let agent = agents.get(proxyUrl);
  if (!agent) {
    if (agents.size >= MAX_CACHED_AGENTS) {
      agents.clear();
    }
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }

  const dispatcher = agent;

  return ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}
