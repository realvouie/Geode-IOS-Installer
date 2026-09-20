const $ = s => document.querySelector(s);

async function loadLatest() {
  try {
    const r = await fetch("/api/latest");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Failed");

    $("#version").textContent = data.tag || "Unknown";
    $("#dot").classList.add("ok");
    $("#releaseInfo").textContent = data.ipa
      ? `${data.ipa.name} • ${(data.ipa.size / 1024 / 1024).toFixed(1)} MB`
      : "Release found, but no IPA asset was detected.";

    if (data.ipa) {
      $("#downloadBtn").href = data.ipa.url;
      $("#downloadBtn").classList.remove("disabled");
    }
  } catch (e) {
    $("#version").textContent = "Unavailable";
    $("#releaseInfo").textContent = e.message;
  }
}

$("#cacheBtn").addEventListener("click", async () => {
  const btn = $("#cacheBtn");
  btn.disabled = true;
  btn.textContent = "Downloading…";
  $("#cacheResult").classList.add("hidden");

  try {
    const r = await fetch("/api/cache-latest", { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Failed");

    $("#cacheResult").innerHTML =
      `Saved <b>${data.file}</b><br><a href="${data.downloadUrl}">Open mirrored IPA</a><br><br>${data.note}`;
    $("#cacheResult").classList.remove("hidden");
  } catch (e) {
    $("#cacheResult").textContent = e.message;
    $("#cacheResult").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Mirror IPA on this server";
  }
});

$("#ipa").addEventListener("change", e => {
  const f = e.target.files?.[0];
  $("#fileText").textContent = f ? f.name : "Choose signed .ipa";
});

$("#uploadForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#uploadError").classList.add("hidden");
  $("#installArea").classList.add("hidden");

  const submit = e.submitter;
  submit.disabled = true;
  submit.textContent = "Uploading…";

  try {
    const fd = new FormData(e.currentTarget);
    const r = await fetch("/api/upload-signed", { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Upload failed");

    $("#installBtn").href = data.installUrl;
    $("#installArea").classList.remove("hidden");
  } catch (err) {
    $("#uploadError").textContent = err.message;
    $("#uploadError").classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Create Install Button";
  }
});

loadLatest();