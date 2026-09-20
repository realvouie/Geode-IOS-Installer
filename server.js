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

const BASE_URL = (
  process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

const STORAGE_DIR = path.join(__dirname, "storage");

fs.mkdirSync(STORAGE_DIR, {
  recursive: true
});

const upload = multer({
  dest: STORAGE_DIR,
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
});

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.use(
  "/files",
  express.static(STORAGE_DIR, {
    setHeaders(response) {
      response.setHeader(
        "Content-Type",
        "application/octet-stream"
      );
    }
  })
);

async function getLatestRelease() {
  const response = await fetch(
    "https://api.github.com/repos/geode-sdk/ios-launcher/releases/latest",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Geode-iOS-Installer"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `GitHub returned HTTP ${response.status}`
    );
  }

  const release = await response.json();

  const ipa = release.assets?.find(
    (asset) =>
      asset.name.toLowerCase().endsWith(".ipa")
  );

  return {
    tag: release.tag_name,
    published_at: release.published_at,
    ipa: ipa
      ? {
          name: ipa.name,
          size: ipa.size,
          url: ipa.browser_download_url
        }
      : null
  };
}

app.get("/api/latest", async (_request, response) => {
  try {
    response.json(
      await getLatestRelease()
    );
  } catch (error) {
    response.status(500).json({
      error: error.message
    });
  }
});

app.post(
  "/api/cache-latest",
  async (_request, response) => {
    try {
      const release = await getLatestRelease();

      if (!release.ipa) {
        return response.status(404).json({
          error: "No IPA asset was found."
        });
      }

      const download = await fetch(
        release.ipa.url,
        {
          redirect: "follow",
          headers: {
            "User-Agent": "Geode-iOS-Installer"
          }
        }
      );

      if (!download.ok) {
        throw new Error(
          `Download failed with HTTP ${download.status}`
        );
      }

      const safeName =
        release.ipa.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

      const destination =
        path.join(
          STORAGE_DIR,
          safeName
        );

      const buffer =
        Buffer.from(
          await download.arrayBuffer()
        );

      fs.writeFileSync(
        destination,
        buffer
      );

      response.json({
        ok: true,
        tag: release.tag,
        file: safeName,
        downloadUrl:
          `${BASE_URL}/files/${encodeURIComponent(safeName)}`,
        note:
          "This is the official Geode IPA. " +
          "Direct iPhone installation still requires " +
          "a valid Apple signature and provisioning profile."
      });
    } catch (error) {
      response.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/upload-signed",
  upload.single("ipa"),
  (request, response) => {
    if (!request.file) {
      return response.status(400).json({
        error: "No IPA was uploaded."
      });
    }

    const originalName =
      request.file.originalname || "Geode.ipa";

    if (
      !originalName
        .toLowerCase()
        .endsWith(".ipa")
    ) {
      fs.unlinkSync(request.file.path);

      return response.status(400).json({
        error: "The selected file must be an .ipa."
      });
    }

    const id =
      crypto.randomBytes(6).toString("hex");

    const finalName =
      `geode-signed-${id}.ipa`;

    const finalPath =
      path.join(
        STORAGE_DIR,
        finalName
      );

    fs.renameSync(
      request.file.path,
      finalPath
    );

    const fileUrl =
      `${BASE_URL}/files/${finalName}`;

    const bundleId =
      request.body.bundleId ||
      "com.geode.launcher";

    const version =
      request.body.version ||
      "1.0";

    const title =
      request.body.title ||
      "Geode";

    const manifestUrl =
      `${BASE_URL}/manifest.plist` +
      `?ipa=${encodeURIComponent(fileUrl)}` +
      `&bundle=${encodeURIComponent(bundleId)}` +
      `&version=${encodeURIComponent(version)}` +
      `&title=${encodeURIComponent(title)}`;

    const installUrl =
      "itms-services://?action=download-manifest&url=" +
      encodeURIComponent(manifestUrl);

    response.json({
      ok: true,
      fileUrl,
      manifestUrl,
      installUrl
    });
  }
);

app.get(
  "/manifest.plist",
  (request, response) => {
    const ipa =
      request.query.ipa;

    const bundle =
      request.query.bundle ||
      "com.geode.launcher";

    const version =
      request.query.version ||
      "1.0";

    const title =
      request.query.title ||
      "Geode";

    if (
      !ipa ||
      !String(ipa).startsWith("https://")
    ) {
      return response
        .status(400)
        .type("text/plain")
        .send(
          "The public website must use HTTPS for iPhone OTA installation."
        );
    }

    const escapeXml = (value) =>
      String(value)
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
          <string>${escapeXml(ipa)}</string>
        </dict>
      </array>

      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${escapeXml(bundle)}</string>

        <key>bundle-version</key>
        <string>${escapeXml(version)}</string>

        <key>kind</key>
        <string>software</string>

        <key>title</key>
        <string>${escapeXml(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

    response
      .type("application/xml")
      .send(plist);
  }
);

app.get(
  "/health",
  (_request, response) => {
    response.json({
      ok: true
    });
  }
);

app.listen(
  PORT,
  () => {
    console.log(
      `Geode Installer running on ${BASE_URL}`
    );

    if (
      !BASE_URL.startsWith("https://")
    ) {
      console.log(
        "Use HTTPS when deploying for iPhone installs."
      );
    }
  }
);
