import express from "express";
import jwt from "jsonwebtoken";
import plist from "plist";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = String(process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const APPLE_ISSUER_ID = process.env.APPLE_ISSUER_ID || "";
const APPLE_KEY_ID = process.env.APPLE_KEY_ID || "";
const APPLE_PRIVATE_KEY_PATH = process.env.APPLE_PRIVATE_KEY_PATH || "";
const APPLE_CERTIFICATE_ID = process.env.APPLE_CERTIFICATE_ID || "";
const SIGNING_P12_PATH = process.env.SIGNING_P12_PATH || "";
const SIGNING_P12_PASSWORD = process.env.SIGNING_P12_PASSWORD || "";
const GEODE_BUNDLE_ID = process.env.GEODE_BUNDLE_ID || "";
const GEODE_BUNDLE_NAME = process.env.GEODE_BUNDLE_NAME || "Geode Installer";
const ZSIGN_PATH = process.env.ZSIGN_PATH || "zsign";
const PROFILE_SIGN_CERT = process.env.PROFILE_SIGN_CERT || "";
const PROFILE_SIGN_KEY = process.env.PROFILE_SIGN_KEY || "";

const storageDir = path.join(__dirname, "storage");
const dataDir = path.join(__dirname, "data");
const sessionPath = path.join(dataDir, "sessions.json");
await fsp.mkdir(storageDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });

let sessions = {};
try { sessions = JSON.parse(await fsp.readFile(sessionPath, "utf8")); } catch {}

async function saveSessions() {
  await fsp.writeFile(sessionPath, JSON.stringify(sessions, null, 2));
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(storageDir));

function xmlEscape(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function applePrivateKey() {
  if (!APPLE_PRIVATE_KEY_PATH) throw new Error("APPLE_PRIVATE_KEY_PATH is not configured.");
  return fs.readFileSync(APPLE_PRIVATE_KEY_PATH, "utf8");
}

function appleToken() {
  if (!APPLE_ISSUER_ID || !APPLE_KEY_ID) throw new Error("Apple API credentials are not configured.");
  return jwt.sign({}, applePrivateKey(), {
    algorithm: "ES256",
    issuer: APPLE_ISSUER_ID,
    audience: "appstoreconnect-v1",
    keyid: APPLE_KEY_ID,
    expiresIn: "10m"
  });
}

async function appleApi(endpoint, options = {}) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${appleToken()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!r.ok) {
    const detail = body?.errors?.[0]?.detail || body?.errors?.[0]?.title || text || `HTTP ${r.status}`;
    throw new Error(`Apple API: ${detail}`);
  }
  return body;
}

async function getOrRegisterDevice(udid, name) {
  const q = encodeURIComponent(udid);
  const existing = await appleApi(`/v1/devices?filter%5Budid%5D=${q}&limit=5`);
  if (existing.data?.length) return existing.data[0];

  const created = await appleApi("/v1/devices", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "devices",
        attributes: {
          name: name || `Geode iPhone ${udid.slice(-6)}`,
          platform: "IOS",
          udid
        }
      }
    })
  });
  return created.data;
}

async function getOrCreateBundleId() {
  if (!GEODE_BUNDLE_ID) throw new Error("GEODE_BUNDLE_ID is not configured.");

  const existing = await appleApi(`/v1/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(GEODE_BUNDLE_ID)}&limit=5`);
  if (existing.data?.length) return existing.data[0];

  const created = await appleApi("/v1/bundleIds", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "bundleIds",
        attributes: {
          identifier: GEODE_BUNDLE_ID,
          name: GEODE_BUNDLE_NAME,
          platform: "IOS"
        }
      }
    })
  });
  return created.data;
}

async function createAdHocProfile(deviceId, bundleId) {
  if (!APPLE_CERTIFICATE_ID) throw new Error("APPLE_CERTIFICATE_ID is not configured.");

  const name = `Geode-${Date.now()}-${deviceId.slice(-6)}`;
  const created = await appleApi("/v1/profiles", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "profiles",
        attributes: {
          name,
          profileType: "IOS_APP_ADHOC"
        },
        relationships: {
          bundleId: {
            data: { type: "bundleIds", id: bundleId }
          },
          certificates: {
            data: [{ type: "certificates", id: APPLE_CERTIFICATE_ID }]
          },
          devices: {
            data: [{ type: "devices", id: deviceId }]
          }
        }
      }
    })
  });
  return created.data;
}

async function latestGeode() {
  const r = await fetch("https://api.github.com/repos/geode-sdk/ios-launcher/releases/latest", {
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "Geode-One-Click-Installer" }
  });
  if (!r.ok) throw new Error(`GitHub API returned ${r.status}.`);
  const release = await r.json();
  const ipa = release.assets?.find(x => String(x.name).toLowerCase().endsWith(".ipa"));
  if (!ipa) throw new Error("The latest Geode release does not contain an IPA asset.");
  return { tag: release.tag_name, url: ipa.browser_download_url, name: ipa.name };
}

async function download(url, target) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Geode-One-Click-Installer" } });
  if (!r.ok) throw new Error(`Download failed with HTTP ${r.status}.`);
  await fsp.writeFile(target, Buffer.from(await r.arrayBuffer()));
}

async function signIpa(inputIpa, profilePath, outputIpa) {
  if (!SIGNING_P12_PATH) throw new Error("SIGNING_P12_PATH is not configured.");
  const args = [
    "-f",
    "-k", SIGNING_P12_PATH,
    "-p", SIGNING_P12_PASSWORD,
    "-m", profilePath,
    "-b", GEODE_BUNDLE_ID,
    "-n", "Geode",
    "-o", outputIpa,
    inputIpa
  ];
  await execFileAsync(ZSIGN_PATH, args, { maxBuffer: 1024 * 1024 * 10 });
}

async function setStatus(token, status, extra = {}) {
  if (!sessions[token]) return;
  sessions[token] = { ...sessions[token], status, ...extra, updatedAt: Date.now() };
  await saveSessions();
}

async function buildForDevice(token) {
  try {
    const s = sessions[token];
    if (!s?.udid) throw new Error("No UDID was received.");

    await setStatus(token, "registering_device");
    const device = await getOrRegisterDevice(s.udid, s.product || "Geode iPhone");
    const bundle = await getOrCreateBundleId();

    await setStatus(token, "creating_profile");
    const profile = await createAdHocProfile(device.id, bundle.id);
    const profileContent = profile.attributes?.profileContent;
    if (!profileContent) throw new Error("Apple did not return provisioning profile content.");

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "geode-sign-"));
    const provPath = path.join(workDir, "geode.mobileprovision");
    const inputIpa = path.join(workDir, "geode.ipa");
    const outputName = `Geode-${token.slice(0,8)}.ipa`;
    const outputIpa = path.join(storageDir, outputName);
    await fsp.writeFile(provPath, Buffer.from(profileContent, "base64"));

    await setStatus(token, "downloading_geode");
    const geode = await latestGeode();
    await download(geode.url, inputIpa);

    await setStatus(token, "signing", { geodeVersion: geode.tag });
    await signIpa(inputIpa, provPath, outputIpa);

    const manifestUrl = `${BASE_URL}/manifest/${encodeURIComponent(token)}.plist`;
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;

    await setStatus(token, "ready", {
      ipaFile: outputName,
      installUrl,
      profileId: profile.id,
      deviceId: device.id
    });

    await fsp.rm(workDir, { recursive: true, force: true });
  } catch (e) {
    await setStatus(token, "error", { error: e.message || String(e) });
  }
}

function mobileConfig(token) {
  const receiveUrl = `${BASE_URL}/device/${encodeURIComponent(token)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${xmlEscape(receiveUrl)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>VERSION</string>
      <string>PRODUCT</string>
    </array>
    <key>Challenge</key>
    <string>${xmlEscape(token)}</string>
  </dict>
  <key>PayloadOrganization</key>
  <string>Geode Installer</string>
  <key>PayloadDisplayName</key>
  <string>Geode Device Registration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadUUID</key>
  <string>${crypto.randomUUID().toUpperCase()}</string>
  <key>PayloadIdentifier</key>
  <string>com.geodeinstaller.profile.${xmlEscape(token)}</string>
  <key>PayloadDescription</key>
  <string>Shares this iPhone's UDID, iOS version, and model with the Geode installer so the device can be registered for installation.</string>
  <key>PayloadType</key>
  <string>Profile Service</string>
</dict>
</plist>`;
}

async function maybeSignMobileConfig(xml) {
  if (!PROFILE_SIGN_CERT || !PROFILE_SIGN_KEY) return Buffer.from(xml);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "profile-sign-"));
  const input = path.join(dir, "profile.mobileconfig");
  const output = path.join(dir, "profile-signed.mobileconfig");
  await fsp.writeFile(input, xml);
  await execFileAsync("openssl", [
    "smime", "-sign", "-signer", PROFILE_SIGN_CERT, "-inkey", PROFILE_SIGN_KEY,
    "-in", input, "-out", output, "-outform", "der", "-nodetach"
  ]);
  const buf = await fsp.readFile(output);
  await fsp.rm(dir, { recursive: true, force: true });
  return buf;
}

async function decodeDevicePayload(buf, contentType) {
  let raw = buf;
  if (/pkcs7|x-pkcs7|signature/i.test(contentType || "")) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "device-payload-"));
    const input = path.join(dir, "input.der");
    const output = path.join(dir, "output.plist");
    await fsp.writeFile(input, buf);
    await execFileAsync("openssl", [
      "smime", "-verify", "-inform", "DER", "-noverify", "-in", input, "-out", output
    ]);
    raw = await fsp.readFile(output);
    await fsp.rm(dir, { recursive: true, force: true });
  }
  return plist.parse(raw.toString("utf8"));
}

app.post("/api/start", async (_req, res) => {
  if (!BASE_URL.startsWith("https://")) {
    return res.status(500).json({ error: "BASE_URL must use HTTPS for iPhone installation." });
  }
  const token = crypto.randomBytes(20).toString("hex");
  sessions[token] = {
    token,
    status: "waiting_for_profile",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveSessions();
  res.json({
    token,
    profileUrl: `${BASE_URL}/enroll/${token}.mobileconfig`
  });
});

app.get("/enroll/:token.mobileconfig", async (req, res) => {
  const { token } = req.params;
  if (!sessions[token]) return res.status(404).send("Unknown install session.");
  try {
    const body = await maybeSignMobileConfig(mobileConfig(token));
    res.setHeader("Content-Type", "application/x-apple-aspen-config");
    res.setHeader("Content-Disposition", 'attachment; filename="Geode-Device-Registration.mobileconfig"');
    res.send(body);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post(
  "/device/:token",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    const { token } = req.params;
    if (!sessions[token]) return res.status(404).send("Unknown install session.");

    try {
      const attrs = await decodeDevicePayload(req.body, req.headers["content-type"]);
      if (!attrs?.UDID) throw new Error("The iPhone did not send a UDID.");
      if (attrs.CHALLENGE && attrs.CHALLENGE !== token) throw new Error("Invalid enrollment challenge.");

      await setStatus(token, "device_received", {
        udid: String(attrs.UDID),
        iosVersion: String(attrs.VERSION || ""),
        product: String(attrs.PRODUCT || "")
      });

      buildForDevice(token);

      res.status(301);
      res.setHeader("Location", `${BASE_URL}/?session=${encodeURIComponent(token)}`);
      res.end();
    } catch (e) {
      await setStatus(token, "error", { error: e.message });
      res.status(400).send(e.message);
    }
  }
);

app.get("/api/status/:token", (req, res) => {
  const s = sessions[req.params.token];
  if (!s) return res.status(404).json({ error: "Unknown install session." });
  const publicStatus = {
    status: s.status,
    geodeVersion: s.geodeVersion || null,
    installUrl: s.installUrl || null,
    error: s.error || null
  };
  res.setHeader("Cache-Control", "no-store");
  res.json(publicStatus);
});

app.get("/manifest/:token.plist", (req, res) => {
  const s = sessions[req.params.token];
  if (!s || s.status !== "ready" || !s.ipaFile) return res.status(404).send("Build not ready.");

  const ipaUrl = `${BASE_URL}/files/${encodeURIComponent(s.ipaFile)}`;
  const version = String(s.geodeVersion || "1.0").replace(/^v/i, "");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${xmlEscape(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${xmlEscape(GEODE_BUNDLE_ID)}</string>
        <key>bundle-version</key>
        <string>${xmlEscape(version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>Geode</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
  res.type("application/xml").send(xml);
});

app.get("/api/latest", async (_req, res) => {
  try { res.json(await latestGeode()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Geode One-Click Installer running at ${BASE_URL}`);
});
