import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-loaded Google GenAI Helper to prevent startup failure if API key is missing
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// REST API for HIvEMIND Orchestration
app.post("/api/hivemind/orchestrate", async (req, res) => {
  const { prompt, localSensors, selectedModel } = req.body;

  if (!prompt) {
    res.status(400).json({ error: "No prompt directive was provided." });
    return;
  }

  const ai = getGeminiClient();

  // If API key is missing, fall back to an extremely high-fidelity mock orchestration plan
  // to ensure the app continues to function seamlessly in development/review mode!
  if (!ai) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to high-fidelity simulated response.");
    
    // Create rich simulated responses based on key phrases in the prompt
    let simulatedResponse = {
      thoughtStream: `Local secure Hivemind simulation mode initialized using engine ${selectedModel || "gemini-2.5-flash"}. Directive parsed. No GEMINI_API_KEY detected in environment secrets. Swarm is functioning in isolated safe simulation mode.`,
      orchestrationPlan: [
        {
          id: "task-01",
          title: "Micro-Enviro Sweep",
          target: "local_device_slm" as const,
          agentType: "Sensory Swarm",
          status: "pending",
          actionRequired: "Measure environment ambient frequency and compute background noise signature.",
          payload: `Analyzing local mic input data points at ${localSensors?.audioDb || 42} dB for anomaly detection.`
        },
        {
          id: "task-02",
          title: "Spatial Validation",
          target: "local_device_slm" as const,
          agentType: "Local Executor",
          status: "pending",
          actionRequired: "Query device coordinate systems to verify localized geofence security.",
          payload: "Geofencing validation. Lat: " + (localSensors?.latitude || "37.7749") + ", Lng: " + (localSensors?.longitude || "-122.4194")
        },
        {
          id: "task-03",
          title: "Telemetry Sync",
          target: "hivemind_core" as const,
          agentType: "Orchestrator Node",
          status: "pending",
          actionRequired: "Synthesize device battery state and schedule next local checkpoint.",
          payload: "Active companion diagnostics sync. System power profile: " + (localSensors?.batteryLevel ? `${Math.round(localSensors.batteryLevel * 100)}%` : "84%")
        }
      ],
      suggestedLocalModels: ["gemma-2-2b-it-q4", "phi-3-mini-4k-instruct-int8"],
      overallComplexity: "Medium [Simulated]"
    };

    // Tailor mock plans according to terms in the prompt
    const pLower = prompt.toLowerCase();
    if (pLower.includes("camera") || pLower.includes("image") || pLower.includes("see")) {
      simulatedResponse.thoughtStream = "Visual task detected. Tasking local companion to acquire optical feed frame, while cloud core handles high-dimension convolutional feature mapping.";
      simulatedResponse.orchestrationPlan = [
        {
          id: "camera-01",
          title: "Optical Capture",
          target: "local_device_slm",
          agentType: "Visual Collector",
          status: "pending",
          actionRequired: "Initialize camera sensor and query frame color temperature metrics.",
          payload: "Triggering camera input matrix scanning."
        },
        {
          id: "camera-02",
          title: "Deep Image Classification",
          target: "hivemind_core",
          agentType: "Cognitive Swarm",
          status: "pending",
          actionRequired: "Process captured frame structures against distributed Hivemind embedding banks.",
          payload: "Perform high-tier visual reasoning on device metadata."
        }
      ];
    } else if (pLower.includes("audio") || pLower.includes("sound") || pLower.includes("voice")) {
      simulatedResponse.thoughtStream = "Acoustic sequence identified. Routing real-time microphone diagnostics to local device fast speech-to-text, before syncing tokens with HIVEMIND Core semantic layers.";
      simulatedResponse.orchestrationPlan = [
        {
          id: "audio-01",
          title: "PCM Buffer Sweep",
          target: "local_device_slm",
          agentType: "Acoustic Sensor",
          status: "pending",
          actionRequired: "Extract decibel peaks and isolate speech frequency ranges.",
          payload: "Acoustic sweep of local spectrum. Current input level: " + (localSensors?.audioDb || 38) + " dB"
        },
        {
          id: "audio-02",
          title: "Semantic Analysis",
          target: "hivemind_core",
          agentType: "Cognitive Swarm",
          status: "pending",
          actionRequired: "Analyze decoded audio text stream for master command structural matching.",
          payload: "Identify intent from acoustic token structures."
        }
      ];
    }

    res.json({ data: simulatedResponse, isDemoMode: true });
    return;
  }

  try {
    const sensorContext = `
      Current Companion Device Sensors:
      - Lat/Lng: ${localSensors?.latitude || "Unknown"}, ${localSensors?.longitude || "Unknown"}
      - Ambient Audio: ${localSensors?.audioDb || "Unknown"} dB
      - Device Power Profile: ${localSensors?.batteryLevel ? Math.round(localSensors.batteryLevel * 100) + "%" : "Unknown"}
      - Timestamp: ${localSensors?.timestamp || new Date().toISOString()}
    `;

    const allowedCloudModels = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"];
    const activeModel = allowedCloudModels.includes(selectedModel) ? selectedModel : "gemini-3.5-flash";

    const localModelContext = !allowedCloudModels.includes(selectedModel) && selectedModel
      ? `\nOptimize the Swarm plan specifically for edge-first offloaded execution using the simulated local on-device SLM core: ${selectedModel}. Maximize on-device ('local_device_slm') sensory or computational task assignments where possible.`
      : "";

    const modelResponse = await ai.models.generateContent({
      model: activeModel,
      contents: [
        {
          role: "user",
          parts: [{ text: `DIRECTIVE: "${prompt}"\n\n${sensorContext}${localModelContext}\n\nDeconstruct this directive into an orchestrated multi-agent execution plan.` }]
        }
      ],
      config: {
        systemInstruction: "You are TheORC Hivemind (The Orchestrated Swarm Companion Cloud Node). Your objective is to orchestrate mobile device sub-agents and local on-device SLMs. You receive high-level directives along with active client device sensor data. Your response must partition operations, delegating fast or privacy-conscious sensory checks to local edge devices ('local_device_slm'), and deep analytical or heavy computing parts to the high-tier cloud node ('hivemind_core'). Target 'local_device_slm' tasks for on-device executors, and 'hivemind_core' for backend processes.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            thoughtStream: { 
              type: Type.STRING, 
              description: "A high-level reasoning stream explaining the logic and division of labor between phone and cloud servers." 
            },
            orchestrationPlan: {
              type: Type.ARRAY,
              description: "The DAG of tasks to execute.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique task node ID (e.g., plan-01, plan-02)" },
                  title: { type: Type.STRING, description: "Compact visual title of the operation." },
                  target: { 
                    type: Type.STRING, 
                    description: "Target runtime: 'local_device_slm' or 'hivemind_core'" 
                  },
                  agentType: { type: Type.STRING, description: "Sub-agent designation (e.g. Sensory Swarm, Audio Analyzer, Spatial Navigator, Local Executor)" },
                  status: { type: Type.STRING, description: "Default to 'pending'" },
                  actionRequired: { type: Type.STRING, description: "Direct explicit actionable instruction for this agent." },
                  payload: { type: Type.STRING, description: "The specific sub-prompt or data parameter to pass to the running agent." }
                },
                required: ["id", "title", "target", "agentType", "status", "actionRequired", "payload"]
              }
            },
            suggestedLocalModels: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of recommended client-side SLMs to activate on-device (e.g. gemma-2b, phi-3-mini, llama-3-8b)."
            },
            overallComplexity: { 
              type: Type.STRING, 
              description: "Summary index of the calculation load (Low, Medium, or High)." 
            }
          },
          required: ["thoughtStream", "orchestrationPlan", "suggestedLocalModels", "overallComplexity"]
        }
      }
    });

    const parsedData = JSON.parse(modelResponse.text || "{}");
    res.json({ data: parsedData, isDemoMode: false });

  } catch (error: any) {
    console.error("Gemini HIVEMIND Orchestration failed:", error);
    res.status(500).json({ error: error?.message || "Internal HIVEMIND communication failure." });
  }
});

// Simulate on-core processing when a task targeted for Hivemind Core runs
app.post("/api/hivemind/process-task", async (req, res) => {
  const { actionRequired, payload } = req.body;

  if (!actionRequired) {
    res.status(400).json({ error: "Missing action requirements." });
    return;
  }

  const ai = getGeminiClient();

  if (!ai) {
    // Elegant simulation if API key is missing
    setTimeout(() => {
      res.json({
        output: `[REmOTE COMPUTATION] Safe-Mode simulation response: Completed analytical processing for action "${actionRequired}". Telemetry reports optimal token output. Sync check complete.`,
        executionTimeMs: 420,
        networkLatencyMs: 45
      });
    }, 400);
    return;
  }

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Execute this sub-agent cloud analytical task:\nAction: ${actionRequired}\nContext/Payload: ${payload}\nProvide a concise 2-3 sentence execution result report representing computed telemetry.`,
      config: {
        systemInstruction: "You are the heavy-computing cluster of the O.R.C. HIVEMIND. Process the requested analytical payload and return simulated status updates."
      }
    });

    res.json({
      output: result.text?.trim() || "Task completed successfully without explicit output metrics.",
      executionTimeMs: Math.round(500 + Math.random() * 800),
      networkLatencyMs: Math.round(30 + Math.random() * 40)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to process target task on Hivemind core." });
  }
});

// REST API for HIvEMIND Chat & Research
app.post("/api/hivemind/research", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    res.status(400).json({ error: "No research query was provided." });
    return;
  }

  const ai = getGeminiClient();

  // If API key is missing or invalid, fallback to high-fidelity simulation
  if (!ai) {
    const qLower = query.toLowerCase();
    let text = "";
    let media: any[] = [];

    // 1. Swarm / Drone Autonomy
    if (qLower.includes("drone") || qLower.includes("swarm") || qLower.includes("autonomy")) {
      text = "O.R.C. Hivemind telemetry archives contain extensive field testing logs regarding multi-agent micro-drone swarm configurations. Direct visual feedback registers synchronization speeds in milliseconds. Edge routing is synchronized across Vulkan NNAPI nodes.";
      media = [
        {
          type: "video",
          title: "Autonomous Drone Swarm Field Test [O.R.C. Spec]",
          url: "https://www.youtube.com/embed/m6g2pP2NidI",
          thumbnailUrl: "https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=300",
          description: "High-density flight pattern synchronization across 50 simulated edge drone micro-controllers."
        },
        {
          type: "image",
          title: "Multi-Agent Optical Sensor Calibration",
          url: "https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800",
          description: "Infrared spatial rendering of environment geometries during tactical navigation exercises."
        }
      ];
    }
    // 2. Hardware / Vulkan / Benchmark
    else if (qLower.includes("vulkan") || qLower.includes("benchmark") || qLower.includes("slm") || qLower.includes("local")) {
      text = "Compiler optimization protocols mapped for local Small Language Models (SLMs) running on Android NPU/Vulkan frameworks. Execution checks show peak efficiency achieved under int4/int8 quantization structures, offloading heavy analytical sub-routines from Hivemind Core.";
      media = [
        {
          type: "video",
          title: "Vulkan GPU Neural Acceleration DemoDelta",
          url: "https://www.youtube.com/embed/0_Bskg_Nlyc",
          thumbnailUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=300",
          description: "Demonstrating 30+ t/s performance on off-chip mobile shader arrays using quantized GGUF weights."
        },
        {
          type: "document",
          title: "O.R.C. Vulkan Compiling Matrix v2.10",
          url: "JSON_DATA_ORC_COMPILER_MATRIX",
          description: "Vulkan execution mapping configurations and memory allocations for Gemma 2B and Phi-3 Edge cores."
        }
      ];
    }
    // 3. Document / Spec Sheet
    else if (qLower.includes("doc") || qLower.includes("spec") || qLower.includes("paper") || qLower.includes("architecture")) {
      text = "Official release document for Hardcoreerik/TheOrc. This contains specifications on client-server protocols, encryption handshakes, sensory sync queues, and local system orchestrations.";
      media = [
        {
          type: "document",
          title: "Hardcoreerik/TheOrc Swarm Spec v2.10",
          url: "DOC_TEXT_SWARM_SPEC_SHEET",
          description: "Master document outlining the multi-node hivemind orchestration paradigm, TCP sensor pipelines, and secure on-device routing."
        },
        {
          type: "link",
          title: "TheOrc Official GitHub Repository",
          url: "https://github.com/Hardcoreerik/TheOrc",
          description: "Access the complete open-source code, pull requests, and core issues log of the main O.R.C. orchestrator."
        }
      ];
    }
    // 4. Fallback Default
    else {
      text = `O.R.C. Search & Intelligence terminal has processed your query: "${query}". Search results indicate moderate convergence rates across remote nodes. Swarm cores are responsive and ready for action.`;
      media = [
        {
          type: "video",
          title: "TheOrc Swarm System Overview",
          url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
          thumbnailUrl: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=300",
          description: "Dynamic operational lecture analyzing multi-agent synchronization and secure edge fallback behaviors."
        },
        {
          type: "image",
          title: "Secured Swarm Connection Vector Map",
          url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800",
          description: "Active topology mapping of regional nodes dialing back to the central Hivemind core cluster."
        }
      ];
    }

    res.json({ text, media, isDemoMode: true });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Perform internet research, intelligence analysis, and generate a rich interactive answer to: "${query}". Include high-fidelity suggestions and optional media components in the JSON response if appropriate. Keep theme consistent with Hardcoreerik/TheOrc multi-agent cybernetics.`,
      config: {
        systemInstruction: "You are the O.R.C Intelligence Terminal (O.R.C Swarm Research Node). Your task is to process user research queries or chat messages. If relevant to the users query, you MUST output a JSON response containing high-quality text explanation AND any relevant interactive media arrays (videos, images, specs, or external research articles). Keep the tone technical, aligned with Hardcoreerik/TheOrc branding (dark military-cybernetic aesthetics, extreme multi-agent telemetry). Provide working links where possible. For video elements, use embeddable platforms like YouTube embedded links.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The core written response to the user's research query." },
            media: {
              type: Type.ARRAY,
              description: "Optional relevant interactive media attachments (videos, images, documents, or external web links). Minimum 1, maximum 3.",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "Type of media: 'video', 'image', 'document', or 'link'" },
                  title: { type: Type.STRING, description: "The title of the attachment." },
                  url: { type: Type.STRING, description: "The URL. For videos, a YouTube embed URL (e.g., 'https://www.youtube.com/embed/dQw4w9WgXcQ' or other valid links). For images, use beautiful Unsplash URLs (e.g. 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600'). For links, use standard websites." },
                  thumbnailUrl: { type: Type.STRING, description: "Optional thumbnail image URL for videos or documents." },
                  description: { type: Type.STRING, description: "Helpful caption describing the item." }
                },
                required: ["type", "title", "url", "description"]
              }
            }
          },
          required: ["text", "media"]
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    res.json({ ...parsedData, isDemoMode: false });

  } catch (error: any) {
    console.error("Gemini hivemind research failed:", error);
    res.status(500).json({ error: error?.message || "Failed to retrieve intelligence data." });
  }
});

// Configure Vite middleware or Static Fallback
async function start() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TheORC Companion server running at http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
});
