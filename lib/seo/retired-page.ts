const removedPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Page removed · Imladri</title><style>html{color-scheme:dark}body{margin:0;background:#000;color:#fafafa;font:16px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{width:min(38rem,calc(100% - 3rem));padding:3rem 0}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;margin:0 0 1rem}p{color:#bbb;margin:0 0 1.5rem}a{display:inline-block;color:#000;background:#fafafa;border-radius:2rem;padding:.75rem 1.5rem;text-decoration:none;font-weight:600}a:focus-visible{outline:3px solid #b1d5ff;outline-offset:5px}</style></head><body><main><h1>This page has been removed.</h1><p>Visit Imladri for our current dating waitlist.</p><a href="/">Go to Imladri</a></main></body></html>`;

/** Only confirmed, retired product URLs use this handler. Unknown URLs remain 404. */
export function retiredPage(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : removedPage, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, follow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
