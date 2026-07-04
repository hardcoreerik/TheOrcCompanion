import { Capacitor, registerPlugin } from "@capacitor/core";

const NODE_PORT = 7078;
const TASK_PORT = 7079;
const PEERS_KEY = "orc-companion-hive-peers";
const hiveFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });

interface HiveIdentityNative {
  getIdentity(): Promise<{ nodeId: string; signingPublicKeyDer: string; exchangePublicKeyDer: string }>;
  createPairingRequest(options: { name: string; vramMb?: number }): Promise<Record<string, unknown>>;
  trustPeer(options: { nodeId: string; signingPublicKeyDer: string; exchangePublicKeyDer: string; hiveId?: string }): Promise<{ nodeId: string }>;
  forgetPeer(options: { nodeId: string }): Promise<void>;
  signRequest(options: { nodeId: string; method: string; path: string; body: string }): Promise<Record<string, string>>;
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

export interface HiveTopologyNode {
  nodeId: string;
  name: string;
  role: string;
  state: "online" | "offline";
  isMobile: boolean;
}

export interface RemoteHiveTask {
  host: string;
  taskId: string;
  spec: string;
  status: string;
  result?: string;
  errorMsg?: string;
  claimedBy?: string;
  submittedAt: string;
}

function requireAndroid() {
  if (Capacitor.getPlatform() !== "android") throw new Error("HIVE control is available in the Android app only.");
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

export async function pairWithNode(host: string, label: string): Promise<PendingPairing> {
  requireAndroid();
  const request = await HiveIdentity.createPairingRequest({ name: label });
  const response = await hiveFetch(`http://${host}:${NODE_PORT}/hive/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Pairing failed with HTTP ${response.status}`);
  const sessionId = String(request.sessionId);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const poll = await hiveFetch(`http://${host}:${NODE_PORT}/hive/pair/${sessionId}`);
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

export async function signedHiveHeaders(host: string, method: string, path: string, body = "") {
  requireAndroid();
  const peer = getPairedNode(host);
  if (!peer) throw new Error(`Not paired with ${host}.`);
  return HiveIdentity.signRequest({ nodeId: peer.nodeId, method, path, body });
}

async function taskRequest<T>(host: string, method: string, path: string, value?: unknown): Promise<T> {
  const body = value === undefined ? "" : JSON.stringify(value);
  const headers = await signedHiveHeaders(host, method, path, body);
  const response = await hiveFetch(`http://${host}:${TASK_PORT}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body || undefined,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HIVE request failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getControlStatus(host: string) {
  const response = await hiveFetch(`http://${host}:${NODE_PORT}/hive/info`);
  if (!response.ok) throw new Error(`HIVE status failed with HTTP ${response.status}`);
  const info = await response.json() as { Name: string; Models?: string[]; Lanes?: string[] };
  const peer = getPairedNode(host);
  const center: HiveTopologyNode = {
    nodeId: peer?.nodeId ?? host,
    name: info.Name,
    role: "warchief",
    state: "online",
    isMobile: false,
  };
  return { nodeName: info.Name, info: { models: info.Models ?? [], lanes: info.Lanes ?? [] }, topology: { center, peers: [] } };
}

export async function getCompanionNodeId() {
  requireAndroid();
  return (await HiveIdentity.getIdentity()).nodeId;
}

export async function submitRemoteTask(host: string, spec: string): Promise<RemoteHiveTask> {
  const submitted = await taskRequest<{ taskId: string }>(host, "POST", "/hive/tasks/submit", {
    role: "Researcher",
    title: spec.split("\n", 1)[0].slice(0, 80) || "Companion request",
    spec,
    projectGoal: "Requested remotely from TheOrc Companion",
    timeoutMs: 300_000,
  });
  return { host, taskId: submitted.taskId, spec, status: "pending", submittedAt: new Date().toISOString() };
}

export async function getRemoteTask(task: RemoteHiveTask): Promise<RemoteHiveTask> {
  const status = await taskRequest<Omit<RemoteHiveTask, "host" | "spec" | "submittedAt">>(task.host, "GET", `/hive/tasks/${task.taskId}`);
  return { ...task, ...status };
}
