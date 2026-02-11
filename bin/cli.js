#!/usr/bin/env node

/**
 * Clawatar — Give your OpenClaw agent a 3D avatar
 *
 * npx clawatar@latest
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync, spawn } = require("child_process");
const os = require("os");

// Colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

// Paths
const HOME = os.homedir();
const OPENCLAW_DIR = path.join(HOME, ".openclaw");
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, "openclaw.json");
const OPENCLAW_SKILLS_DIR = path.join(OPENCLAW_DIR, "skills");
const OPENCLAW_WORKSPACE = path.join(OPENCLAW_DIR, "workspace");
const SKILL_NAME = "clawatar";
const SKILL_DEST = path.join(OPENCLAW_SKILLS_DIR, SKILL_NAME);
const PROJECT_DEST = path.join(OPENCLAW_WORKSPACE, "clawatar");
const PACKAGE_ROOT = path.resolve(__dirname, "..");

function log(msg) { console.log(msg); }
function logStep(step, msg) { console.log(`\n${c("cyan", `[${step}]`)} ${msg}`); }
function logSuccess(msg) { console.log(`${c("green", "✓")} ${msg}`); }
function logError(msg) { console.log(`${c("red", "✗")} ${msg}`); }
function logInfo(msg) { console.log(`${c("blue", "→")} ${msg}`); }
function logWarn(msg) { console.log(`${c("yellow", "!")} ${msg}`); }

function createPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function commandExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; }
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function copyDir(src, dest, skipNodeModules = true) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNodeModules && (entry.name === "node_modules" || entry.name === ".git" || entry.name === "_audio_cache")) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skipNodeModules);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function printBanner() {
  console.log(`
${c("magenta", "┌──────────────────────────────────────────────────────┐")}
${c("magenta", "│")}  ${c("bright", "🎭 Clawatar")} — Give your OpenClaw agent a 3D avatar  ${c("magenta", "│")}
${c("magenta", "└──────────────────────────────────────────────────────┘")}

A web-based VRM avatar with ${c("cyan", "163 animations")}, expressions,
voice chat, and lip sync — controlled by your OpenClaw agent.
`);
}

async function main() {
  const rl = createPrompt();

  try {
    printBanner();

    // Step 1: Check prerequisites
    logStep("1/6", "Checking prerequisites...");

    if (!commandExists("openclaw")) {
      logError("OpenClaw CLI not found!");
      logInfo("Install with: npm install -g openclaw");
      rl.close();
      process.exit(1);
    }
    logSuccess("OpenClaw CLI installed");

    // Check Node.js >= 18
    const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
    if (nodeVersion < 18) {
      logError(`Node.js >= 18 required (found v${process.versions.node})`);
      rl.close();
      process.exit(1);
    }
    logSuccess(`Node.js v${process.versions.node}`);

    // Ensure directories exist
    fs.mkdirSync(OPENCLAW_SKILLS_DIR, { recursive: true });
    fs.mkdirSync(OPENCLAW_WORKSPACE, { recursive: true });

    // Check if already installed
    if (fs.existsSync(SKILL_DEST)) {
      logWarn("Clawatar is already installed!");
      logInfo(`Skill: ${SKILL_DEST}`);
      const reinstall = await ask(rl, "\nReinstall/update? (y/N): ");
      if (reinstall.toLowerCase() !== "y") {
        log("\nNo changes made. Goodbye!");
        rl.close();
        process.exit(0);
      }
      fs.rmSync(SKILL_DEST, { recursive: true, force: true });
      logInfo("Removed existing skill installation");
    }

    // Step 2: ElevenLabs API key (optional)
    logStep("2/6", "ElevenLabs API key (optional — for voice/TTS)...");
    log(`\nIf you have an ElevenLabs API key, the avatar can speak with TTS + lip sync.`);
    log(`${c("dim", "Press Enter to skip if you don't have one.")}\n`);

    const apiKey = await ask(rl, "ElevenLabs API key (optional): ");
    if (apiKey) {
      logSuccess("API key received");
    } else {
      logInfo("Skipped — you can add it later in openclaw.json");
    }

    // Step 3: Install skill
    logStep("3/6", "Installing skill files...");
    fs.mkdirSync(SKILL_DEST, { recursive: true });

    const skillSrc = path.join(PACKAGE_ROOT, "skill");
    if (fs.existsSync(skillSrc)) {
      copyDir(skillSrc, SKILL_DEST, false);
    }
    logSuccess(`Skill installed to: ${SKILL_DEST}`);

    // Step 4: Update OpenClaw config
    logStep("4/6", "Updating OpenClaw configuration...");
    let config = readJsonFile(OPENCLAW_CONFIG) || {};

    const skillConfig = {
      skills: {
        entries: {
          [SKILL_NAME]: {
            enabled: true,
            ...(apiKey ? { env: { ELEVENLABS_API_KEY: apiKey } } : {}),
          },
        },
      },
    };

    config = deepMerge(config, skillConfig);

    if (!config.skills.load) config.skills.load = {};
    if (!config.skills.load.extraDirs) config.skills.load.extraDirs = [];
    if (!config.skills.load.extraDirs.includes(OPENCLAW_SKILLS_DIR)) {
      config.skills.load.extraDirs.push(OPENCLAW_SKILLS_DIR);
    }

    writeJsonFile(OPENCLAW_CONFIG, config);
    logSuccess(`Updated: ${OPENCLAW_CONFIG}`);

    // Step 5: Copy project to workspace
    logStep("5/6", `Copying project to ${PROJECT_DEST}...`);

    if (fs.existsSync(PROJECT_DEST)) {
      logWarn("Project directory already exists");
      const overwrite = await ask(rl, "Overwrite? (y/N): ");
      if (overwrite.toLowerCase() === "y") {
        fs.rmSync(PROJECT_DEST, { recursive: true, force: true });
      } else {
        logInfo("Keeping existing project directory");
      }
    }

    if (!fs.existsSync(PROJECT_DEST)) {
      copyDir(PACKAGE_ROOT, PROJECT_DEST);
      logSuccess(`Project copied to: ${PROJECT_DEST}`);
    }

    // Step 6: npm install
    logStep("6/6", "Installing dependencies (npm install)...");
    try {
      execSync("npm install", { cwd: PROJECT_DEST, stdio: "inherit" });
      logSuccess("Dependencies installed");
    } catch (e) {
      logWarn("npm install had issues — you may need to run it manually");
    }

    // Summary
    console.log(`
${c("green", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}
${c("bright", "  🎭 Clawatar is ready!")}
${c("green", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

${c("cyan", "Installed:")}
  Skill:   ${SKILL_DEST}
  Project: ${PROJECT_DEST}
  Config:  ${OPENCLAW_CONFIG}

${c("yellow", "Next steps:")}
  1. Drop your VRM model onto the page or set the URL in clawatar.config.json
  2. Start with: ${c("bright", `cd ${PROJECT_DEST} && npm run start`)}
  3. Open ${c("bright", "http://localhost:3000")}

${c("dim", "Your OpenClaw agent can now control a 3D avatar!")}
`);

    rl.close();
  } catch (error) {
    logError(`Installation failed: ${error.message}`);
    console.error(error);
    rl.close();
    process.exit(1);
  }
}

main();
