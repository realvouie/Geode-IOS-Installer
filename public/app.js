const $ = (selector) => document.querySelector(selector);

async function loadLatestRelease() {
  try {
    const response = await fetch("/api/latest");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load release.");
    }

    $("#releaseVersion").textContent = data.tag || "Latest";
    $("#releaseStatus").classList.add("online");

    if (data.ipa) {
      const megabytes = (data.ipa.size / 1024 / 1024).toFixed(1);

      $("#releaseDescription").textContent =
        `${data.ipa.name} • ${megabytes} MB`;

      $("#officialDownload").href = data.ipa.url;
      $("#officialDownload").classList.remove("disabled");
    } else {
      $("#releaseDescription").textContent =
        "Release found, but no IPA asset was detected.";
    }
  } catch (error) {
    $("#releaseVersion").textContent = "Unavailable";
    $("#releaseDescription").textContent = error.message;
  }
}

$("#ipaFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];

  $("#fileName").textContent =
    file ? file.name : "Choose signed .ipa";
});

$("#mirrorButton").addEventListener("click", async () => {
  const button = $("#mirrorButton");
  const result = $("#mirrorResult");

  button.disabled = true;
  button.textContent = "Downloading...";
  result.classList.add("hidden");

  try {
    const response = await fetch("/api/cache-latest", {
      method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to mirror IPA.");
    }

    result.innerHTML = `
      Saved <strong>${data.file}</strong><br>
      <a href="${data.downloadUrl}" target="_blank" rel="noopener noreferrer">
        Open mirrored IPA
      </a>
      <br><br>
      ${data.note}
    `;

    result.classList.remove("hidden");
  } catch (error) {
    result.textContent = error.message;
    result.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Save IPA to This Server";
  }
});

$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("#uploadButton");
  const errorBox = $("#uploadError");
  const installBox = $("#installBox");

  button.disabled = true;
  button.textContent = "Uploading...";

  errorBox.classList.add("hidden");
  installBox.classList.add("hidden");

  try {
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/upload-signed", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    $("#installButton").href = data.installUrl;
    installBox.classList.remove("hidden");

    installBox.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Create Install Button";
  }
});

loadLatestRelease();
