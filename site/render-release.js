(async () => {
  const linkEl = document.getElementById("download-link");
  const metaEl = document.getElementById("meta");

  try {
    const response = await fetch("./release.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load release data (${response.status}).`);
    }

    const release = await response.json();
    if (!release.hasRelease || !release.downloadUrl) {
      metaEl.textContent = release.message || "No release available yet.";
      return;
    }

    const published = release.publishedAt ? new Date(release.publishedAt).toLocaleString() : "unknown date";
    linkEl.href = release.downloadUrl;
    linkEl.classList.remove("disabled");
    linkEl.removeAttribute("aria-disabled");
    metaEl.textContent = `Latest: ${release.version} (${release.fileName}) - published ${published}`;
  } catch (error) {
    metaEl.textContent = `Unable to load release info: ${error.message}`;
  }
})();
