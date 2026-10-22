import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = fileURLToPath(new URL("../bin/mailbot.js", import.meta.url));

test("CLI composes, validates, and previews a Mailbot draft from content and an opted-in list", () => {
  const directory = mkdtempSync(join(tmpdir(), "mailbot-cli-"));
  try {
    mkdirSync(join(directory, "input"));
    writeFileSync(join(directory, "input", "body.html"), '<p>Hi {{firstName}}</p><p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>');
    writeFileSync(join(directory, "input", "recipients.csv"), "Name,Email,Notion Page ID\nAda Lovelace,ada@example.org,page-123\n");
    writeFileSync(join(directory, "input", "design.json"), JSON.stringify({ layout: "card", accent: "#0a2d57", background: "#f5f5f4", font: "Arial,Helvetica,sans-serif", padding: 32, width: 600 }));
    const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: directory, encoding: "utf8" });
    const created = run("draft", "create", "--name", "CLI Smoke", "--subject", "Hello {{firstName}}", "--body-file", "input/body.html", "--recipients", "input/recipients.csv", "--design", "input/design.json");
    assert.equal(created.status, 0, created.stderr);
    const draft = JSON.parse(readFileSync(join(directory, "drafts", "cli-smoke.json"), "utf8"));
    assert.equal(draft.recipients[0].notionPageId, "page-123");
    assert.match(draft.recipients[0].unsubscribeUrl, /^https:\/\/example\.org/);
    assert.equal(draft.recipientColumns.find((column) => column.key === "email").role, "to");

    const checked = run("draft", "check", "--name", "CLI Smoke");
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout).errors, []);
    const preview = run("draft", "preview", "--name", "CLI Smoke");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /href="https:\/\/example\.org\/unsubscribe-preview"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
