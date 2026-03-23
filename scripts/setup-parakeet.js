/**
 * Full Parakeet setup for Harness (macOS):
 * 1) Clone & build parakeet.cpp (Metal)
 * 2) Download NVIDIA parakeet-tdt-0.6b-v3.nemo from Hugging Face
 * 3) Python venv + torch/safetensors + convert_nemo.py + extract_vocab.py
 * 4) Copy parakeet CLI + model.safetensors + vocab.txt → resources/parakeet/
 *
 * Prerequisites: git, make, cmake, Python 3.12+ (for convert scripts; brew install python@3.12), curl.
 *
 * Env:
 *   PARAKEET_FORCE=1     Re-run even if resources/parakeet/ is complete
 *   PARAKEET_SOURCE_DIR   Skip automated setup; copy from folder (parakeet, model.safetensors, vocab.txt)
 *   PARAKEET_BIN / PARAKEET_WEIGHTS / PARAKEET_VOCAB  Same as manual copy
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const destDir = path.join(root, "resources", "parakeet");
const repoDir = path.join(root, "build", "parakeet-cpp");
const cacheDir = path.join(root, "build", "parakeet-cache");
const venvDir = path.join(root, "build", "parakeet-venv");

const NAMES = { bin: "parakeet", weights: "model.safetensors", vocab: "vocab.txt" };

const HF_NEMO_URL =
  "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/main/parakeet-tdt-0.6b-v3.nemo";
const NEMO_FILENAME = "parakeet-tdt-0.6b-v3.nemo";

/** parakeet.cpp scripts use tarfile.extract(..., filter=) — requires Python 3.12+ */
const MIN_PYTHON = { major: 3, minor: 12 };

/** Set by assertPrerequisites — Python executable used to create the venv */
let resolvedPython = "python3";

function existsAll(dir) {
  return (
    fs.existsSync(path.join(dir, NAMES.bin)) &&
    fs.existsSync(path.join(dir, NAMES.weights)) &&
    fs.existsSync(path.join(dir, NAMES.vocab))
  );
}

function run(cmd, cwd = root) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd, shell: "/bin/bash", env: process.env });
}

function hasOnPath(cmd) {
  try {
    execSync(`command -v "${cmd}"`, { stdio: "pipe", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

function pythonVersionTuple(cmd) {
  try {
    const out = execSync(
      `"${cmd}" -c "import sys; print(sys.version_info.major, sys.version_info.minor)"`,
      { encoding: "utf8", shell: "/bin/bash" }
    ).trim();
    const [major, minor] = out.split(/\s+/).map(Number);
    return { major, minor };
  } catch {
    return null;
  }
}

function pythonMeetsMinimum(cmd) {
  const t = pythonVersionTuple(cmd);
  if (!t) return false;
  return t.major > MIN_PYTHON.major || (t.major === MIN_PYTHON.major && t.minor >= MIN_PYTHON.minor);
}

/** Prefer Homebrew / newer Pythons; macOS system python3 is often 3.9 and too old for parakeet.cpp scripts. */
function findPythonForParakeet() {
  const candidates = ["python3.13", "python3.12", "python3"];
  for (const cmd of candidates) {
    if (!hasOnPath(cmd)) continue;
    if (pythonMeetsMinimum(cmd)) return cmd;
  }
  return null;
}

function assertPrerequisites() {
  const required = ["git", "make", "cmake", "curl"];
  const missing = required.filter((c) => !hasOnPath(c));
  if (missing.length > 0) {
    console.error("parakeet:setup: missing on PATH:", missing.join(", "));
    if (missing.includes("cmake")) {
      console.error(
        "  CMake is required by parakeet.cpp but is not included with Xcode CLT. Install it, e.g.:  brew install cmake"
      );
    }
    if (missing.some((m) => m === "git" || m === "make")) {
      console.error("  For compilers and make:  xcode-select --install");
    }
    process.exit(1);
  }

  const py = findPythonForParakeet();
  if (!py) {
    console.error(
      "parakeet:setup: need Python 3.12 or newer on PATH (parakeet.cpp NeMo scripts use tarfile.extract with filter=, added in 3.12)."
    );
    console.error("  Install e.g.:  brew install python@3.12");
    console.error("  Then ensure `python3.12` or `python3` points to 3.12+ (check: python3.12 --version)");
    process.exit(1);
  }
  resolvedPython = py;
}

function copyFile(src, destName) {
  const dest = path.join(destDir, destName);
  fs.copyFileSync(src, dest);
  if (destName === NAMES.bin) {
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* ignore */
    }
  }
}

function manualCopyFromEnv() {
  const srcDir = process.env.PARAKEET_SOURCE_DIR?.trim();
  const binEnv = process.env.PARAKEET_BIN?.trim();
  const weightsEnv = process.env.PARAKEET_WEIGHTS?.trim();
  const vocabEnv = process.env.PARAKEET_VOCAB?.trim();

  let binPath;
  let weightsPath;
  let vocabPath;

  if (srcDir) {
    binPath = path.join(srcDir, NAMES.bin);
    weightsPath = path.join(srcDir, NAMES.weights);
    vocabPath = path.join(srcDir, NAMES.vocab);
  } else if (binEnv && weightsEnv && vocabEnv) {
    binPath = binEnv;
    weightsPath = weightsEnv;
    vocabPath = vocabEnv;
  } else {
    return false;
  }

  for (const [label, p] of [
    ["PARAKEET_BIN", binPath],
    ["weights", weightsPath],
    ["vocab", vocabPath],
  ]) {
    if (!fs.existsSync(p)) {
      console.error(`parakeet:setup: missing ${label}: ${p}`);
      process.exit(1);
    }
  }

  fs.mkdirSync(destDir, { recursive: true });
  copyFile(binPath, NAMES.bin);
  copyFile(weightsPath, NAMES.weights);
  copyFile(vocabPath, NAMES.vocab);
  console.log("parakeet:setup: copied into", destDir);
  return true;
}

function ensureRepo() {
  if (process.env.PARAKEET_FORCE === "1" && fs.existsSync(repoDir)) {
    console.log("parakeet:setup: removing existing build/parakeet-cpp (PARAKEET_FORCE=1)");
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    run(
      `git clone --recursive "https://github.com/Frikallo/parakeet.cpp" "${repoDir}"`
    );
  } else {
    console.log("parakeet:setup: using existing", repoDir);
  }
}

function hintMetalToolchain() {
  console.error(`
parakeet:setup: parakeet.cpp compiles Metal GPU kernels. If you see errors about the "metal" tool or "Metal Toolchain", install it:

  xcodebuild -downloadComponent MetalToolchain

Use sudo if prompted. Full Xcode from the App Store also provides this. Then run npm run parakeet:setup again.
`);
}

function buildCli() {
  const binPath = path.join(repoDir, "build", NAMES.bin);
  if (process.env.PARAKEET_FORCE !== "1" && fs.existsSync(binPath)) {
    console.log("parakeet:setup: CLI already built:", binPath);
    return;
  }
  try {
    run("make build", repoDir);
  } catch {
    hintMetalToolchain();
    throw new Error("make build failed");
  }
  if (!fs.existsSync(binPath)) {
    console.error("parakeet:setup: expected binary at", binPath);
    hintMetalToolchain();
    process.exit(1);
  }
}

function ensureNemo() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const nemoPath = path.join(cacheDir, NEMO_FILENAME);
  if (fs.existsSync(nemoPath) && process.env.PARAKEET_FORCE !== "1") {
    console.log("parakeet:setup: reusing downloaded", nemoPath);
    return nemoPath;
  }
  if (fs.existsSync(nemoPath) && process.env.PARAKEET_FORCE === "1") {
    fs.rmSync(nemoPath);
  }
  console.log("parakeet:setup: downloading NeMo checkpoint (large; may take a while)…");
  run(`curl -fL --progress-bar -o "${nemoPath}" "${HF_NEMO_URL}"`);
  return nemoPath;
}

function ensureVenv() {
  const venvPy = path.join(venvDir, "bin", "python3");
  const mustRecreate =
    !fs.existsSync(venvPy) || !pythonMeetsMinimum(venvPy);

  if (mustRecreate) {
    if (fs.existsSync(venvDir)) {
      console.log("parakeet:setup: creating fresh venv with Python 3.12+ (replacing old venv if needed)");
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
    run(`"${resolvedPython}" -m venv "${venvDir}"`);
  }

  const pip = path.join(venvDir, "bin", "pip");
  run(`"${pip}" install --upgrade pip`);
  run(`"${pip}" install torch safetensors numpy packaging`);
}

function convertWeights(nemoPath) {
  const py = path.join(venvDir, "bin", "python3");
  const weightsOut = path.join(cacheDir, NAMES.weights);
  const vocabOut = path.join(cacheDir, NAMES.vocab);

  if (fs.existsSync(weightsOut) && fs.existsSync(vocabOut) && process.env.PARAKEET_FORCE !== "1") {
    console.log("parakeet:setup: reusing converted weights in", cacheDir);
    return { weightsOut, vocabOut };
  }
  if (process.env.PARAKEET_FORCE === "1") {
    try {
      fs.rmSync(weightsOut);
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(vocabOut);
    } catch {
      /* ignore */
    }
  }

  const convertScript = path.join(repoDir, "scripts", "convert_nemo.py");
  const vocabScript = path.join(repoDir, "scripts", "extract_vocab.py");
  if (!fs.existsSync(convertScript) || !fs.existsSync(vocabScript)) {
    console.error("parakeet:setup: missing scripts in", repoDir);
    process.exit(1);
  }

  run(
    `"${py}" "${convertScript}" "${nemoPath}" -o "${weightsOut}" --model 600m-tdt`,
    repoDir
  );
  run(`"${py}" "${vocabScript}" "${nemoPath}" -o "${vocabOut}"`, repoDir);

  return { weightsOut, vocabOut };
}

function copyArtifacts(weightsOut, vocabOut) {
  fs.mkdirSync(destDir, { recursive: true });
  const binSrc = path.join(repoDir, "build", NAMES.bin);
  copyFile(binSrc, NAMES.bin);
  copyFile(weightsOut, NAMES.weights);
  copyFile(vocabOut, NAMES.vocab);
  console.log("parakeet:setup: done →", destDir);
}

// --- main ---

if (process.platform !== "darwin") {
  console.log("parakeet:setup: skipped (macOS only)");
  process.exit(0);
}

const force = process.env.PARAKEET_FORCE === "1";

if (manualCopyFromEnv()) {
  process.exit(0);
}

if (existsAll(destDir) && !force) {
  console.log(
    "parakeet:setup: resources/parakeet/ already has parakeet, model.safetensors, vocab.txt — skipping (set PARAKEET_FORCE=1 to rebuild)"
  );
  process.exit(0);
}

if (force && existsAll(destDir)) {
  for (const n of Object.values(NAMES)) {
    try {
      fs.rmSync(path.join(destDir, n));
    } catch {
      /* ignore */
    }
  }
}

try {
  assertPrerequisites();
  ensureRepo();
  buildCli();
  ensureVenv();
  const nemoPath = ensureNemo();
  const { weightsOut, vocabOut } = convertWeights(nemoPath);
  copyArtifacts(weightsOut, vocabOut);
} catch (e) {
  console.error("parakeet:setup failed:", e?.message ?? e);
  process.exit(1);
}
