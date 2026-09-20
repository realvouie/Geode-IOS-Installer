
const $ = s => document.querySelector(s);
let token = null;
let pollTimer = null;

function step(n) {
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.toggle("active", i + 1 === n);
    el.classList.toggle("done", i + 1 < n);
  });
  $("#panel1").classList.toggle("hidden", n !== 1);
  $("#panel2").classList.toggle("hidden", n !== 2);
  $("#panel3").classList.toggle("hidden", n !== 3);
}

function fail(message) {
  $("#errorBox").textContent = message;
  $("#errorBox").classList.remove("hidden");
}

function progressFor(status) {
  return {
    waiting_for_profile: 15,
    device_received: 28,
    registering_device: 40,
    creating_profile: 58,
    downloading_geode: 70,
    signing: 86,
    ready: 100
  }[status] || 10;
}

async function start() {
  $("#errorBox").classList.add("hidden");
  $("#startBtn").disabled = true;
  $("#startBtn").textContent = "Starting…";

  try {
    const r = await fetch("/api/start", { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not start.");

    token = data.token;
    $("#flow").classList.remove("hidden");
    $("#profileBtn").href = data.profileUrl;
    $("#flow").scrollIntoView({ behavior: "smooth", block: "start" });
    step(1);

    pollTimer = setInterval(poll, 1800);
  } catch (e) {
    fail(e.message);
  } finally {
    $("#startBtn").disabled = false;
    $("#startBtn").textContent = "Install Geode";
  }
}

async function poll() {
  if (!token) return;

  try {
    const r = await fetch(`/api/status/${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Status check failed.");

    $("#bar").style.width = progressFor(data.status) + "%";

    if (data.status !== "waiting_for_profile") step(2);

    const labels = {
      waiting_for_profile: "Waiting for the device profile…",
      device_received: "Got your iPhone ID.",
      registering_device: "Registering your iPhone with Apple…",
      creating_profile: "Creating the provisioning profile…",
      downloading_geode: "Downloading the newest Geode…",
      signing: "Signing Geode for your iPhone…"
    };
    if (labels[data.status]) $("#buildText").textContent = labels[data.status];

    if (data.status === "ready") {
      clearInterval(pollTimer);
      $("#installBtn").href = data.installUrl;
      step(3);

      // Try to continue automatically when Safari allows it.
      setTimeout(() => {
        try { window.location.href = data.installUrl; } catch {}
      }, 650);
    }

    if (data.status === "error") {
      clearInterval(pollTimer);
      fail(data.error || "Setup failed.");
    }
  } catch (e) {
    fail(e.message);
  }
}

$("#startBtn").addEventListener("click", start);

$("#profileBtn").addEventListener("click", () => {
  setTimeout(() => {
    step(2);
    $("#buildTitle").textContent = "Finish the profile in Settings";
    $("#buildText").textContent = "After you tap Install in Settings, come back to Safari. This page is already waiting.";
  }, 400);
});
