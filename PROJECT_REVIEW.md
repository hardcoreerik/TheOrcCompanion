# TheOrc Companion: Architecture Review & Gap Analysis

## Implementation Status (2026-06-28 follow-up)

The gaps below were real, but the original roadmap assumed a protocol that didn't
exist yet. It turned out TheOrc already has a working, unauthenticated
distributed-task protocol (`HiveTaskQueue.cs`, port 7079 — poll/claim/heartbeat/
complete) used for PC-to-PC worker dispatch. Rather than invent a parallel
scheme, this pass plugged the companion into *that* protocol and added the one
piece TheOrc was missing for either direction: a trust/signing layer.

**Shipped, both sides build/typecheck clean:**

- **`HiveControlAuth.cs`** (new, TheOrc) — shared-secret pairing + HMAC-SHA256
  request signing + CORS/preflight helper. Pairing is off by default
  (`AppSettings.HiveAllowRemoteControlPairing`); secrets live in
  `%APPDATA%\OrchestratorIDE\hive-control-peers.json`.
- **`HiveNodeServer.cs`** (extended) — new `/hive/control/pair`,
  `/hive/control/status`, `/hive/control/run-task` routes on the existing
  port-7078 listener. `run-task` is the literal "control the Warchief from the
  phone" channel: a signed request makes the node run one inference task with
  its own Ollama and returns the result inline.
- **`HiveTaskQueue.cs`** — CORS headers added so a WebView fetch (not just a
  native HttpClient) can poll/claim/heartbeat/complete.
- **`MainWindow.xaml.cs`** — wires the existing `_ollama` client and the new
  settings flag into `HiveNodeServer.Start(...)`.
- **`src/lib/hive/controlClient.ts`** (new, companion) — Web Crypto HMAC
  signing; `pairWithNode`, `getControlStatus`, `runRemoteTask`. Secrets stored
  per-host in `localStorage`.
- **`src/lib/hive/workerAgent.ts`** (new, companion) — `HiveWorkerAgentClient`:
  a TS reimplementation of `HiveWorkerAgent.cs`'s poll/claim/heartbeat/complete
  loop, runs entirely as `fetch` calls from the WebView (no Express dependency,
  so it works in a packaged release APK exactly like `npm run dev`). Execution
  is delegated to a caller-supplied `runInference` callback wired to the
  phone's already-working on-device model.
- **`App.tsx`** — Hive screen gained: pair/unpair + status refresh, a
  "run on this node" remote-command box, and a "Join as HIVE worker" toggle
  that starts/stops the worker loop using the currently loaded local model.

**Verified:** `dotnet build OrchestratorIDE.csproj` → 0 errors. `tsc --noEmit`
→ 0 errors. `npm run dev` boots and existing `/api/hive/*` endpoints still
respond. **Not verified:** no TheOrc desktop instance was running during this
session, so the pairing/run-task/worker-claim round trip was not exercised
live end-to-end — that's the next thing to do (see below).

**Deliberately deferred** (still real gaps, now smaller):
- Per-peer secret rotation/expiry UI on the desktop side (currently: re-pairing
  rotates the secret; there's no "list/revoke paired phones" panel yet —
  `HiveControlAuth.ListPeers/RevokePeer` exist as C# methods but aren't wired
  to any UI).
- Job persistence (companion job history is still in-memory in `server.ts`,
  unrelated to the new worker path which doesn't use that queue at all).
- Workflow/DAG submission, dynamic capability throttling by battery — Phase 2
  items, untouched.

---


## Executive Summary

TheOrc Companion is a **field observer and edge worker** – it currently functions as a constrained mobile node that discovers HIVE routes, runs local jobs, and chatting locally. However, it lacks the bidirectional control and integration needed for **remote warchief command** and **full distributed HIVE membership**.

This review identifies the architectural gaps and outlines the path to:
1. **Remote Control (Warchief ↔ Companion)** – Accept signed commands from TheOrc warchief
2. **Standalone Node Operation** – Participate as a full HIVE member (claim tasks, report status, submit results)

---

## Current Architecture

### What Works Today

#### 1. **Network Discovery & Route Management** (server.ts:169-200)
- Detects localhost, LAN, and Tailscale routes
- Reads TheOrc configured host from `%APPDATA%\OrchestratorIDE\settings.json`
- Probes for HIVE API (`/hive/info`) and Ollama availability
- Routes have trust state tracking but are **read-only observations**

#### 2. **Setup & Persistence** (server.ts:218-266)
- Saves companion settings to `%APPDATA%\TheOrcCompanion\settings.json`
- Tracks companion name, preferred host, battery cutoff, enabled capabilities
- Known peers stored in `hive-peers.json` with local trust decisions

#### 3. **Local Chat & Agent Loop** (src/App.tsx, src/lib/agent/)
- Downloads and loads LiteRT/MLC models on Android (Capacitor plugin)
- Runs on-device inference without cloud API keys
- Agent tool loop with web search, page fetch, device profile queries
- No cloud orchestration – purely local LLM inference

#### 4. **Edge Job Queue** (server.ts:652-705)
- Job types: `organize_directory`, `scrape_url`
- Jobs mapped to execution lanes and logical roles (RESEARCHER, DATA_ENGINEER)
- In-memory queue only – no persistence or result uplink
- No remote job submission from TheOrc

#### 5. **HIVE Observer Pattern** (server.ts:272-404, App.tsx:1152-1276)
- Companion observes peers and maintains local trust state
- No remote enforcement or server-side pairing confirmation
- Diagnostics are observer-only (refuse auto-enroll, task-claim, result-submit)
- Trust states: `unpaired_observer`, `pairing_ready`, `paired_member_pending_server_enforcement`, `blocked_untrusted`

---

## Critical Gaps for Remote Control (Warchief)

### Gap 1: No Inbound Remote Command Protocol
**Problem:** Companion accepts no commands from TheOrc. One-way discovery only.

**Impact:** TheOrc cannot:
- Task the companion with work
- Control which node is active
- Update companion settings remotely
- Revoke companion membership

**What's Missing:**
- Remote command endpoint (e.g., `POST /api/hive/inbound-task`, `POST /api/hive/remote-config`)
- Request signature verification (so only valid warchief can command)
- Task acceptance/rejection protocol
- Result submission back to warchief

**Current Code Pointers:**
- `server.ts:818-844` – Job queue is local-only. No remote job ingestion.
- `server.ts:707-753` – `companion-node/status` returns state but doesn't accept directives.

---

### Gap 2: No Cryptographic Authentication/Authorization
**Problem:** Trust is local decision only. No signed pairing or remote enforcement.

**Impact:**
- Any HIVE node claiming to be warchief could theoretically task the companion
- No mutual authentication between companion and warchief
- No signature-based task validation
- Trust state is advisory, not enforced

**What's Missing:**
- Companion identity key generation and rotation
- Warchief public key distribution to companion
- Request signature verification (Ed25519 or similar)
- Challenge-response handshake for new pairings
- Server-side enforcement marker and periodic validation

**Current Code Pointers:**
- `server.ts:272-283` – `protocolContextForPeer()` has `signatureHeader: null` – always unsigned
- `server.ts:95-106` – `HiveProtocolContext` has auth fields but they're never populated
- `server.ts:272-283` – No signature validation logic exists

---

### Gap 3: No Signed Work Packets
**Problem:** Jobs come from the UI only, not from TheOrc with proof-of-origin.

**Impact:**
- No audit trail for where work came from
- No ability to trace task back to specific warchief request
- No tamper protection on task definitions
- Companion can't validate "this work is legitimate and from my registered boss"

**What's Missing:**
- Work packet schema with `source_peer_id`, `timestamp`, `signature`, `nonce`
- Signature creation on warchief side before sending
- Signature validation on companion before accepting job
- Packet versioning for protocol evolution
- Tamper detection (JSON hash mismatch)

---

### Gap 4: No Capability Heartbeat or Status Reporting
**Problem:** Companion runs silently. Warchief has no way to know if companion is alive, healthy, or has capability shifts.

**Impact:**
- Warchief can't know if companion is still reachable
- Can't know if battery/storage changed
- Can't know if models changed or capability was disabled
- Can't make scheduling decisions based on real-time state

**What's Missing:**
- Periodic heartbeat from companion → warchief (e.g., every 30–60 seconds)
- Heartbeat includes: battery %, storage, loaded model, network state, job queue depth
- Warchief aggregates heartbeats into companion health view
- Stale heartbeat detection (mark companion offline if no heartbeat in X seconds)

**Current Code Pointers:**
- `server.ts:707-753` – Status is pulled by companion UI, not pushed to warchief
- No background task or interval for status reporting

---

### Gap 5: No Task Result Submission Back to Warchief
**Problem:** Jobs run and complete, but results stay on the phone.

**Impact:**
- Warchief never sees job results
- No feedback loop for task orchestration
- Can't build result aggregation across multiple nodes
- No verification that work was actually completed

**What's Missing:**
- Result submission endpoint (e.g., `POST /api/hive/submit-result`)
- Result signing before submission (proof of companion execution)
- Warchief result collection and aggregation
- Retry logic if warchief is unreachable during submission
- Persistent queue of completed jobs waiting for submission

**Current Code Pointers:**
- `server.ts:653-685` – Job results are in-memory only. No persistence or uplink.
- `server.ts:1091-1096` – `refusedOperations: ["result_submit", ...]` is hardcoded.

---

## Critical Gaps for Standalone Node Operation

### Gap 6: No Distributed Task Claiming
**Problem:** Companion can't claim tasks from a shared HIVE queue.

**Impact:**
- Can only run locally-queued jobs
- Can't participate in work distribution
- Multiple companions can't coordinate around a shared task pool
- No role-based task routing

**What's Missing:**
- Task broker integration (query for available tasks)
- Task claiming protocol (atomic "claim this task ID")
- Task state machine (available → claimed → running → completed)
- Role/lane filtering (only claim tasks matching companion's lanes)

---

### Gap 7: No Result Aggregation or Persistence
**Problem:** Results live in memory; lost on restart.

**Impact:**
- Restarting the app loses job history
- No audit trail of work completed
- Can't retry failed jobs
- Warchief can't retrieve results later

**What's Missing:**
- SQLite/JSON job store on-device
- Schema: `job_history` with job ID, status, input, output, timestamps
- Persistence on job completion and result submission
- Query endpoint: `GET /api/companion-node/jobs?status=completed` (with pagination)

---

### Gap 8: No Distributed Task Orchestration from Warchief
**Problem:** Companion has job types but no way for warchief to compose complex multi-step workflows.

**Impact:**
- Warchief can't chain companion tasks
- Can't conditionally route work based on results
- Can't distribute a DAG of work across multiple companions
- Can't do hedging or failover

**What's Missing:**
- Workflow/DAG submission from warchief (e.g., `POST /api/hive/submit-workflow`)
- Companion unpacks DAG, executes steps, reports intermediate results
- Conditional branching support (if output matches X, run Y next)
- Step-by-step status reporting back to warchief

---

### Gap 9: No Role Declaration or Dynamic Capability Reporting
**Problem:** Companion hardcodes roles and capabilities; can't adapt dynamically.

**Impact:**
- Can't change enabled capabilities without code change
- Can't disable capability if device is low on battery
- Warchief can't ask "what can this node do right now?"
- No visibility into temporary constraints (e.g., "device low battery – no heavy tasks")

**What's Missing:**
- Dynamic capability flags updated at runtime (disable slow_scrape if battery < 10%)
- Capability reporting in heartbeat
- Warchief capability query endpoint
- Remote capability adjustment endpoint (warchief tells companion to reduce scope)

---

## Steps to Implement Remote Control (Priority 1)

### 1A. Add Companion & Warchief Identity & Signing
**File:** `src/lib/hive/identity.ts` (new)

```typescript
// Generate Ed25519 identity key on first launch
// Store in %APPDATA%\TheOrcCompanion\identity.json
// Include: private key, public key, peerId
// Warchief distributes its public key to companion during pairing

interface CompanionIdentity {
  peerId: string;
  publicKey: string; // exported public key
  createdAt: string;
  rotationSchedule?: { nextRotationAt: string };
}

// Function to sign work packets
async function signWorkPacket(packet: WorkPacket, privateKey: string): Promise<string>
async function verifyWorkPacketSignature(packet: WorkPacket, signature: string, warchief_public_key: string): Promise<boolean>
```

**Time estimate:** 2–3 hours

### 1B. Add Remote Command Endpoint
**File:** `server.ts` – Add new POST endpoint

```typescript
app.post("/api/hive/inbound-task", async (req, res) => {
  // 1. Extract signature header
  const signature = req.headers["x-hive-signature"];
  const warchief = req.body.source_peer_id;
  
  // 2. Verify signature against warchief's public key (stored in known peers)
  // 3. Check timestamp freshness (nonce)
  // 4. Extract task payload
  // 5. Validate task schema
  // 6. Enqueue job as usual
  
  res.json({ ok: true, jobId, status: "queued" });
});
```

**Changes to `server.ts`:**
- Lines ~815–844: Modify `POST /api/companion-node/jobs` to accept remote-signed tasks
- Add signature verification before enqueuing
- Add audit log of remote tasks vs. local tasks

**Time estimate:** 3–4 hours

### 1C. Add Capability Heartbeat (Push)
**File:** `server.ts` – Add heartbeat timer

```typescript
async function reportHeartbeatToWarchief() {
  const setup = await readCompanionSetupSettings();
  const status = getCurrentCompanionNodeStatus(); // existing
  
  const heartbeat = {
    peerId: companionPeerId,
    timestamp: new Date().toISOString(),
    battery: profile.batteryPercent,
    storage: profile.storageFreeBytes,
    loadedModel: loadedModel?.id || null,
    queueDepth: companionJobs.filter(j => j.status === "pending").length,
    capabilities: setup.enabledCapabilities,
    // ... other metrics
  };
  
  // Send to warchief at preferredHost:7078/hive/node-heartbeat
  try {
    await fetch(`http://${setup.preferredHost}:7078/hive/companion-heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hive-signature": sign(heartbeat) },
      body: JSON.stringify(heartbeat),
    });
  } catch (err) {
    // Log silently – heartbeat is best-effort
  }
}

// Start heartbeat on server startup
setInterval(reportHeartbeatToWarchief, 45_000); // every 45 seconds
```

**Time estimate:** 2–3 hours

### 1D. Add Result Submission Back to Warchief
**File:** `server.ts` – Modify job completion handler

```typescript
async function processCompanionJobs() {
  // ... existing code ...
  
  // After job completes:
  const result = {
    jobId: nextJob.id,
    type: nextJob.type,
    status: "completed",
    output: nextJob.result,
    timestamp: new Date().toISOString(),
    signature: sign(this),
  };
  
  // Submit to warchief
  const setup = await readCompanionSetupSettings();
  try {
    await fetch(`http://${setup.preferredHost}:7078/hive/result-submit`, {
      method: "POST",
      headers: { "x-hive-signature": sign(result) },
      body: JSON.stringify(result),
    });
    nextJob.submittedAt = now;
  } catch (err) {
    // Retry on next cycle
    nextJob.submitRetries = (nextJob.submitRetries || 0) + 1;
  }
}
```

**Time estimate:** 2–3 hours

### 1E. Warchief Integration Points (TheOrc Side)
**File:** `TheOrc/hive/companion-control.ts` (in TheOrc repo)

```typescript
// Warchief side: discover and register companion
async function registerCompanionPeer(companionHost: string) {
  const response = await fetch(`http://${companionHost}:3000/api/hive/network-targets`);
  const data = await response.json();
  const companionPeerId = data.companion.peerId;
  
  // Send warchief's public key to companion
  await fetch(`http://${companionHost}:3000/api/hive/register-warchief`, {
    method: "POST",
    body: JSON.stringify({
      warchief_peer_id: this.peerId,
      public_key: this.publicKey,
    }),
  });
}

// Warchief side: send a task to companion
async function taskCompanion(companionHost: string, job: WorkPacket) {
  const signature = sign(job, this.privateKey);
  const response = await fetch(`http://${companionHost}:3000/api/hive/inbound-task`, {
    method: "POST",
    headers: { "x-hive-signature": signature },
    body: JSON.stringify(job),
  });
  return response.json();
}

// Warchief side: listen for heartbeats and results
app.post("/hive/companion-heartbeat", (req, res) => {
  const heartbeat = req.body;
  const signature = req.headers["x-hive-signature"];
  
  // Verify companion signature
  const companionKey = getCompanionPublicKey(heartbeat.peerId);
  if (!verifySignature(heartbeat, signature, companionKey)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  
  // Update companion health view
  updateCompanionStatus(heartbeat.peerId, heartbeat);
  res.json({ ok: true });
});
```

**Time estimate:** 4–5 hours (depends on TheOrc codebase)

---

## Steps to Implement Standalone Node Operation (Priority 2)

### 2A. Add Job Persistence (SQLite)
**File:** `src/lib/jobStore.ts` (new)

```typescript
import Database from "better-sqlite3";

const db = new Database(path.join(companionDataDir, "jobs.db"));

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    startedAt TEXT,
    completedAt TEXT,
    input JSON NOT NULL,
    result JSON,
    error TEXT,
    submittedAt TEXT,
    submitRetries INTEGER DEFAULT 0
  );
`);

export async function saveJob(job: CompanionJob) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(job.id, job.type, job.status, ...);
}

export async function getJobHistory(status?: string, limit = 100) {
  const sql = status 
    ? "SELECT * FROM jobs WHERE status = ? ORDER BY createdAt DESC LIMIT ?"
    : "SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?";
  return db.prepare(sql).all(status || limit, limit);
}
```

**Time estimate:** 2–3 hours

### 2B. Add Task Broker Integration
**File:** `server.ts` + `src/lib/hive/taskBroker.ts` (new)

```typescript
// Companion polls for available tasks (or warchief pushes)
async function claimTask() {
  const setup = await readCompanionSetupSettings();
  const response = await fetch(
    `http://${setup.preferredHost}:7078/hive/available-tasks?lanes=${setup.enabledCapabilities.join(",")}`,
    { headers: { "x-companion-id": companionPeerId } }
  );
  
  if (!response.ok) return null;
  
  const tasks = await response.json();
  const selectedTask = tasks[0]; // or use priority/load-balancing
  
  // Claim the task
  const claimResp = await fetch(
    `http://${setup.preferredHost}:7078/hive/claim-task`,
    {
      method: "POST",
      body: JSON.stringify({
        task_id: selectedTask.id,
        companion_peer_id: companionPeerId,
        signature: sign({ task_id: selectedTask.id, companion_peer_id: companionPeerId }),
      }),
    }
  );
  
  return (await claimResp.json()).task;
}

// Start task claiming loop
setInterval(async () => {
  if (getCurrentCompanionJob()) return; // only claim if idle
  const task = await claimTask();
  if (task) {
    enqueueCompanionJob(task.type, task.input, task.title);
  }
}, 10_000); // Check every 10 seconds
```

**Time estimate:** 3–4 hours

### 2C. Add Workflow/DAG Support
**File:** `src/lib/hive/workflow.ts` (new)

```typescript
interface WorkflowStep {
  id: string;
  type: "job" | "branch" | "join";
  jobType?: CompanionJobType;
  input?: Record<string, any>;
  nextSteps?: string[];
  condition?: { outputPath: string; expectedValue: any };
}

interface Workflow {
  id: string;
  steps: Record<string, WorkflowStep>;
  startStepId: string;
}

async function executeWorkflow(workflow: Workflow, initialInput: Record<string, any>) {
  const state = { currentStepId: workflow.startStepId, results: {} };
  
  while (state.currentStepId) {
    const step = workflow.steps[state.currentStepId];
    
    if (step.type === "job") {
      const result = await runOrganizeDirectoryJob(step.input!);
      state.results[step.id] = result;
      
      // Determine next step
      if (step.condition) {
        const output = getPathValue(result, step.condition.outputPath);
        if (output === step.condition.expectedValue) {
          state.currentStepId = step.nextSteps?.[0] || null;
        } else {
          state.currentStepId = step.nextSteps?.[1] || null;
        }
      } else {
        state.currentStepId = step.nextSteps?.[0] || null;
      }
    }
  }
  
  return state.results;
}

// Endpoint to submit workflow from warchief
app.post("/api/companion-node/workflow", async (req, res) => {
  const workflow = req.body as Workflow;
  const workflowId = createJobId("workflow");
  
  void executeWorkflow(workflow, {}).then(results => {
    // Submit results back to warchief
  });
  
  res.json({ ok: true, workflowId, status: "started" });
});
```

**Time estimate:** 4–5 hours

### 2D. Add Dynamic Capability Reporting
**File:** `server.ts` + `src/App.tsx`

Modify setup settings to allow runtime updates:

```typescript
// In server.ts
app.put("/api/companion-node/setup", async (req, res) => {
  const setup = await readCompanionSetupSettings();
  
  // Allow remote updates from warchief (with signature)
  if (req.headers["x-hive-signature"]) {
    // Verify warchief signature
    const verified = await verifyWarchief(req.body, req.headers["x-hive-signature"]);
    if (!verified) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  
  const updated = { ...setup, ...req.body };
  await writeCompanionSetupSettings(updated);
  res.json({ ok: true, setup: updated });
});

// Heartbeat now includes dynamic constraints
reportHeartbeatToWarchief() {
  return {
    ...existing,
    capabilities: setup.enabledCapabilities,
    constraints: {
      batteryLow: profile.batteryPercent < 15,
      storageLow: profile.storageFreeBytes < 1_000_000_000,
      networkMetered: profile.metered,
    },
  };
}
```

**Time estimate:** 2–3 hours

---

## Implementation Roadmap

### Phase 1: Remote Control (3–4 weeks, high priority)
1. **Week 1:** Identity & signing (`1A`, `1B`)
2. **Week 2:** Heartbeat & result submission (`1C`, `1D`)
3. **Week 3:** Warchief integration (`1E`)
4. **Week 4:** Testing, security review, deployment

### Phase 2: Standalone Node (2–3 weeks, medium priority)
1. **Week 1:** Job persistence & task broker (`2A`, `2B`)
2. **Week 2:** Workflow DAG support (`2C`)
3. **Week 3:** Dynamic capability reporting (`2D`), integration testing

### Phase 3: Production Hardening (2 weeks)
- Signature verification testing
- Replay attack prevention
- Network resilience (offline -> online transitions)
- Performance profiling (heartbeat overhead)
- Android release signing and deployment

---

## Security Considerations

1. **Never ship private keys in the APK.** Generate on first launch, store in secure storage.
2. **Verify all inbound signatures** before executing remote tasks.
3. **Rate-limit** remote task submission to prevent DoS.
4. **Validate all task payloads** (schema, input bounds).
5. **Audit log** all remote commands (who, when, what).
6. **Rotate keys** periodically (e.g., every 90 days).
7. **Heartbeat timing randomization** to avoid side-channel leaks.

---

## Testing Strategy

1. **Unit tests** for signing/verification (sign, verify, tamper detection)
2. **Integration tests** (local companion ↔ mock warchief)
3. **E2E tests** (companion app ↔ running TheOrc instance on same network)
4. **Soak tests** (long-running heartbeat, job queue stability)
5. **Security tests** (invalid signatures, replay attacks, old nonces)

---

## Known Unknowns / Open Questions

1. **How does TheOrc boss node (warchief) currently handle multi-node coordination?** (Need to review TheOrc code to align protocol.)
2. **Is there an existing TheOrc message bus or RPC protocol** we should layer on top of HTTP?
3. **What's the expected latency for heartbeats and result submissions** in a real HIVE?
4. **Should result submission be blocking or fire-and-forget?** (Trade-off: reliability vs. throughput)
5. **How does battery/storage constraint handling work in the broader HIVE?** (Should companion auto-disable when low?)

---

## Summary

| Goal | Current State | Gaps | Priority |
|------|---------------|------|----------|
| **Remote Control** | Observer-only | No inbound commands, signatures, auth | P1 (3–4 weeks) |
| **Heartbeat Report** | None | No status push to warchief | P1 (included) |
| **Result Uplink** | None | Jobs complete locally only | P1 (included) |
| **Standalone Node** | Can run jobs locally | No task broker, no DAG, no persistence | P2 (2–3 weeks) |
| **Capability Reports** | Static | No dynamic constraints | P2 (included) |

**Estimated Total Effort:** 7–8 weeks (phased), assuming TheOrc codebase review and warchief integration are done in parallel.
