# Geode iOS Installer Website

## Files

- `public/index.html` — the full HTML page
- `public/styles.css` — all styling
- `public/app.js` — frontend logic
- `server.js` — backend/API
- `package.json` — Node dependencies
- `storage/` — hosted IPA files

## Run it

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open:

```text
http://localhost:3000
```

## Deploy it

For iPhone OTA install links, your public site must use HTTPS.

Set:

```text
BASE_URL=https://yourdomain.com
```

Example:

```bash
BASE_URL=https://yourdomain.com npm start
```

## Important

The website does not bypass Apple code signing.

The IPA you upload must already be legitimately signed with a valid
certificate and provisioning profile that permits the target iPhone
to install it.
