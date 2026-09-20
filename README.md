# Geode iOS Installer Website

A small self-hosted website for iPhone that:

- checks the latest official `geode-sdk/ios-launcher` GitHub release
- links to the newest official IPA
- can mirror the official IPA on your server
- accepts an IPA that is already signed for your iPhone
- generates an Apple OTA `manifest.plist`
- creates a one-tap `itms-services://` install link

## Important

This does **not** bypass Apple code signing.

For the one-tap Install button to work, the IPA you upload must already be signed with a valid certificate and provisioning profile that permits installation on the target device.

Do not expose private signing keys or `.p12` files on a public website.

## Run locally

1. Install Node.js 20+
2. Open a terminal in this folder
3. Run:

   npm install
   npm start

4. Open:

   http://localhost:3000

## Deploy for iPhone installation

OTA installation requires HTTPS.

Set the public URL as `BASE_URL`.

Example:

   BASE_URL=https://your-domain.com npm start

Good hosts for this kind of Node app include Railway, Render, Fly.io, or a VPS.

Make sure the host has persistent storage if you want uploaded IPAs to remain after a restart.

## iPhone flow

1. Open the deployed HTTPS site in Safari.
2. Download the official Geode IPA if you need it.
3. Sign the IPA using your own legitimate signing setup.
4. Upload the signed IPA back to the site.
5. Tap **Install Geode**.
6. iOS will read the manifest and attempt installation.

## Why the website cannot do 100% of signing by itself

A valid Apple signing identity is still required. A normal website cannot manufacture a valid Apple Developer or Enterprise identity.

If you own a valid Apple certificate, a private server-side signing service can be added later. Keep that private rather than making it a public certificate-sharing service.