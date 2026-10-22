import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDraft, renderDraftPreview } from "../server/draft-cli.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../server/unsubscribe.js";

test("draft checks flag missing content and unknown template variables", () => {
  const result = checkDraft({ subject: "Hello {{firstName}}", body: "Hi {{team}}" }, [{ email: "ada@example.org" }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.some((warning) => warning.includes("{{team}}")), true);
});

test("draft preview inserts message into design shell and resolves personalization", () => {
  const preview = renderDraftPreview({
    subject: "Welcome {{firstName}}",
    body: "<p>Hi {{firstName}}</p>",
    htmlBody: "<html><body><main>{{content}}</main></body></html>"
  }, { name: "Ada Lovelace", email: "ada@example.org" });
  assert.equal(preview.subject, "Welcome Ada");
  assert.match(preview.html, /<main><p>Hi Ada<\/p><\/main>/);
});

test("CLI draft preview renders Mailbot button macros", () => {
  const draft = { subject: "Apply", body: "button{{Apply,applicationLink,primary}}", recipientColumns: [{ key: "applicationLink", label: "Application Link" }] };
  const preview = renderDraftPreview(draft, { applicationLink: "https://example.org/apply" });
  assert.match(preview.html, /href="https:\/\/example\.org\/apply"/);
  assert.match(preview.html, />Apply<\/a>/);
  assert.deepEqual(checkDraft(draft, [{ email: "ada@example.org" }]).warnings, []);
});

test("unsubscribe tokens are signed and bind the email to a Notion page", () => {
  process.env.MAILBOT_UNSUBSCRIBE_SECRET = "this-is-a-test-secret-with-at-least-32-bytes";
  const token = createUnsubscribeToken({ pageId: "page-123", email: "ADA@example.org" });
  assert.equal(verifyUnsubscribeToken(token).pageId, "page-123");
  assert.equal(token.includes("ADA@example.org"), false);
  assert.throws(() => verifyUnsubscribeToken(token + "tampered"), /Invalid unsubscribe link/);
});
