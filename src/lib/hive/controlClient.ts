import { Capacitor, registerPlugin } from "@capacitor/core";

const CONTROL_PORT = 7078;
const PEERS_KEY = "orc-companion-hive-peers";

interface HiveIdentityNative {
  getIdentity(): Promise<{ nodeId: string; signingPublicKeyDer: string; exchangePublicKeyDer: string }>;
  createPairingRequest(options: { name: string; vramMb?: number }): Promise<Record<string, unknown>>;
  trustPeer(options: { nodeId: string; signingPublicKeyDer: string; exchangePublicKeyDer: string; hiveId?: string }): Promise<{ nodeId: string }>;
  forgetPeer(options: { nodeId: string }): Promise<void>;
  signRequest(options: { nodeId: string; method: string; path: string; body: string }): Promise<Record<string, string>>;
  encryptControl(options: { nodeId: string; json: string }): Promise<ControlEnvelope>;
  decryptControl(options: ControlEnvelope & { nodeId: string }): Promise<{ json: string }>;
}

const HiveIdentity = registerPlugin<HiveIdentityNative>("HiveIdentity");

export interface PairedNode {
  host: string;
  nodeId: string;
  nodeName: string;
  fingerprint: string;
  pairedAt: string;
}

export interface PendingPairing extends PairedNode {
  signingPublicKeyDer: string;
  exchangePublicKeyDer: string;
  hiveId?: string;
}

interface ControlEnvelope { nonce: string; ciphertext: string; tag: string }
interface CommandSnapshot { id: string; status: string; output: string; exitCode?: number; error?: string }
export interface TerminalSnapshot { id: string; status: string; output: string; offset: number; exitCode?: number; error?: string }

function requireAndroid() {
  if (Capacitor.getPlatform() !== "android") throw new Error("HIVE remote control is available in the Android app only.");
}

function peers(): PairedNode[] {
  try { return JSON.parse(localStorage.getItem(PEERS_KEY) || "[]"); } catch { return []; }
}

function savePeer(peer: PairedNode) {
  localStorage.setItem(PEERS_KEY, JSON.stringify([...peers().filter((item) => item.host !== peer.host), peer]));
}

export function getPairedNode(host: string): PairedNode | null {
  return peers().find((peer) => peer.host === host) ?? null;
}

export async function forgetPairedNode(host: string) {
  const peer = getPairedNode(host);
  if (peer) await HiveIdentity.forgetPeer({ nodeId: peer.nodeId });
  localStorage.setItem(PEERS_KEY, JSON.stringify(peers().filter((item) => item.host !== host)));
}

export async function revokePairedNode(host: string) {
  const peer = getPairedNode(host);
  if (!peer) return;
  await controlRequest(host, "DELETE", "/hive/control/pairing");
  await forgetPairedNode(host);
}

export async function pairWithNode(host: string, label: string): Promise<PendingPairing> {
  requireAndroid();
  const request = await HiveIdentity.createPairingRequest({ name: label });
  const response = await fetch(`http://${host}:${CONTROL_PORT}/hive/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Pairing failed with HTTP ${response.status}`);
  const sessionId = String(request.sessionId);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const poll = await fetch(`http://${host}:${CONTROL_PORT}/hive/pair/${sessionId}`);
    const result = await poll.json();
    if (result.status === "pending") continue;
    if (result.status !== "approved") throw new Error(`Pairing ${result.status || "failed"}.`);
    return {
      host,
      nodeId: result.warchiefNodeId,
      nodeName: result.warchiefName,
      fingerprint: result.warchiefFingerprint,
      signingPublicKeyDer: result.warchiefSigningPublicKeyDer,
      exchangePublicKeyDer: result.warchiefExchangePublicKeyDer,
      hiveId: result.hiveId,
      pairedAt: new Date().toISOString(),
    };
  }
  throw new Error("Pairing approval timed out.");
}

export async function confirmPairedNode(pending: PendingPairing): Promise<PairedNode> {
  await HiveIdentity.trustPeer({
    nodeId: pending.nodeId,
    signingPublicKeyDer: pending.signingPublicKeyDer,
    exchangePublicKeyDer: pending.exchangePublicKeyDer,
    hiveId: pending.hiveId,
  });
  const { signingPublicKeyDer: _signing, exchangePublicKeyDer: _exchange, hiveId: _hive, ...peer } = pending;
  savePeer(peer);
  return peer;
}

async function controlRequest<T>(host: string, method: string, path: string, value?: unknown): Promise<T> {
  requireAndroid();
  const peer = getPairedNode(host);
  if (!peer) throw new Error(`Not paired with ${host}.`);
  const body = value === undefined ? "" : JSON.stringify(await HiveIdentity.encryptControl({ nodeId: peer.nodeId, json: JSON.stringify(value) }));
  const headers = await HiveIdentity.signRequest({ nodeId: peer.nodeId, method, path: path.split("?", 1)[0], body });
  const response = await fetch(`http://${host}:${CONTROL_PORT}${path}`, {
    method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body || undefined,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Control request failed with HTTP ${response.status}`);
  const envelope = await response.json() as ControlEnvelope;
  const decrypted = await HiveIdentity.decryptControl({ nodeId: peer.nodeId, ...envelope });
  return JSON.parse(decrypted.json) as T;
}

export async function signedHiveHeaders(host: string, method: string, path: string, body = "") {
  requireAndroid();
  const peer = getPairedNode(host);
  if (!peer) throw new Error(`Not paired with ${host}.`);
  return HiveIdentity.signRequest({ nodeId: peer.nodeId, method, path, body });
}

export function getControlStatus(host: string) {
  return controlRequest<{
    nodeName: string;
    info: { name: string; models: string[]; lanes: string[] };
    topology: { center: HiveTopologyNode; peers: HiveTopologyNode[] };
    timestamp: string;
  }>(host, "GET", "/hive/control");
}

export interface HiveTopologyNode {
  nodeId: string;
  name: string;
  role: string;
  state: "online" | "offline";
  isMobile: boolean;
}

export async function getCompanionNodeId() {
  requireAndroid();
  return (await HiveIdentity.getIdentity()).nodeId;
}

export async function runRemoteTask(host: string, command: string): Promise<{ result: string; model: string; durationMs: number }> {
  const started = Date.now();
  let run = await controlRequest<CommandSnapshot>(host, "POST", "/hive/control/commands", { command, reason: "Requested from paired Companion" });
  if (!window.confirm(`Allow this command on ${host}?\n\n${command}`)) {
    await controlRequest(host, "POST", `/hive/control/approvals/${run.id}/decision`, { approved: false });
    throw new Error("Command rejected.");
  }
  await controlRequest(host, "POST", `/hive/control/approvals/${run.id}/decision`, { approved: true });
  while (["pending", "awaiting_approval", "running"].includes(run.status)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = await controlRequest<CommandSnapshot>(host, "GET", `/hive/control/commands/${run.id}`);
  }
  if (run.status !== "complete") throw new Error(run.error || `Command ${run.status}.`);
  return { result: run.output, model: "powershell", durationMs: Date.now() - started };
}

export function openRemoteTerminal(host: string, cwd?: string) {
  return controlRequest<TerminalSnapshot>(host, "POST", "/hive/control/terminals", { cwd, reason: "Interactive Companion terminal" });
}
export function approveRemoteAction(host: string, id: string, approved: boolean) {
  return controlRequest(host, "POST", `/hive/control/approvals/${id}/decision`, { approved });
}
export function readRemoteTerminal(host: string, id: string, offset: number) {
  return controlRequest<TerminalSnapshot>(host, "GET", `/hive/control/terminals/${id}?offset=${offset}`);
}
export function writeRemoteTerminal(host: string, id: string, input: string) {
  return controlRequest(host, "POST", `/hive/control/terminals/${id}/input`, { input });
}
export function closeRemoteTerminal(host: string, id: string) {
  return controlRequest(host, "DELETE", `/hive/control/terminals/${id}`);
}
