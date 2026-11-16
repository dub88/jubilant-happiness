import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (request: Request) => Response | Promise<Response>;
export type Route = string | { status?: number; headers?: Record<string, string>; body?: string } | Handler;
/** Routes may depend on the server's own origin, which is only known once it is listening. */
export type Routes = (origin: string) => Record<string, Route>;

export interface TestSite {
  origin: string;
  close(): Promise<void>;
}

/** Serve an in-memory site on a free local port. Unknown paths answer 404. */
export async function serve(routes: Routes): Promise<TestSite> {
  let table: Record<string, Route> = {};
  const server = createServer(async (request, response) => {
    const route = table[request.url ?? '/'];
    if (typeof route === 'function') {
      // Hand the route a web Request, as a framework's route handler would get.
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const init: RequestInit = { method: request.method ?? 'GET', headers };
      if (chunks.length > 0) init.body = Buffer.concat(chunks);
      const answer = await route(new Request(`http://${request.headers.host}${request.url}`, init));
      response.writeHead(answer.status, Object.fromEntries(answer.headers)).end(await answer.text());
      return;
    }
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
      return;
    }
    if (typeof route === 'string') {
      const type = route.startsWith('<?xml') ? 'application/xml' : route.startsWith('<') ? 'text/html' : 'text/plain';
      response.writeHead(200, { 'content-type': type }).end(route);
      return;
    }
    response.writeHead(route.status ?? 200, { 'content-type': 'text/html', ...route.headers }).end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  // A host name, not an IP address, so tests can also name its www variant.
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  table = routes(origin);
  return {
    origin,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export const redirect = (location: string, status = 308): Route => ({ status, headers: { location } });

export interface PageSpec {
  /** Site origin used in canonical and Open Graph URLs. */
  origin: string;
  path: string;
  title?: string;
  description?: string;
  /** Extra markup for <head>. */
  head?: string;
  body?: string;
  /** Leave out the tags a well-formed page has, to build a broken page by hand. */
  bare?: boolean;
}

export const GOOD_DESCRIPTION =
  'Fresh bread, pastries and custom cakes baked every morning in the heart of town. Order ahead online or visit the shop today.';

/** A page that passes every rule unless the spec says otherwise. */
export function page(spec: PageSpec): string {
  const title = spec.title ?? `Example Bakery page ${spec.path}`;
  const description = spec.description ?? `${GOOD_DESCRIPTION} (${spec.path})`;
  const url = spec.origin + spec.path;
  const standard = spec.bare
    ? ''
    : `<title>${title}</title>
       <meta name="description" content="${description}">
       <link rel="canonical" href="${url}">
       <meta property="og:title" content="${title}">
       <meta property="og:type" content="website">
       <meta property="og:url" content="${url}">
       <meta property="og:image" content="${spec.origin}/hero.jpg">`;
  return `<!doctype html>
<html lang="en">
  <head>${standard}${spec.head ?? ''}</head>
  <body>${spec.body ?? `<h1>${title}</h1>`}</body>
</html>`;
}

export function sitemap(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`;
}

export const jsonLd = (data: unknown): string => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
