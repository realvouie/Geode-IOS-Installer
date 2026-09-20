# Geode One-Click iPhone Installer

This is the closest practical version of:

> Open website → tap Install Geode → server handles the rest.

For a brand-new iPhone, Apple still requires the user to approve the temporary
device-identification profile and the final app installation prompt.

After the profile is approved, this server:

1. receives the iPhone UDID;
2. registers the device through Apple's App Store Connect API;
3. creates an iOS Ad Hoc provisioning profile;
4. downloads the newest official Geode iOS IPA from `geode-sdk/ios-launcher`;
5. re-signs it for the registered iPhone with `zsign`;
6. creates an OTA `manifest.plist`;
7. returns an `itms-services://` install link.

## Requirements

You need:

- an active Apple Developer Program account;
- App Store Connect API access and a `.p8` API key;
- an Apple Distribution certificate with its private key exported as `.p12`;
- the App Store Connect API resource ID of that certificate;
- an HTTPS domain;
- a server capable of running Docker.

Apple limits registered iPhones in a developer team, so this is for a controlled
group of devices, not unlimited public app distribution.

## 1. Configure

Copy:

```bash
cp .env.example .env
```

Fill in:

```text
BASE_URL
APPLE_ISSUER_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY_PATH
APPLE_CERTIFICATE_ID
SIGNING_P12_PATH
SIGNING_P12_PASSWORD
GEODE_BUNDLE_ID
```

The bundle ID must be one your developer team owns or can register.

## 2. Put secrets on the server

For example:

```text
/secrets/AuthKey_ABC123.p8
/secrets/distribution.p12
```

Then point the `.env` paths at them.

Never put the `.p8` or `.p12` files in `public/`.

## 3. Run with Docker

Build:

```bash
docker build -t geode-installer .
```

Run:

```bash
docker run -d \
  --name geode-installer \
  --env-file .env \
  -p 3000:3000 \
  -v /secrets:/run/secrets:ro \
  -v geode-storage:/app/storage \
  -v geode-data:/app/data \
  geode-installer
```

Put Caddy, Nginx, Cloudflare Tunnel, or another HTTPS reverse proxy in front of
port 3000 and make `BASE_URL` match that public HTTPS URL.

## 4. Apple API key

In App Store Connect, the account holder must have API access enabled.
Create an API key with sufficient provisioning permissions and keep the `.p8`
private.

The code uses Apple's provisioning API for:

- Devices
- Bundle IDs
- Profiles

## 5. Distribution certificate

Create/use an Apple Distribution certificate in the same developer team.

Export the certificate *with its private key* as a `.p12`.

Set `APPLE_CERTIFICATE_ID` to that certificate's App Store Connect API resource
ID and `SIGNING_P12_PATH` to the `.p12` file.

## 6. Open the website on an iPhone

The visitor taps:

**Install Geode**

For a new phone:

1. Safari downloads the device-registration profile.
2. iOS asks the visitor to install it in Settings.
3. The profile sends only UDID, iOS version, and device product identifier to
   your server.
4. The server performs registration, provisioning, download, and signing.
5. The site shows **Install Geode** and attempts to launch the install flow.

## Important limitations

- Safari cannot silently install apps. iOS requires user confirmation.
- A website cannot create a real Apple signing identity from nothing.
- Ad Hoc installs require devices to be registered in the developer team.
- Apple's device registration limits apply.
- Do not use public/stolen enterprise certificates.
- If Geode changes entitlements or adds extensions, you may need matching
  capabilities/profiles for those targets.
