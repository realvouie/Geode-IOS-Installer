import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const storageDir = path.join(__dirname, "storage");
fs.mkdirSync(storageDir, { recursive: true });

const upload = multer({
  dest: storageDir,
  limits: { fileSize: 1024 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(storageDir, {
  setHeaders(res) {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
  }
}));

async function getLatestRelease() {
  const r = await fetch("https://api.github.com/repos/geode-sdk/ios-launcher/releases/latest", {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Geode-iOS-Installer"
    }
  });
  if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
  const data = await r.json();
  const ipa = data.assets?.find(a => a.name.toLowerCase().endsWith(".ipa"));
  return {
    tag: data.tag_name,
    published_at: data.published_at,
    ipa: ipa ? {
      name: ipa.name,
      size: ipa.size,
      url: ipa.browser_download_url
    } : null
  };
}

app.get("/api/latest", async (_req, res) => {
  try {
    res.json(await getLatestRelease());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Downloads the latest official Geode IPA to this server.
// NOTE: This is still unsigned unless the upstream asset is already signed for your device.
app.post("/api/cache-latest", async (_req, res) => {
  try {
    const rel = await getLatestRelease();
    if (!rel.ipa) return res.status(404).json({ error: "No IPA asset found." });

    const r = await fetch(rel.ipa.url, {
      headers: { "User-Agent": "Geode-iOS-Installer" },
      redirect: "follow"
    });
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);

    const safeName = rel.ipa.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const out = path.join(storageDir, safeName);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(out, buf);

    res.json({
      ok: true,
      tag: rel.tag,
      file: safeName,
      downloadUrl: `${BASE_URL}/files/${encodeURIComponent(safeName)}`,
      note: "This is the official Geode IPA. iOS still requires a valid signature/provisioning profile before direct installation."
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload an IPA that is already signed for your device/team.
app.post("/api/upload-signed", upload.single("ipa"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No IPA uploaded." });

  const original = req.file.originalname || "Geode-signed.ipa";
  if (!original.toLowerCase().endsWith(".ipa")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "File must be an .ipa" });
  }

  const id = crypto.randomBytes(6).toString("hex");
  const finalName = `geode-signed-${id}.ipa`;
  const finalPath = path.join(storageDir, finalName);
  fs.renameSync(req.file.path, finalPath);

  const fileUrl = `${BASE_URL}/files/${finalName}`;
  const manifestUrl =
    `${BASE_URL}/manifest.plist?ipa=${encodeURIComponent(fileUrl)}` +
    `&bundle=${encodeURIComponent(req.body.bundleId || "com.geode.launcher")}` +
    `&version=${encodeURIComponent(req.body.version || "1.0")}` +
    `&title=${encodeURIComponent(req.body.title || "Geode")}`;

  res.json({
    ok: true,
    fileUrl,
    manifestUrl,
    installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`
  });
});

app.get("/manifest.plist", (req, res) => {
  const ipa = req.query.ipa;
  const bundle = req.query.bundle || "com.geode.launcher";
  const version = req.query.version || "1.0";
  const title = req.query.title || "Geode";

  if (!ipa || !String(ipa).startsWith("https://")) {
    return res.status(400).type("text").send(
      "For iPhone OTA installs, BASE_URL must be HTTPS and ipa must use HTTPS."
    );
  }

  const esc = s => String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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
          <string>${esc(ipa)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${esc(bundle)}</string>
        <key>bundle-version</key>
        <string>${esc(version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${esc(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

  res.type("application/xml").send(plist);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Geode installer running on ${BASE_URL}`);
  if (!BASE_URL.startsWith("https://")) {
    console.log("Use HTTPS in production for iPhone OTA installation.");
  }
});