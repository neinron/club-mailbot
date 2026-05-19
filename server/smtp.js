import net from "node:net";
import tls from "node:tls";

const CRLF = "\r\n";

export class SmtpError extends Error {
  constructor(message, response, trace = []) {
    super(message);
    this.name = "SmtpError";
    this.response = response;
    this.trace = trace;
  }
}

function encodeHeader(value) {
  const safeValue = String(value || "").replace(/[\r\n]+/g, " ").trim();
  if (!/[^\x20-\x7E]/.test(safeValue)) return safeValue;
  return `=?UTF-8?B?${Buffer.from(safeValue, "utf8").toString("base64")}?=`;
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function dotStuff(text) {
  return String(text || "")
    .replace(/\r?\n/g, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join(CRLF);
}

function makeBoundary() {
  return `club_mailbot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatDate(date = new Date()) {
  return date.toUTCString().replace("GMT", "+0000");
}

function joinAddresses(addresses = []) {
  return addresses.map(normalizeAddress).filter(Boolean).join(", ");
}

function buildMessage({ fromEmail, fromName, to = [], cc = [], replyTo = [], subject, body, htmlBody }) {
  const from = fromName ? `${encodeHeader(fromName)} <${fromEmail}>` : fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${joinAddresses(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${formatDate()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(16).slice(2)}@club-mailbot.local>`,
    "MIME-Version: 1.0"
  ];

  if (cc.length) headers.splice(2, 0, `Cc: ${joinAddresses(cc)}`);
  if (replyTo.length) headers.splice(2, 0, `Reply-To: ${joinAddresses(replyTo)}`);

  if (!String(htmlBody || "").trim()) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(body)
    ].join(CRLF);
  }

  const boundary = makeBoundary();
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(body),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(htmlBody),
    `--${boundary}--`,
    ""
  ].join(CRLF);
}

function maskCommand(command) {
  if (/^AUTH\s+/i.test(command)) return command.split(/\s+/).slice(0, 2).join(" ") + " [secret omitted]";
  return command;
}

function makeTraceLogger(trace) {
  return function log(direction, message) {
    const line = {
      at: new Date().toISOString(),
      direction,
      message: direction === "C" ? maskCommand(message) : String(message || "")
    };
    trace.push(line);
    const prefix = direction === "C" ? "CLIENT" : direction === "S" ? "SERVER" : "INFO";
    console.log(`[smtp:${prefix}] ${line.message}`);
  };
}

function createReader(socket, trace) {
  let buffer = "";
  const pending = [];

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flush();
  });

  socket.on("error", (error) => {
    while (pending.length) pending.shift().reject(error);
  });

  socket.on("end", () => {
    const error = new SmtpError("SMTP connection closed unexpectedly", "", trace);
    while (pending.length) pending.shift().reject(error);
  });

  function tryReadResponse() {
    const lines = buffer.split(/\r?\n/);
    let responseLines = [];
    let consumed = 0;
    let code = null;

    for (const line of lines) {
      if (line === "") return null;

      const parsed = line.match(/^(\d{3})([ -])(.*)$/);
      if (!parsed) return null;

      code = Number(parsed[1]);
      responseLines.push(line);
      consumed += line.length + (buffer[consumed + line.length] === "\r" ? 2 : 1);

      if (parsed[2] === " ") {
        const response = responseLines.join("\n");
        buffer = buffer.slice(consumed);
        return { code, response };
      }
    }

    return null;
  }

  function flush() {
    while (pending.length) {
      const result = tryReadResponse();
      if (!result) return;
      pending.shift().resolve(result);
    }
  }

  return function readResponse() {
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      flush();
    });
  };
}

async function expect(readResponse, expectedCodes, context, log, trace) {
  const result = await readResponse();
  log("S", result.response);
  const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  if (!codes.includes(result.code)) {
    throw new SmtpError(`${context} failed: ${result.response}`, result.response, trace);
  }
  return result;
}

async function write(socket, command, log) {
  log("C", command);
  await new Promise((resolve, reject) => {
    socket.write(`${command}${CRLF}`, (error) => (error ? reject(error) : resolve()));
  });
}

function waitForSecure(socket, trace) {
  return new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new SmtpError("SMTP connection timed out.", "", trace)));
  });
}

function waitForConnect(socket, trace) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new SmtpError("SMTP connection timed out.", "", trace)));
  });
}

async function createGmailConnection({ smtpSecurity = "ssl465", trace, log }) {
  const isStartTls = smtpSecurity === "starttls587";
  const port = isStartTls ? 587 : 465;
  log("I", `Connecting to smtp.gmail.com:${port} via ${isStartTls ? "STARTTLS" : "SSL/TLS"}`);

  let socket = isStartTls
    ? net.connect({ host: "smtp.gmail.com", port, timeout: 30000 })
    : tls.connect({ host: "smtp.gmail.com", port, servername: "smtp.gmail.com", timeout: 30000 });

  if (isStartTls) {
    await waitForConnect(socket, trace);
  } else {
    await waitForSecure(socket, trace);
  }

  let readResponse = createReader(socket, trace);
  await expect(readResponse, 220, "Connect", log, trace);
  await write(socket, "EHLO club-mailbot.local", log);
  await expect(readResponse, 250, "EHLO", log, trace);

  if (isStartTls) {
    await write(socket, "STARTTLS", log);
    await expect(readResponse, 220, "STARTTLS", log, trace);
    log("I", "Upgrading connection to TLS");
    socket.removeAllListeners("data");
    socket.removeAllListeners("end");
    socket = tls.connect({ socket, servername: "smtp.gmail.com", timeout: 30000 });
    await waitForSecure(socket, trace);
    readResponse = createReader(socket, trace);
    await write(socket, "EHLO club-mailbot.local", log);
    await expect(readResponse, 250, "EHLO after STARTTLS", log, trace);
  }

  return { socket, readResponse };
}

async function authenticate({ socket, readResponse, fromEmail, secret, authMode, log, trace }) {
  if (authMode === "xoauth2") {
    const xoauth2 = Buffer.from(`user=${fromEmail}\x01auth=Bearer ${secret}\x01\x01`, "utf8").toString("base64");
    await write(socket, `AUTH XOAUTH2 ${xoauth2}`, log);
    const result = await readResponse();
    log("S", result.response);
    if (result.code === 235) return;

    if (result.code === 334) {
      const encoded = result.response.split(/\s+/)[1] || "";
      let details = "";
      try {
        details = Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        details = encoded;
      }
      log("I", `XOAUTH2 rejected: ${details || "no details"}`);
      log("C", "(empty auth abort)");
      await new Promise((resolve, reject) => {
        socket.write(CRLF, (error) => (error ? reject(error) : resolve()));
      });
      throw new SmtpError(`OAuth2 authentication rejected: ${details || result.response}`, result.response, trace);
    }

    throw new SmtpError(`OAuth2 authentication failed: ${result.response}`, result.response, trace);
    return;
  }

  await write(socket, `AUTH PLAIN ${Buffer.from(`\0${fromEmail}\0${secret}`).toString("base64")}`, log);
  await expect(readResponse, 235, "App-password authentication", log, trace);
}

async function openAuthenticatedGmailSmtp({ accountEmail, authSecret, authMode = "appPassword", smtpSecurity = "ssl465" }) {
  const trace = [];
  const log = makeTraceLogger(trace);
  const fromEmail = normalizeAddress(accountEmail);

  if (!fromEmail || !authSecret) {
    throw new SmtpError("Gmail address and auth secret are required.", "", trace);
  }

  const { socket, readResponse } = await createGmailConnection({ smtpSecurity, trace, log });

  try {
    await authenticate({ socket, readResponse, fromEmail, secret: authSecret, authMode, log, trace });
    return { socket, readResponse, fromEmail, trace, log };
  } catch (error) {
    socket.end();
    if (error instanceof SmtpError) throw error;
    throw new SmtpError(error.message, "", trace);
  }
}

export async function testGmailSmtpAuth({ accountEmail, authSecret, authMode, smtpSecurity }) {
  const session = await openAuthenticatedGmailSmtp({ accountEmail, authSecret, authMode, smtpSecurity });
  try {
    await write(session.socket, "QUIT", session.log);
    await expect(session.readResponse, 221, "QUIT", session.log, session.trace);
    return { ok: true, trace: session.trace };
  } finally {
    session.socket.end();
  }
}

export async function sendViaGmailSmtp({
  accountEmail,
  authSecret,
  appPassword,
  authMode,
  smtpSecurity,
  fromName,
  to = [],
  cc = [],
  bcc = [],
  replyTo = [],
  subject,
  body,
  htmlBody
}) {
  const secret = authSecret || appPassword;
  const recipients = [...to, ...cc, ...bcc].map(normalizeAddress).filter(Boolean);

  if (!recipients.length) throw new SmtpError("Recipient address is required.");
  if (!subject?.trim()) throw new SmtpError("Subject is required.");
  if (!body?.trim() && !htmlBody?.trim()) throw new SmtpError("Body is required.");

  const session = await openAuthenticatedGmailSmtp({ accountEmail, authSecret: secret, authMode, smtpSecurity });

  try {
    await write(session.socket, `MAIL FROM:<${session.fromEmail}>`, session.log);
    await expect(session.readResponse, 250, "MAIL FROM", session.log, session.trace);
    for (const recipient of recipients) {
      await write(session.socket, `RCPT TO:<${recipient}>`, session.log);
      await expect(session.readResponse, [250, 251], "RCPT TO", session.log, session.trace);
    }
    await write(session.socket, "DATA", session.log);
    await expect(session.readResponse, 354, "DATA", session.log, session.trace);

    const message = buildMessage({
      fromEmail: session.fromEmail,
      fromName,
      to,
      cc,
      replyTo,
      subject,
      body,
      htmlBody
    });

    session.log("C", `message body (${Buffer.byteLength(message, "utf8")} bytes)`);
    await new Promise((resolve, reject) => {
      session.socket.write(`${message}.${CRLF}`, (error) => (error ? reject(error) : resolve()));
    });
    await expect(session.readResponse, 250, "Send message", session.log, session.trace);
    await write(session.socket, "QUIT", session.log);
    await expect(session.readResponse, 221, "QUIT", session.log, session.trace);
    return { ok: true, trace: session.trace };
  } catch (error) {
    if (error instanceof SmtpError) throw error;
    throw new SmtpError(error.message, "", session.trace);
  } finally {
    session.socket.end();
  }
}
