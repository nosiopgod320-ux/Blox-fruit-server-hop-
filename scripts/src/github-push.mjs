#!/usr/bin/env node
/**
 * Pushes remaining files to GitHub using the REST API.
 * Skips files that already exist with matching content.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PAT = process.env.GITHUB_PAT;
const OWNER = "nosiopgod320-ux";
const REPO = "Blox-fruit-server-hop-";
const BRANCH = "main";
const ROOT = "/home/runner/workspace";

if (!PAT) { console.error("GITHUB_PAT not set"); process.exit(1); }

const IGNORE = new Set([
  "node_modules", ".git", "dist", ".tsbuildinfo", "tsconfig.tsbuildinfo",
  ".replit", ".replit-artifact", "pnpm-lock.yaml", ".local",
  "attached_assets", "screenshots", "__pycache__", ".cache",
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml",
  ".md", ".toml", ".html", ".css", ".sh", ".env.example", ".gitignore", ".txt",
]);

function isTextFile(name) {
  const lower = name.toLowerCase();
  for (const ext of TEXT_EXTS) { if (lower.endsWith(ext)) return true; }
  return false;
}

function collectFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, results);
    else if (st.isFile() && isTextFile(entry) && st.size < 300_000) results.push(full);
  }
  return results;
}

async function apiCall(path, method, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { message: text }; }
  return { status: res.status, json };
}

async function upsertFile(repoPath, content) {
  // Get existing SHA if file exists
  const { status: gs, json: gj } = await apiCall(
    `/repos/${OWNER}/${REPO}/contents/${repoPath}?ref=${BRANCH}`, "GET"
  );
  const sha = (gs === 200 && gj.sha) ? gj.sha : null;

  // If file exists, check if content matches to skip
  if (sha && gj.content) {
    const existing = Buffer.from(gj.content.replace(/\n/g, ""), "base64").toString("utf8");
    if (existing === content) return "skipped";
  }

  const body = {
    message: `chore: sync ${repoPath}`,
    content: Buffer.from(content).toString("base64"),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const { status, json } = await apiCall(`/repos/${OWNER}/${REPO}/contents/${repoPath}`, "PUT", body);
  if (status >= 300) return `error: ${json.message}`;
  return "ok";
}

async function main() {
  const files = collectFiles(ROOT);
  console.log(`Found ${files.length} files`);

  let ok = 0, skipped = 0, fail = 0;
  for (const full of files) {
    const rel = relative(ROOT, full);
    try {
      const content = readFileSync(full, "utf8");
      const result = await upsertFile(rel, content);
      if (result === "ok") { console.log(`  ✓ ${rel}`); ok++; }
      else if (result === "skipped") { skipped++; }
      else { console.log(`  ❌ ${rel}: ${result}`); fail++; }
    } catch (e) {
      console.log(`  ❌ ${rel}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} pushed, ${skipped} skipped (unchanged), ${fail} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
