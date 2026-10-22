import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDelimited, prepareRecipients, toImportCsv } from "../server/recipient-cli.js";

test("parses quoted CSV fields and doubled quotes", () => {
  assert.deepEqual(parseDelimited('Name,Email\n"Wu, Killy",killy@example.org\n"The ""AI"" Club",team@example.org'), [
    ["Name", "Email"],
    ["Wu, Killy", "killy@example.org"],
    ['The "AI" Club', "team@example.org"]
  ]);
});

test("prepares a headered list, deduplicates, and excludes current members", () => {
  const input = [
    "First Name;Last Name;E-Mail;Status",
    "Ada;Lovelace;ADA@example.org;Going",
    "Grace;Hopper;grace@example.org;Going",
    "Ada;Duplicate;ada@EXAMPLE.org;Going",
    "Invalid;Contact;not-an-email;Going"
  ].join("\n");
  const members = [
    "Name,Email",
    '"Grace Hopper",grace@example.org'
  ].join("\n");

  const result = prepareRecipients(input, [members]);
  assert.deepEqual(result.recipients, [{ name: "Ada Lovelace", email: "ada@example.org" }]);
  assert.deepEqual(result.stats, {
    inputCount: 4,
    validCount: 3,
    invalidCount: 1,
    duplicateCount: 1,
    excludedCount: 1
  });
});

test("accepts headerless tab-separated rows and emits Mailbot-compatible CSV", () => {
  const result = prepareRecipients("Killy Wu\tkilly@example.org\nNo email\t\nGrace Hopper\tgrace@example.org");
  assert.deepEqual(result.recipients, [
    { name: "Killy Wu", email: "killy@example.org" },
    { name: "Grace Hopper", email: "grace@example.org" }
  ]);
  assert.equal(toImportCsv(result.recipients), "Killy Wu,killy@example.org\nGrace Hopper,grace@example.org\n");
});

test("checks every email column in member exports", () => {
  const input = "Name,Email\nCurrent Member,student+event@example.org\nNew Applicant,new@example.org";
  const members = "Name,Email,Education Email\nCurrent Member,student@example.org,student+event@example.org";
  const result = prepareRecipients(input, [members]);
  assert.deepEqual(result.recipients, [{ name: "New Applicant", email: "new@example.org" }]);
  assert.equal(result.stats.excludedCount, 1);
});
