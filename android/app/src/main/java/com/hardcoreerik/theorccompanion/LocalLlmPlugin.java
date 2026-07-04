package com.hardcoreerik.theorccompanion;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.StatFs;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Content;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;
import com.google.ai.edge.litertlm.OpenApiTool;
import com.google.ai.edge.litertlm.Role;
import com.google.ai.edge.litertlm.SamplerConfig;
import com.google.ai.edge.litertlm.ToolKt;
import com.google.ai.edge.litertlm.ToolProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.KeyStore;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

@CapacitorPlugin(
    name = "LocalLlm",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class LocalLlmPlugin extends Plugin {
    private static final String BACKEND_LITERT = "litert";
    private static final String BACKEND_MLC = "mlc";
    private static final String DEFAULT_MODEL_ID = "qwen2.5-1.5b-instruct-litert";
    private static final String SOAK_RESULT_FILE = "last-soak-test.json";
    private static final String SECURE_CHAT_KEY_ALIAS = "theorc_companion_chat_key";
    private static final String SECURE_PREFS = "theorc_companion_secure";

    private static final class PendingToolResult {
        final CountDownLatch latch = new CountDownLatch(1);
        volatile boolean ok;
        volatile String output = "";
    }

    private static final class ModelSpec {
        final String id;
        final String name;
        final String filename;
        final String url;
        final String sha256;
        final String backendId;
        final boolean recommended;
        final boolean experimental;
        final boolean supportsMultiTurn;
        final boolean supportsStreaming;
        final boolean supportsGpu;
        final boolean supportsOffline;
        final long downloadSizeBytes;

        ModelSpec(
            String id,
            String name,
            String filename,
            String url,
            String sha256,
            String backendId,
            boolean recommended,
            boolean experimental,
            boolean supportsMultiTurn,
            boolean supportsStreaming,
            boolean supportsGpu,
            boolean supportsOffline,
            long downloadSizeBytes
        ) {
            this.id = id;
            this.name = name;
            this.filename = filename;
            this.url = url;
            this.sha256 = sha256;
            this.backendId = backendId;
            this.recommended = recommended;
            this.experimental = experimental;
            this.supportsMultiTurn = supportsMultiTurn;
            this.supportsStreaming = supportsStreaming;
            this.supportsGpu = supportsGpu;
            this.supportsOffline = supportsOffline;
            this.downloadSizeBytes = downloadSizeBytes;
        }
    }

    private static final Map<String, ModelSpec> MODEL_SPECS = new LinkedHashMap<>();

    static {
        MODEL_SPECS.put(
            "qwen2.5-1.5b-instruct-litert",
            new ModelSpec(
                "qwen2.5-1.5b-instruct-litert",
                "Qwen2.5 1.5B Instruct Q8",
                "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm",
                "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm",
                "",
                BACKEND_LITERT,
                true,
                false,
                true,
                true,
                true,
                true,
                1_597_931_520L
            )
        );
        MODEL_SPECS.put(
            "qwen3-0.6b-mixed-int4-litert",
            new ModelSpec(
                "qwen3-0.6b-mixed-int4-litert",
                "Qwen3 0.6B Mixed INT4",
                "qwen3_0_6b_mixed_int4.litertlm",
                "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/qwen3_0_6b_mixed_int4.litertlm",
                "b1baab462f6be49d70eada79d715c2c52cd9ece0cad00bddf6a2c097d23498e9",
                BACKEND_LITERT,
                false,
                true,
                true,
                true,
                true,
                true,
                497_664_000L
            )
        );
    }

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, Future<?>> activeGenerations = new HashMap<>();
    private final Map<String, Conversation> activeConversations = new HashMap<>();
    private final Map<String, String> accumulatedConversationText = new HashMap<>();
    private final Map<String, String> lastEmittedText = new HashMap<>();
    private final Map<String, PendingToolResult> pendingToolResults = new ConcurrentHashMap<>();
    private Engine engine;
    private volatile boolean modelLoaded = false;
    private volatile String loadedModelId = "";
    private volatile String loadedBackend = "";
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;

    private final class BridgeOpenApiTool implements OpenApiTool {
        private final String name;
        private final String description;
        private final String properties;
        private final String required;

        BridgeOpenApiTool(String name, String description, String properties, String required) {
            this.name = name;
            this.description = description;
            this.properties = properties;
            this.required = required;
        }

        @Override
        public String getToolDescriptionJsonString() {
            return "{\"name\":" + JSONObject.quote(name)
                + ",\"description\":" + JSONObject.quote(description)
                + ",\"parameters\":{\"type\":\"object\",\"properties\":{" + properties + "},\"required\":" + required + "}}";
        }

        @Override
        public String execute(String paramsJsonString) {
            String callId = UUID.randomUUID().toString();
            PendingToolResult pending = new PendingToolResult();
            pendingToolResults.put(callId, pending);
            try {
                JSObject event = new JSObject()
                    .put("callId", callId)
                    .put("tool", name)
                    .put("args", new JSObject(paramsJsonString));
                notifyListeners("nativeToolCall", event);
                if (!pending.latch.await(30, TimeUnit.SECONDS)) {
                    return new JSONObject().put("ok", false).put("error", "Tool timed out.").toString();
                }
                return new JSONObject()
                    .put("ok", pending.ok)
                    .put(pending.ok ? "output" : "error", pending.output)
                    .toString();
            } catch (Exception ex) {
                return "{\"ok\":false,\"error\":" + JSONObject.quote(safeMessage(ex)) + "}";
            } finally {
                pendingToolResults.remove(callId);
            }
        }
    }

    private void scheduleConversationClose(Conversation conversation) {
        if (conversation == null) {
            return;
        }
        worker.submit(() -> safeCloseConversation(conversation));
    }

    private Conversation detachConversation(String conversationId) {
        synchronized (activeConversations) {
            return activeConversations.remove(conversationId);
        }
    }

    private void safeCloseConversation(Conversation conversation) {
        if (conversation == null) {
            return;
        }
        try {
            conversation.cancelProcess();
        } catch (Throwable ignored) {
        }
        try {
            conversation.close();
        } catch (Throwable ignored) {
        }
    }

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        Context context = getContext();
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
        activityManager.getMemoryInfo(memoryInfo);

        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = battery != null ? battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) : -1;
        int scale = battery != null ? battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1) : -1;
        int status = battery != null ? battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1) : -1;
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        double batteryPercent = level >= 0 && scale > 0 ? (level * 100.0) / scale : -1;

        File modelsDir = getModelsDir();
        StatFs statFs = new StatFs(modelsDir.getAbsolutePath());
        long freeBytes = statFs.getAvailableBytes();

        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("model", Build.MODEL);
        ret.put("device", Build.DEVICE);
        ret.put("deviceLabel", Build.MODEL);
        ret.put("androidVersion", Build.VERSION.RELEASE);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("totalRamBytes", memoryInfo.totalMem);
        ret.put("availableRamBytes", memoryInfo.availMem);
        ret.put("storageFreeBytes", freeBytes);
        ret.put("batteryPercent", batteryPercent);
        ret.put("charging", charging);
        ret.put("recommended", Build.MODEL != null && Build.MODEL.toUpperCase().contains("SM-S9"));
        ret.put("localTimeIso", ZonedDateTime.now().toString());
        ret.put("timezoneId", TimeZone.getDefault().getID());
        ret.put("contactsPermission", getPermissionState("contacts").toString().toLowerCase());
        String ownerName = readProfileDisplayName();
        if (ownerName != null && !ownerName.isEmpty()) {
            ret.put("ownerName", ownerName);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestContactsAccess(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            String ownerName = readProfileDisplayName();
            if (ownerName != null && !ownerName.isEmpty()) {
                result.put("ownerName", ownerName);
            }
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
    }

    @PluginMethod
    public void getOwnerProfile(PluginCall call) {
        JSObject result = new JSObject();
        result.put("contactsPermission", getPermissionState("contacts").toString().toLowerCase());
        String ownerName = readProfileDisplayName();
        if (ownerName != null && !ownerName.isEmpty()) {
            result.put("ownerName", ownerName);
        }
        call.resolve(result);
    }

    private void contactsPermissionCallback(PluginCall call) {
        PermissionState permissionState = getPermissionState("contacts");
        JSObject result = new JSObject();
        result.put("granted", permissionState == PermissionState.GRANTED);
        result.put("contactsPermission", permissionState.toString().toLowerCase());
        String ownerName = readProfileDisplayName();
        if (ownerName != null && !ownerName.isEmpty()) {
            result.put("ownerName", ownerName);
        }
        call.resolve(result);
    }

    private String readProfileDisplayName() {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            return "";
        }
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                ContactsContract.Profile.CONTENT_URI,
                new String[] { ContactsContract.Profile.DISPLAY_NAME_PRIMARY, ContactsContract.Profile.DISPLAY_NAME },
                null,
                null,
                null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int primaryIndex = cursor.getColumnIndex(ContactsContract.Profile.DISPLAY_NAME_PRIMARY);
                if (primaryIndex >= 0) {
                    String primary = cursor.getString(primaryIndex);
                    if (primary != null && !primary.trim().isEmpty()) {
                        return primary.trim();
                    }
                }
                int fallbackIndex = cursor.getColumnIndex(ContactsContract.Profile.DISPLAY_NAME);
                if (fallbackIndex >= 0) {
                    String fallback = cursor.getString(fallbackIndex);
                    if (fallback != null && !fallback.trim().isEmpty()) {
                        return fallback.trim();
                    }
                }
            }
        } catch (Throwable ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return "";
    }

    @PluginMethod
    public void listBackends(PluginCall call) {
        JSArray backends = new JSArray();
        backends.put(new JSObject()
            .put("id", BACKEND_LITERT)
            .put("label", "LiteRT-LM")
            .put("available", true)
            .put("supportsGpu", true)
            .put("supportsOffline", true)
            .put("experimental", false));
        backends.put(new JSObject()
            .put("id", BACKEND_MLC)
            .put("label", "MLC Android")
            .put("available", false)
            .put("supportsGpu", true)
            .put("supportsOffline", true)
            .put("experimental", true)
            .put("reason", "MLC fallback is not wired into this build yet."));
        call.resolve(new JSObject().put("backends", backends));
    }

    @PluginMethod
    public void listModels(PluginCall call) {
        JSArray models = new JSArray();
        for (ModelSpec spec : MODEL_SPECS.values()) {
            File modelFile = getModelFile(spec);
            models.put(modelToJson(spec, modelFile));
        }
        call.resolve(new JSObject().put("models", models));
    }

    @PluginMethod
    public void getRuntimeStatus(PluginCall call) {
        ModelSpec active = MODEL_SPECS.get(loadedModelId);
        JSObject status = new JSObject();
        status.put("loaded", modelLoaded);
        status.put("activeModelId", loadedModelId);
        status.put("activeBackendId", loadedBackend.isEmpty() ? null : BACKEND_LITERT);
        status.put("activeBackendLabel", loadedBackend.isEmpty() ? null : loadedBackend);
        status.put("supportsMultiTurn", active != null && active.supportsMultiTurn);
        status.put("supportsStreaming", active != null && active.supportsStreaming);
        status.put("supportsNativeTools", true);
        call.resolve(status);
    }

    @PluginMethod
    public void getLaunchArgs(PluginCall call) {
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        boolean runSoakTest = intent != null && intent.getBooleanExtra("runSoakTest", false);
        String backendId = intent != null ? intent.getStringExtra("backendId") : null;
        String modelId = intent != null ? intent.getStringExtra("modelId") : null;
        String scriptId = intent != null ? intent.getStringExtra("scriptId") : null;
        JSObject args = new JSObject();
        args.put("runSoakTest", runSoakTest);
        args.put("backendId", backendId);
        args.put("modelId", modelId);
        args.put("scriptId", scriptId);
        call.resolve(args);
    }

    @PluginMethod
    public void getLastSoakTestResult(PluginCall call) {
        File resultFile = new File(getDebugDir(), SOAK_RESULT_FILE);
        if (!resultFile.exists()) {
            call.resolve(new JSObject().put("exists", false));
            return;
        }
        try {
            byte[] bytes = new byte[(int) resultFile.length()];
            try (FileInputStream input = new FileInputStream(resultFile)) {
                int read = input.read(bytes);
                String raw = read > 0 ? new String(bytes, 0, read) : "";
                call.resolve(new JSObject().put("exists", true).put("rawJson", raw));
            }
        } catch (Exception ex) {
            call.reject("Unable to read soak result: " + safeMessage(ex));
        }
    }

    @PluginMethod
    public void saveSoakTestResult(PluginCall call) {
        String rawJson = call.getString("rawJson", "");
        if (rawJson.trim().isEmpty()) {
            call.reject("Result JSON cannot be empty.");
            return;
        }
        try {
            File resultFile = new File(getDebugDir(), SOAK_RESULT_FILE);
            try (FileOutputStream output = new FileOutputStream(resultFile, false)) {
                output.write(rawJson.getBytes());
            }
            call.resolve(new JSObject().put("saved", true).put("path", resultFile.getAbsolutePath()));
        } catch (Exception ex) {
            call.reject("Unable to save soak result: " + safeMessage(ex));
        }
    }

    @PluginMethod
    public void checkToolCapability(PluginCall call) {
        if (!modelLoaded || engine == null) {
            call.reject("No local model is loaded.");
            return;
        }
        worker.submit(() -> {
            AtomicBoolean invoked = new AtomicBoolean(false);
            OpenApiTool probe = new OpenApiTool() {
                @Override
                public String getToolDescriptionJsonString() {
                    return "{\"name\":\"capability_probe\",\"description\":\"Required capability test.\",\"parameters\":{\"type\":\"object\",\"properties\":{},\"required\":[]}}";
                }

                @Override
                public String execute(String ignored) {
                    invoked.set(true);
                    return "{\"ok\":true}";
                }
            };
            try (Conversation conversation = createConversation(null, Collections.singletonList(ToolKt.tool(probe)))) {
                conversation.sendMessage("Call capability_probe now, then answer only ready.", new HashMap<>());
                call.resolve(new JSObject().put("capable", invoked.get()).put("detail", invoked.get() ? "Native structured tool call succeeded." : "Model did not produce a structured tool call."));
            } catch (Throwable throwable) {
                call.resolve(new JSObject().put("capable", false).put("detail", safeMessage(throwable)));
            }
        });
    }

    @PluginMethod
    public void resolveToolCall(PluginCall call) {
        PendingToolResult pending = pendingToolResults.get(call.getString("callId", ""));
        if (pending == null) {
            call.resolve(new JSObject().put("resolved", false));
            return;
        }
        pending.ok = Boolean.TRUE.equals(call.getBoolean("ok", false));
        pending.output = call.getString("output", "");
        pending.latch.countDown();
        call.resolve(new JSObject().put("resolved", true));
    }

    @PluginMethod
    public void startVoiceInput(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginVoiceInput(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission was denied.");
            return;
        }
        beginVoiceInput(call);
    }

    private void beginVoiceInput(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("Speech recognition is unavailable on this device.");
                return;
            }
            if (speechRecognizer != null) speechRecognizer.destroy();
            speechRecognizer = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())
                ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext())
                : SpeechRecognizer.createSpeechRecognizer(getContext());
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onPartialResults(Bundle results) { emitVoiceResult(results, false); }
                @Override public void onResults(Bundle results) { emitVoiceResult(results, true); }
                @Override public void onError(int error) {
                    notifyListeners("voiceResult", new JSObject().put("final", true).put("error", "Speech recognition failed (" + error + ")."));
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            speechRecognizer.startListening(intent);
            call.resolve(new JSObject().put("started", true));
        });
    }

    private void emitVoiceResult(Bundle results, boolean complete) {
        ArrayList<String> candidates = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String text = candidates == null || candidates.isEmpty() ? "" : candidates.get(0);
        notifyListeners("voiceResult", new JSObject().put("text", text).put("final", complete));
    }

    @PluginMethod
    public void stopVoiceInput(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) speechRecognizer.stopListening();
            call.resolve(new JSObject().put("stopped", true));
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("Speech text is required.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (textToSpeech == null) {
                textToSpeech = new TextToSpeech(getContext(), status -> {
                    if (status == TextToSpeech.SUCCESS) textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "companion-chat");
                });
            } else {
                textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "companion-chat");
            }
            call.resolve(new JSObject().put("started", true));
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (textToSpeech != null) textToSpeech.stop();
        call.resolve(new JSObject().put("stopped", true));
    }

    @PluginMethod
    public void saveSecureText(PluginCall call) {
        try {
            String key = call.getString("key", "");
            String value = call.getString("value", "");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecureKey());
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
            getContext().getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE).edit().putString(key, encoded).apply();
            call.resolve(new JSObject().put("saved", true));
        } catch (Throwable throwable) {
            call.reject("Unable to encrypt chat data: " + safeMessage(throwable));
        }
    }

    @PluginMethod
    public void loadSecureText(PluginCall call) {
        try {
            String encoded = getContext().getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE).getString(call.getString("key", ""), null);
            if (encoded == null) {
                call.resolve(new JSObject().put("exists", false));
                return;
            }
            String[] parts = encoded.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecureKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            String value = new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("exists", true).put("value", value));
        } catch (Throwable throwable) {
            call.reject("Unable to decrypt chat data: " + safeMessage(throwable));
        }
    }

    @PluginMethod
    public void deleteSecureText(PluginCall call) {
        getContext().getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE).edit().remove(call.getString("key", "")).apply();
        call.resolve(new JSObject().put("deleted", true));
    }

    private SecretKey getOrCreateSecureKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(SECURE_CHAT_KEY_ALIAS)) return (SecretKey) store.getKey(SECURE_CHAT_KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            SECURE_CHAT_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    @PluginMethod
    public void performDeviceAction(PluginCall call) {
        if (!Boolean.TRUE.equals(call.getBoolean("confirmed", false))) {
            call.reject("User confirmation is required.");
            return;
        }
        String action = call.getString("action", "");
        JSObject payload = call.getObject("payload", new JSObject());
        Intent intent;
        switch (action) {
            case "set_alarm":
                intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, payload.optInt("hour", 9))
                    .putExtra(AlarmClock.EXTRA_MINUTES, payload.optInt("minute", 0))
                    .putExtra(AlarmClock.EXTRA_MESSAGE, payload.optString("label", "TheOrc Companion"));
                break;
            case "draft_message":
                intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(payload.getString("recipient", ""))))
                    .putExtra("sms_body", payload.getString("body", ""));
                break;
            case "create_calendar":
                intent = new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.Events.TITLE, payload.getString("title", "TheOrc Companion event"))
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, payload.optLong("startTimeMs", System.currentTimeMillis()))
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, payload.optLong("endTimeMs", System.currentTimeMillis() + 3_600_000));
                break;
            case "open_app":
                intent = getContext().getPackageManager().getLaunchIntentForPackage(payload.getString("packageName", ""));
                if (intent == null) {
                    call.reject("That app is not installed or cannot be opened.");
                    return;
                }
                break;
            default:
                call.reject("Unsupported device action: " + action);
                return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("completed", true).put("detail", "Opened Android confirmation UI for " + action + "."));
        } catch (Throwable throwable) {
            call.reject("Android could not open that action: " + safeMessage(throwable));
        }
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String modelId = call.getString("modelId", DEFAULT_MODEL_ID);
        ModelSpec spec = MODEL_SPECS.get(modelId);
        if (spec == null) {
            call.reject("Unknown model id: " + modelId);
            return;
        }
        if (!BACKEND_LITERT.equals(spec.backendId)) {
            call.reject("This model requires a backend that is not available in this build.");
            return;
        }

        call.resolve(new JSObject()
            .put("started", true)
            .put("modelId", modelId)
            .put("backendId", spec.backendId));

        worker.submit(() -> {
            notifyLoadState(spec, "downloading", null, true, null);
            try {
                File partialFile = new File(getModelsDir(), spec.filename + ".part");
                File finalFile = getModelFile(spec);
                if (finalFile.exists()) {
                    verifyChecksum(spec, finalFile);
                    emitDownloadProgress(spec, finalFile.length(), finalFile.length());
                    notifyLoadState(spec, "downloaded", null, true, null);
                    return;
                }

                if (partialFile.exists() && partialFile.length() >= spec.downloadSizeBytes) {
                    finalizeDownloadedModel(spec, partialFile, finalFile);
                    return;
                }

                long existingBytes = partialFile.exists() ? partialFile.length() : 0;
                HttpURLConnection connection = (HttpURLConnection) new URL(spec.url).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                if (existingBytes > 0) {
                    connection.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                long contentLength = connection.getContentLengthLong();
                long totalBytes = contentLength > 0 ? contentLength + existingBytes : spec.downloadSizeBytes;

                try (InputStream input = connection.getInputStream();
                     RandomAccessFile output = new RandomAccessFile(partialFile, "rw")) {
                    output.seek(existingBytes);
                    byte[] buffer = new byte[1024 * 64];
                    long downloaded = existingBytes;
                    long lastEmit = 0;
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        downloaded += read;
                        if (downloaded - lastEmit > 1024 * 1024 || downloaded == totalBytes) {
                            lastEmit = downloaded;
                            emitDownloadProgress(spec, downloaded, totalBytes);
                        }
                    }
                }

                finalizeDownloadedModel(spec, partialFile, finalFile);
            } catch (Exception ex) {
                notifyRuntimeError(null, spec, safeMessage(ex), true, "download_failed");
            }
        });
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelId = call.getString("modelId", DEFAULT_MODEL_ID);
        String backendId = call.getString("backendId", null);
        ModelSpec spec = MODEL_SPECS.get(modelId);
        if (spec == null) {
            call.reject("Unknown model id: " + modelId);
            return;
        }
        if (backendId != null && !backendId.equals(spec.backendId)) {
            call.reject("Requested backend does not match the selected model.");
            return;
        }
        if (!BACKEND_LITERT.equals(spec.backendId)) {
            call.reject("This backend is not available in the current build.");
            return;
        }

        File modelFile = getModelFile(spec);
        if (!modelFile.exists()) {
            call.reject("Model is not downloaded.");
            return;
        }

        worker.submit(() -> {
            try {
                notifyLoadState(spec, "loading", null, true, null);
                closeRuntime();

                if (spec.experimental) {
                    try {
                        engine = createInitializedEngine(modelFile, new Backend.CPU(Math.max(2, Runtime.getRuntime().availableProcessors() / 2)));
                        loadedBackend = "CPU";
                    } catch (Throwable cpuError) {
                        notifyLoadState(spec, "gpu_fallback", safeMessage(cpuError), true, "cpu_init_failed");
                        engine = createInitializedEngine(modelFile, new Backend.GPU());
                        loadedBackend = "GPU";
                    }
                } else {
                    try {
                        engine = createInitializedEngine(modelFile, new Backend.GPU());
                        loadedBackend = "GPU";
                    } catch (Throwable gpuError) {
                        notifyLoadState(spec, "gpu_fallback", safeMessage(gpuError), true, "gpu_init_failed");
                        engine = createInitializedEngine(modelFile, new Backend.CPU(Math.max(2, Runtime.getRuntime().availableProcessors() / 2)));
                        loadedBackend = "CPU";
                    }
                }

                modelLoaded = true;
                loadedModelId = modelId;
                notifyLoadState(spec, "loaded", null, true, null);
            } catch (Exception ex) {
                closeRuntime();
                notifyRuntimeError(null, spec, "LiteRT-LM runtime was not available: " + safeMessage(ex), false, "load_failed");
            }
        });

        call.resolve(new JSObject()
            .put("started", true)
            .put("modelId", modelId)
            .put("backendId", spec.backendId));
    }

    @PluginMethod
    public void startGeneration(PluginCall call) {
        beginGeneration(call);
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        beginGeneration(call);
    }

    @PluginMethod
    public void cancelGeneration(PluginCall call) {
        String conversationId = call.getString("conversationId", "default");
        Future<?> active;
        synchronized (activeGenerations) {
            active = activeGenerations.remove(conversationId);
        }
        if (active != null) {
            active.cancel(true);
        }
        closeConversation(conversationId);
        synchronized (lastEmittedText) {
            lastEmittedText.remove(conversationId);
        }
        JSObject event = new JSObject()
            .put("conversationId", conversationId)
            .put("backendId", BACKEND_LITERT)
            .put("modelId", loadedModelId)
            .put("cancelled", true);
        notifyListeners("generationCancelled", event);
        notifyListeners("generationDone", event);
        call.resolve(new JSObject().put("cancelled", true).put("conversationId", conversationId));
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        worker.submit(this::closeRuntime);
        call.resolve(new JSObject().put("unloaded", true));
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String modelId = call.getString("modelId", DEFAULT_MODEL_ID);
        ModelSpec spec = MODEL_SPECS.get(modelId);
        if (spec == null) {
            call.reject("Unknown model id: " + modelId);
            return;
        }
        File modelFile = getModelFile(spec);
        boolean deleted = !modelFile.exists() || modelFile.delete();
        File partialFile = new File(getModelsDir(), spec.filename + ".part");
        if (partialFile.exists()) {
            partialFile.delete();
        }
        if (modelId.equals(loadedModelId)) {
            worker.submit(this::closeRuntime);
        }
        call.resolve(new JSObject().put("deleted", deleted).put("modelId", modelId));
    }

    @Override
    protected void handleOnDestroy() {
        closeRuntime();
        if (speechRecognizer != null) speechRecognizer.destroy();
        if (textToSpeech != null) textToSpeech.shutdown();
        for (PendingToolResult pending : pendingToolResults.values()) pending.latch.countDown();
        pendingToolResults.clear();
        worker.shutdownNow();
        super.handleOnDestroy();
    }

    private void beginGeneration(PluginCall call) {
        String conversationId = call.getString("conversationId", "default");
        String message = call.getString("message", "");
        String modelId = call.getString("modelId", loadedModelId.isEmpty() ? DEFAULT_MODEL_ID : loadedModelId);
        String backendId = call.getString("backendId", BACKEND_LITERT);
        ModelSpec spec = MODEL_SPECS.get(modelId);

        if (spec == null) {
            call.reject("Unknown model id: " + modelId);
            return;
        }
        if (!modelLoaded || engine == null) {
            call.reject("No local model is loaded.");
            return;
        }
        if (!modelId.equals(loadedModelId)) {
            call.reject("The requested model is not the currently loaded model.");
            return;
        }
        if (!spec.backendId.equals(backendId)) {
            call.reject("The requested backend does not match the loaded model.");
            return;
        }
        if (message.trim().isEmpty()) {
            call.reject("Message cannot be empty.");
            return;
        }

        JSArray transcript = call.getArray("transcript");
        JSObject options = call.getObject("options", new JSObject());
        boolean nativeTools = options.optBoolean("nativeTools", false);

        call.resolve(new JSObject()
            .put("started", true)
            .put("conversationId", conversationId)
            .put("modelId", modelId)
            .put("backendId", backendId));

        Future<?> future = worker.submit(() -> {
            try {
                closeConversation(conversationId);
                synchronized (accumulatedConversationText) {
                    accumulatedConversationText.remove(conversationId);
                }
                synchronized (lastEmittedText) {
                    lastEmittedText.put(conversationId, "");
                }
                Conversation conversation = createConversation(transcript, nativeTools ? buildToolProviders() : new ArrayList<>());
                synchronized (activeConversations) {
                    activeConversations.put(conversationId, conversation);
                }

                conversation.sendMessageAsync(message, new MessageCallback() {
                    @Override
                    public void onMessage(Message response) {
                        emitMessageDelta(conversationId, spec, extractText(response));
                    }

                    @Override
                    public void onDone() {
                        synchronized (activeGenerations) {
                            activeGenerations.remove(conversationId);
                        }
                        Conversation finishedConversation = detachConversation(conversationId);
                        synchronized (accumulatedConversationText) {
                            accumulatedConversationText.remove(conversationId);
                        }
                        synchronized (lastEmittedText) {
                            lastEmittedText.remove(conversationId);
                        }
                        notifyListeners("generationDone", new JSObject()
                            .put("conversationId", conversationId)
                            .put("backendId", spec.backendId)
                            .put("modelId", spec.id));
                        scheduleConversationClose(finishedConversation);
                    }

                    @Override
                    public void onError(Throwable throwable) {
                        synchronized (activeGenerations) {
                            activeGenerations.remove(conversationId);
                        }
                        Conversation failedConversation = detachConversation(conversationId);
                        synchronized (accumulatedConversationText) {
                            accumulatedConversationText.remove(conversationId);
                        }
                        synchronized (lastEmittedText) {
                            lastEmittedText.remove(conversationId);
                        }
                        notifyRuntimeError(conversationId, spec, safeMessage(throwable), true, "generation_failed");
                        scheduleConversationClose(failedConversation);
                    }
                }, new HashMap<>());
            } catch (Throwable throwable) {
                synchronized (activeGenerations) {
                    activeGenerations.remove(conversationId);
                }
                closeConversation(conversationId);
                synchronized (accumulatedConversationText) {
                    accumulatedConversationText.remove(conversationId);
                }
                synchronized (lastEmittedText) {
                    lastEmittedText.remove(conversationId);
                }
                notifyRuntimeError(conversationId, spec, safeMessage(throwable), true, "generation_failed");
            }
        });

        synchronized (activeGenerations) {
            activeGenerations.put(conversationId, future);
        }
    }

    private Engine createInitializedEngine(File modelFile, Backend backend) {
        File cacheDir = new File(getContext().getCacheDir(), "litertlm");
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }
        EngineConfig config = new EngineConfig(
            modelFile.getAbsolutePath(),
            backend,
            null,
            null,
            512,
            null,
            cacheDir.getAbsolutePath()
        );
        Engine nextEngine = new Engine(config);
        nextEngine.initialize();
        return nextEngine;
    }

    private Conversation createConversation(JSArray transcript) throws Exception {
        return createConversation(transcript, new ArrayList<>());
    }

    private Conversation createConversation(JSArray transcript, List<ToolProvider> tools) throws Exception {
        List<Message> initialMessages = buildInitialMessages(transcript);
        SamplerConfig samplerConfig = new SamplerConfig(40, 0.9, 0.7, 0);
        String systemPrompt = "You are TheOrc Companion running fully on this Android device: "
            + Build.MANUFACTURER + " " + Build.MODEL
            + ". Keep continuity across the supplied chat transcript and respond like a polished mobile chat assistant. "
            + "Use natural conversational wording, short paragraphs, and plain text by default. "
            + "Only use lists when they genuinely help. Do not use markdown headings, bold markers, or decorative formatting unless the user explicitly asks for formatting. "
            + "Avoid repetition, filler, and self-echoing loops. If the answer is simple, answer simply. "
            + "Be concise, practical, calm, and offline-first. Answer with final user-facing text only. "
            + "Do not reveal chain-of-thought, scratchpad, analysis, or <think> blocks. /no_think";
        ConversationConfig config = new ConversationConfig(
            Contents.Companion.of(systemPrompt),
            initialMessages,
            tools,
            samplerConfig,
            true
        );
        return engine.createConversation(config);
    }

    private List<ToolProvider> buildToolProviders() {
        List<ToolProvider> tools = new ArrayList<>();
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "web_search",
            "Search the public web for current information.",
            "\"query\":{\"type\":\"string\"},\"maxResults\":{\"type\":\"number\"}",
            "[\"query\"]"
        )));
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "fetch_page",
            "Read a public web page returned by search.",
            "\"url\":{\"type\":\"string\"}",
            "[\"url\"]"
        )));
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "get_device_profile",
            "Read current phone time, battery, and device information.",
            "",
            "[]"
        )));
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "get_hive_status",
            "Probe the selected HIVE route.",
            "\"targetHost\":{\"type\":\"string\"}",
            "[]"
        )));
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "queue_scrape_url",
            "Queue a URL scraping job on the selected HIVE route.",
            "\"url\":{\"type\":\"string\"}",
            "[\"url\"]"
        )));
        tools.add(ToolKt.tool(new BridgeOpenApiTool(
            "device_action",
            "Request a user-confirmed Android action: set_alarm, draft_message, create_calendar, or open_app.",
            "\"action\":{\"type\":\"string\"},\"payload\":{\"type\":\"object\"}",
            "[\"action\"]"
        )));
        return tools;
    }

    private List<Message> buildInitialMessages(JSArray transcript) throws Exception {
        List<Message> initialMessages = new ArrayList<>();
        if (transcript == null) {
            return initialMessages;
        }
        for (int i = 0; i < transcript.length(); i++) {
            Object entry = transcript.get(i);
            if (!(entry instanceof JSONObject)) {
                continue;
            }
            JSONObject json = (JSONObject) entry;
            String role = json.optString("role", "user");
            String text = json.optString("text", "").trim();
            if (text.isEmpty()) {
                continue;
            }
            Role mappedRole = mapRole(role);
            if (mappedRole == null) {
                continue;
            }
            initialMessages.add(new Message(
                mappedRole,
                Contents.Companion.of(text),
                new ArrayList<>(),
                new HashMap<>()
            ));
        }
        return initialMessages;
    }

    private Role mapRole(String role) {
        if ("assistant".equals(role)) return Role.MODEL;
        if ("system".equals(role)) return Role.SYSTEM;
        if ("user".equals(role)) return Role.USER;
        return null;
    }

    private void emitMessageDelta(String conversationId, ModelSpec spec, String fullText) {
        if (fullText == null || fullText.isEmpty()) return;
        String accumulatedText = accumulateConversationText(conversationId, fullText);
        String visibleText = normalizeVisibleText(stripThinking(accumulatedText));
        String delta;
        synchronized (lastEmittedText) {
            String previous = lastEmittedText.get(conversationId);
            if (previous != null && visibleText.startsWith(previous)) {
                delta = visibleText.substring(previous.length());
            } else {
                delta = visibleText;
            }
            lastEmittedText.put(conversationId, visibleText);
        }
        if (!delta.isEmpty()) {
            notifyListeners("token", new JSObject()
                .put("conversationId", conversationId)
                .put("backendId", spec.backendId)
                .put("modelId", spec.id)
                .put("token", delta));
        }
    }

    private String accumulateConversationText(String conversationId, String incomingText) {
        synchronized (accumulatedConversationText) {
            String current = accumulatedConversationText.get(conversationId);
            if (current == null || current.isEmpty()) {
                accumulatedConversationText.put(conversationId, incomingText);
                return incomingText;
            }

            String compactCurrent = collapseWhitespace(current);
            String compactIncoming = collapseWhitespace(incomingText);

            if (compactIncoming.isEmpty() || compactIncoming.equals(compactCurrent)) {
                return current;
            }

            if (compactCurrent.endsWith(compactIncoming)) {
                return current;
            }

            if (compactIncoming.startsWith(compactCurrent)) {
                String suffix = compactIncoming.substring(compactCurrent.length());
                String stitched = current + suffix;
                accumulatedConversationText.put(conversationId, stitched);
                return stitched;
            }

            String stitched = current + incomingText;
            accumulatedConversationText.put(conversationId, stitched);
            return stitched;
        }
    }

    private String collapseWhitespace(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return value.replaceAll("\\s+", "");
    }

    private String stripThinking(String text) {
        String visible = text;
        while (true) {
            int open = visible.indexOf("<think>");
            int close = visible.indexOf("</think>");
            if (open >= 0 && (close < 0 || open < close)) {
                if (close < 0) {
                    visible = visible.substring(0, open);
                    break;
                }
                visible = visible.substring(0, open) + visible.substring(close + 8);
                continue;
            }
            if (close < 0) {
                break;
            }
            visible = visible.substring(close + 8);
        }
        return visible.replaceFirst("^\\s+", "");
    }

    private String normalizeVisibleText(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }

        String normalized = stripMarkdownFormatting(text)
            .replace('\u2581', ' ')
            .replace("\u0120", " ")
            .replace('\u00A0', ' ');

        normalized = normalized
            .replaceAll("\\s+([,.;:!?])", "$1")
            .replaceAll("([,;:!?])(\\p{L})", "$1 $2")
            .replaceAll("(\\.)(\\p{L})", "$1 $2")
            .replaceAll("(\\*\\*[^*]+\\*\\*)(\\p{L})", "$1 $2")
            .replaceAll("(\\*[^*]+\\*)(\\p{L})", "$1 $2")
            .replaceAll("(\\p{L})(\\*\\*)", "$1 $2")
            .replaceAll("(\\p{L})(\\*)", "$1 $2")
            .replaceAll("([\"”])([A-Za-z0-9])", "$1 $2")
            .replaceAll("([a-z])([A-Z])", "$1 $2")
            .replaceAll("([A-Z]{2,})([A-Z][a-z])", "$1 $2")
            .replaceAll("\\s{2,}", " ")
            .trim();

        return collapseRepeatedSegments(normalized);
    }

    private String stripMarkdownFormatting(String text) {
        return text
            .replace("```", "")
            .replace("**", "")
            .replace("__", "")
            .replace("##", "")
            .replace("*", "")
            .replace("`", "");
    }

    private String collapseRepeatedSegments(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }

        Matcher matcher = Pattern.compile("[^.!?]+[.!?]?").matcher(text);
        List<String> segments = new ArrayList<>();
        while (matcher.find()) {
            String segment = matcher.group().trim();
            if (!segment.isEmpty()) {
                segments.add(segment);
            }
        }

        if (segments.isEmpty()) {
            return text;
        }

        List<String> collapsed = new ArrayList<>();
        String previousNormalized = null;
        int runLength = 0;

        for (String segment : segments) {
            String currentNormalized = segment.toLowerCase().replaceAll("\\s+", " ").trim();
            if (currentNormalized.equals(previousNormalized)) {
                runLength += 1;
            } else {
                previousNormalized = currentNormalized;
                runLength = 1;
            }

            if (runLength <= 2) {
                collapsed.add(segment);
            }
        }

        if (collapsed.isEmpty()) {
            return text;
        }

        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < collapsed.size(); index += 1) {
            String segment = collapsed.get(index);
            if (builder.length() > 0) {
                builder.append(' ');
            }
            builder.append(segment.trim());
        }
        return builder.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private String extractText(Message message) {
        if (message == null || message.getContents() == null) return "";
        StringBuilder builder = new StringBuilder();
        List<Content> contents = message.getContents().getContents();
        for (Content content : contents) {
            if (content instanceof Content.Text) {
                appendTextFragment(builder, ((Content.Text) content).getText());
            }
        }
        return builder.toString();
    }

    private void appendTextFragment(StringBuilder builder, String fragment) {
        if (fragment == null || fragment.isEmpty()) {
            return;
        }

        if (builder.length() == 0) {
            builder.append(fragment);
            return;
        }

        char previousChar = builder.charAt(builder.length() - 1);
        char nextChar = fragment.charAt(0);

        if (shouldInsertSpace(previousChar, nextChar, fragment)) {
            builder.append(' ');
        }

        builder.append(fragment);
    }

    private boolean shouldInsertSpace(char previousChar, char nextChar, String fragment) {
        if (Character.isWhitespace(previousChar) || Character.isWhitespace(nextChar)) {
            return false;
        }

        if (isClosingPunctuation(nextChar) || nextChar == '\'' || nextChar == '’') {
            return false;
        }

        if (isOpeningPunctuation(previousChar) || previousChar == '/' || previousChar == '-') {
            return false;
        }

        if (previousChar == '\'' || previousChar == '’') {
            return false;
        }

        if (Character.isLetterOrDigit(previousChar) && Character.isLetterOrDigit(nextChar)) {
            return true;
        }

        if (Character.isLetterOrDigit(previousChar) && isOpeningPunctuation(nextChar)) {
            return true;
        }

        if (isClosingPunctuation(previousChar) && Character.isLetterOrDigit(nextChar)) {
            return true;
        }

        return fragment.length() > 1 && Character.isLetterOrDigit(nextChar);
    }

    private boolean isClosingPunctuation(char value) {
        return value == ',' || value == '.' || value == ';' || value == ':' || value == '!' || value == '?' || value == ')' || value == ']' || value == '}';
    }

    private boolean isOpeningPunctuation(char value) {
        return value == '(' || value == '[' || value == '{' || value == '"' || value == '“';
    }

    private void notifyLoadState(ModelSpec spec, String phase, String message, boolean recoverable, String errorCode) {
        JSObject event = new JSObject()
            .put("modelId", spec.id)
            .put("backendId", spec.backendId)
            .put("phase", phase)
            .put("state", phase)
            .put("backend", loadedBackend)
            .put("recoverable", recoverable)
            .put("errorCode", errorCode);
        if (message != null && !message.isEmpty()) {
            event.put("message", message);
        }
        notifyListeners("loadState", event);
    }

    private void notifyRuntimeError(String conversationId, ModelSpec spec, String message, boolean recoverable, String errorCode) {
        JSObject event = new JSObject()
            .put("message", message)
            .put("recoverable", recoverable)
            .put("errorCode", errorCode);
        if (conversationId != null) {
            event.put("conversationId", conversationId);
        }
        if (spec != null) {
            event.put("modelId", spec.id);
            event.put("backendId", spec.backendId);
        }
        notifyListeners("runtimeError", event);
    }

    private void closeRuntime() {
        synchronized (activeGenerations) {
            for (Future<?> future : activeGenerations.values()) {
                future.cancel(true);
            }
            activeGenerations.clear();
        }
        synchronized (activeConversations) {
            for (Conversation conversation : activeConversations.values()) {
                try {
                    conversation.close();
                } catch (Throwable ignored) {
                }
            }
            activeConversations.clear();
        }
        synchronized (lastEmittedText) {
            lastEmittedText.clear();
        }
        if (engine != null) {
            try {
                engine.close();
            } catch (Throwable ignored) {
            }
        }
        engine = null;
        modelLoaded = false;
        loadedModelId = "";
        loadedBackend = "";
    }

    private void closeConversation(String conversationId) {
        safeCloseConversation(detachConversation(conversationId));
    }

    private JSObject modelToJson(ModelSpec spec, File modelFile) {
        return new JSObject()
            .put("id", spec.id)
            .put("name", spec.name)
            .put("filename", spec.filename)
            .put("url", spec.url)
            .put("sha256", spec.sha256)
            .put("recommended", spec.recommended)
            .put("downloaded", modelFile.exists())
            .put("loaded", modelLoaded && spec.id.equals(loadedModelId))
            .put("backend", modelLoaded && spec.id.equals(loadedModelId) ? loadedBackend : "")
            .put("backendId", spec.backendId)
            .put("supportsMultiTurn", spec.supportsMultiTurn)
            .put("supportsStreaming", spec.supportsStreaming)
            .put("supportsGpu", spec.supportsGpu)
            .put("supportsOffline", spec.supportsOffline)
            .put("experimental", spec.experimental)
            .put("downloadSizeBytes", spec.downloadSizeBytes)
            .put("bytes", modelFile.exists() ? modelFile.length() : spec.downloadSizeBytes)
            .put("path", modelFile.getAbsolutePath());
    }

    private File getModelsDir() {
        File modelsDir = new File(getContext().getFilesDir(), "models");
        if (!modelsDir.exists()) {
            modelsDir.mkdirs();
        }
        return modelsDir;
    }

    private File getDebugDir() {
        File debugDir = new File(getContext().getFilesDir(), "debug");
        if (!debugDir.exists()) {
            debugDir.mkdirs();
        }
        return debugDir;
    }

    private File getModelFile(ModelSpec spec) {
        return new File(getModelsDir(), spec.filename);
    }

    private void emitDownloadProgress(ModelSpec spec, long downloadedBytes, long totalBytes) {
        JSObject progress = new JSObject();
        progress.put("modelId", spec.id);
        progress.put("backendId", spec.backendId);
        progress.put("downloadedBytes", downloadedBytes);
        progress.put("totalBytes", totalBytes);
        progress.put("progress", totalBytes > 0 ? downloadedBytes / (double) totalBytes : 0);
        notifyListeners("downloadProgress", progress);
    }

    private void finalizeDownloadedModel(ModelSpec spec, File partialFile, File finalFile) throws Exception {
        try {
            verifyChecksum(spec, partialFile);
        } catch (Exception ex) {
            if (!partialFile.delete()) {
                notifyRuntimeError(null, spec, "Downloaded model failed checksum and could not be removed.", false, "checksum_mismatch");
            }
            throw ex;
        }

        if (finalFile.exists() && !finalFile.delete()) {
            throw new IllegalStateException("Unable to replace old model file.");
        }
        if (!partialFile.renameTo(finalFile)) {
            throw new IllegalStateException("Unable to finalize model download.");
        }

        emitDownloadProgress(spec, finalFile.length(), finalFile.length());
        notifyLoadState(spec, "downloaded", null, true, null);
    }

    private void verifyChecksum(ModelSpec spec, File file) throws Exception {
        if (spec.sha256 == null || spec.sha256.isEmpty()) return;
        String actual = sha256(file);
        if (!spec.sha256.equalsIgnoreCase(actual)) {
            throw new IllegalStateException("Model checksum mismatch.");
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[1024 * 64];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder builder = new StringBuilder();
        for (byte b : hash) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }

    private String safeMessage(Throwable throwable) {
        if (throwable == null) return "Unknown native error.";
        String message = throwable.getMessage();
        if (message == null || message.isEmpty()) {
            return throwable.getClass().getSimpleName();
        }
        return message.replaceAll("https?://\\S+", "[redacted-url]");
    }
}
