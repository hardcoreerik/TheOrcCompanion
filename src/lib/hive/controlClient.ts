// HIVE MIND remote-control client — companion → any HIVE node (including the
// Warchief), talking to the node API's /hive/control/* surface on port 7078.
//
// Trust model matches OrchestratorIDE/Services/Hive/HiveControlAuth.cs:
//   1. Pair once (POST /hive/control/pair) — node must have remote-control
//      pairing enabled by the desktop user. Returns a shared secret.
//   2. Every signed request carries:
//        X-Hive-Peer:      <peerId>
//        X-Hive-Timestamp: <ISO-8601 UTC>
//        X-Hive-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
//
// Secrets are stored per-host in localStorage — never sent anywhere except as
// the HMAC key material consumed locally by Web Crypto.

const CONTROL_PORT = 7078;
const SECRET_STORAGE_PREFIX = "orc-companion-hive-control-secret:";
const PEER_ID_STORAGE_KEY = "orc-companion-hive-control-peer-id";

export interface PairedNode {
  host: string;
  secretHex: string;
  nodeName: string;
  pairedAt: string;
}

export interface ControlStatusResponse {
  nodeName: string;
  info: { Name: string; Models: string[]; Lanes: string[]; VramFreeMb: number; VramTotalMb: number };
  ollamaConfigured: boolean;
  timestamp: string;
}

export interface RunTaskResponse {
  result: string;
  model: string;
  durationMs: number;
}

function controlUrl(host: string, path: string) {
  return `http://${host}:${CONTROL_PORT}${path}`;
}

function secretStorageKey(host: string) {
  return `${SECRET_STORAGE_PREFIX}${host}`;
}

export function getCompanionPeerId(): string {
  let peerId = localStorage.getItem(PEER_ID_STORAGE_KEY);
  if (!peerId) {
    peerId = `companion-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(PEER_ID_STORAGE_KEY, peerId);
  }
  return peerId;
}

export function getPairedNode(host: string): PairedNode | null {
  try {
    const raw = localStorage.getItem(secretStorageKey(host));
    return raw ? (JSON.parse(raw) as PairedNode) : null;
  } catch {
    return null;
  }
}

export function forgetPairedNode(host: string) {
  localStorage.removeItem(secretStorageKey(host));
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function hmacSign(secretHex: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(signature);
}

async function signedHeaders(host: string, body: string) {
  const paired = getPairedNode(host);
  if (!paired) throw new Error(`Not paired with ${host}. Pair with this node first.`);
  const timestamp = new Date().toISOString();
  const signature = await hmacSign(paired.secretHex, `${timestamp}.${body}`);
  return {
    "Content-Type": "application/json",
    "X-Hive-Peer": getCompanionPeerId(),
    "X-Hive-Timestamp": timestamp,
    "X-Hive-Signature": signature,
  };
}

/**
 * Bootstraps trust with a node. The node must have
 * "Allow phone pairing" enabled locally by its desktop user, otherwise this
 * returns a 403. Stores the returned shared secret for this host.
 */
export async function pairWithNode(host: string, label: string): Promise<PairedNode> {
  const peerId = getCompanionPeerId();
  const response = await fetch(controlUrl(host, "/hive/control/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peerId, label }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Pairing failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const paired: PairedNode = {
    host,
    secretHex: data.secret,
    nodeName: data.nodeName,
    pairedAt: new Date().toISOString(),
  };
  localStorage.setItem(secretStorageKey(host), JSON.stringify(paired));
  return paired;
}

export async function getControlStatus(host: string): Promise<ControlStatusResponse> {
  const headers = await signedHeaders(host, "");
  const response = await fetch(controlUrl(host, "/hive/control/status"), { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Status check failed with HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Directly commands a paired node (including the Warchief) to run one
 * synchronous inference task with its own Ollama and return the result —
 * this is the "control the warchief from the phone" channel, as opposed to
 * the worker-agent loop where the node tasks the phone.
 */
export async function runRemoteTask(
  host: string,
  spec: string,
  role: string = "researcher",
  modelHint?: string,
): Promise<RunTaskResponse> {
  const body = JSON.stringify({ spec, role, modelHint });
  const headers = await signedHeaders(host, body);
  const response = await fetch(controlUrl(host, "/hive/control/run-task"), {
    method: "POST",
    headers,
    body,
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Remote task failed with HTTP ${response.status}`);
  }
  return response.json();
}
