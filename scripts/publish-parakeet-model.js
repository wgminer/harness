/**
 * Build manifest.json for the Parakeet model pack and optionally upload to Hugging Face.
 *
 * Prerequisites: npm run parakeet:setup (resources/parakeet/ must have model.safetensors + vocab.txt)
 *
 * Usage:
 *   node scripts/publish-parakeet-model.js              # write manifest to build/parakeet-publish/
 *   node scripts/publish-parakeet-model.js --upload     # also huggingface-cli upload
 *
 * Env:
 *   PARAKEET_MODEL_VERSION   manifest version (default: matches src/shared/parakeetModel.ts)
 *   PARAKEET_HF_REPO         repo id (default: wgminer/harness-parakeet-tdt-0.6b)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "resources", "parakeet");
const outDir = path.join(root, "build", "parakeet-publish");

const WEIGHTS = "model.safetensors";
const VOCAB = "vocab.txt";

const HF_REPO = process.env.PARAKEET_HF_REPO?.trim() || "wgminer/harness-parakeet-tdt-0.6b";
const VERSION = process.env.PARAKEET_MODEL_VERSION?.trim() || readVersionFromShared();

function readVersionFromShared() {
  const shared = path.join(root, "src", "shared", "parakeetModel.ts");
  const text = fs.readFileSync(shared, "utf8");
  const m = text.match(/PARAKEET_MODEL_VERSION\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("Could not read PARAKEET_MODEL_VERSION from parakeetModel.ts");
  return m[1];
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function hfResolveUrl(filename) {
  return `https://huggingface.co/${HF_REPO}/resolve/main/${filename}`;
}

function main() {
  const upload = process.argv.includes("--upload");
  const weightsPath = path.join(srcDir, WEIGHTS);
  const vocabPath = path.join(srcDir, VOCAB);

  for (const [label, p] of [
    ["weights", weightsPath],
    ["vocab", vocabPath],
  ]) {
    if (!fs.existsSync(p)) {
      console.error(`publish-parakeet-model: missing ${label} at ${p}`);
      console.error("  Run: npm run parakeet:setup");
      process.exit(1);
    }
  }

  const weightsStat = fs.statSync(weightsPath);
  const vocabStat = fs.statSync(vocabPath);

  const manifest = {
    version: VERSION,
    model: "parakeet-tdt-0.6b-v3",
    files: {
      weights: {
        sha256: sha256File(weightsPath),
        bytes: weightsStat.size,
        url: hfResolveUrl(WEIGHTS),
      },
      vocab: {
        sha256: sha256File(vocabPath),
        bytes: vocabStat.size,
        url: hfResolveUrl(VOCAB),
      },
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.copyFileSync(weightsPath, path.join(outDir, WEIGHTS));
  fs.copyFileSync(vocabPath, path.join(outDir, VOCAB));

  console.log("Wrote", manifestPath);
  console.log(JSON.stringify(manifest, null, 2));

  if (!upload) {
    console.log("\nTo upload to Hugging Face:");
    console.log(`  huggingface-cli upload ${HF_REPO} ${outDir} . --repo-type model`);
    console.log("Or re-run with --upload (requires huggingface-cli on PATH).");
    return;
  }

  try {
    execSync(`command -v huggingface-cli`, { stdio: "pipe", shell: "/bin/bash" });
  } catch {
    console.error("huggingface-cli not found. Install: pip install huggingface_hub");
    process.exit(1);
  }

  console.log(`\nUploading to ${HF_REPO}…`);
  execSync(`huggingface-cli upload ${HF_REPO} "${outDir}" . --repo-type model`, {
    stdio: "inherit",
    cwd: root,
    shell: "/bin/bash",
  });
  console.log("Upload complete.");
}

main();
