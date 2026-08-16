# Public Web Surface

The HTTP server provides a deliberately small public web surface alongside its REST and MCP interfaces:

- `GET /` is a nearby-restaurant homepage.
- `GET /poi/:osmId` is a read-only, full POI dossier.

These routes are presentation layers over the public REST API. They do not create an alternative data contract or call the database directly.

## Homepage

`public/index.html`, `public/home.css`, and `public/home.js` implement the homepage. After the browser grants geolocation permission, the client requests nearby restaurants from:

```text
GET /api/v1/search/pois?latitude=<latitude>&longitude=<longitude>&poi_type=restaurant&radius_km=10&limit=25&offset=<offset>
```

Results are ordered by the API's distance calculation. The client appends additional pages when its sentinel reaches the viewport; the explicit **Load more** button remains as a keyboard and permission-safe fallback. Every restaurant card links directly to `/poi/:osmId`.

The client also makes a best-effort `search/cities` request to label the surrounding area. A failed city label request must not prevent restaurant results from rendering.

## POI Dossier

The POI page is intentionally not a client-side router. `src/index-http.js` recognizes numeric `/poi/:osmId` paths and serves `web/poi.html`, which loads `web/js/poi-app.js`.

`poi-app.js` extracts the numeric ID from the path and loads exactly one resource:

```text
GET /api/v1/poi/:osmId
```

It uses a small same-origin JavaScript module for the page's local detail state. It has no dependency on the retired home, map, route, trip-composer stores, or third-party script CDN. This separation is important: direct links, browser refreshes, and new tabs must always render the dossier rather than falling back to a generic application home state.

The dossier displays available address, contact, Google Places photos and reviews, enrichment status, AI summaries, external Maps/website/call links, and a raw-data modal. It remains readable when optional Google enrichment has not completed. If the detail request fails, it renders an explicit unavailable state instead of a blank document.

## Asset Delivery And Security

`src/index-http.js` owns the allowlist of public static assets. Add a new browser asset there before referencing it from a public document; the server returns 404 for unlisted files.

HTML documents are sent with `Cache-Control: no-store`. CSS and JavaScript assets receive a build-derived query string in rendered HTML, so a newly deployed page requests the matching bundle rather than a stale one. Static assets can therefore use a short public cache lifetime.

The public HTML content security policy is route-specific:

- Homepage: same-origin scripts, styles, and connections; HTTPS images are allowed for POI photography.
- POI dossier: same-origin scripts, styles, and connections only; HTTPS images are allowed for POI photography.

External URLs shown in the dossier are normalized by `web/js/format-store.js`. Only non-local `http` and `https` URLs are accepted. Telephone links are created only from a compacted, valid telephone number.

## Local Verification

Start the HTTP service against the local PostgreSQL environment:

```bash
npm run start:http
```

Then check the document, its page-specific bundle, and the underlying data independently:

```bash
curl -fsS http://localhost:3000/poi/1700165213
curl -fsS http://localhost:3000/js/poi-app.js
curl -fsS http://localhost:3000/api/v1/poi/1700165213
```

For a browser check, open a numeric POI URL directly rather than navigating from the homepage. Verify that the browser requests `poi-app.js`, that a dossier or explicit unavailable state is shown, and that no legacy `/js/app.js` request occurs.

## Deployment

Pushing `main` starts the required GitHub Actions workflow named `CI`. The EC2 `ec2-pull-deploy.timer` checks for approved commits every minute. For this service it:

1. Refuses to deploy when the EC2 checkout is dirty.
2. Fetches `origin/main` and waits for a successful `CI` run for the target SHA.
3. Checks out that exact SHA, runs `npm ci`, and restarts `travel-mcp-server.service`.
4. Retries `curl -fsS http://127.0.0.1:3000/health` before recording the deployment as successful.
5. Rolls back to the previous SHA if installation, restart, or health checking fails, and blocks the failed SHA from another automatic retry.

After CI succeeds, verify a release through the production document and API, for example:

```bash
curl -fsS https://travel.arjanvandermeer.com/poi/1700165213
curl -fsS https://travel.arjanvandermeer.com/api/v1/poi/1700165213
```

The production HTML should contain the current build's `/js/poi-app.js?v=...` reference.
