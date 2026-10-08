import { analyze, isConfigured, json } from "./analyze.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405, { allow: "GET" });
      return json({ claudeConfigured: isConfigured(env) });
    }
    if (url.pathname === "/api/analyze") return analyze(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found." }, 404);
    const assetResponse = await env.ASSETS.fetch(request);

    // Keep every real AZIS site asset and route on azis.net.
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    // Preserve non-navigation behavior for methods that should not be redirected.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return assetResponse;
    }

    // Legacy Tistory URLs keep their path and query string on the blog subdomain.
    const sourceUrl = new URL(request.url);
    const destination = new URL(sourceUrl.pathname + sourceUrl.search, "https://blog.azis.net");

    return Response.redirect(destination.toString(), 301);
  },
};
