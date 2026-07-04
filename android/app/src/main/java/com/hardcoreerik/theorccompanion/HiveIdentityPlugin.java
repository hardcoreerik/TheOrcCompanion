package com.hardcoreerik.theorccompanion;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(name = "HiveIdentity")
public class HiveIdentityPlugin extends Plugin {
    private static final String STORE = "hive-identity";
    private static final String SIGNING = "hive-signing-p256";
    private static final String EXCHANGE = "hive-exchange-p256";
    private static final String STORAGE = "hive-peer-storage-aes";
    private static final byte[] CONTROL_INFO = "hive-control-v1".getBytes(StandardCharsets.UTF_8);
    private final SecureRandom random = new SecureRandom();

    @PluginMethod
    public void getIdentity(PluginCall call) {
        try { call.resolve(identityJson()); } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void createPairingRequest(PluginCall call) {
        try {
            JSObject identity = identityJson();
            String sessionId = UUID.randomUUID().toString();
            String nodeId = identity.getString("nodeId");
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(privateKey(SIGNING));
            signer.update((sessionId + nodeId).getBytes(StandardCharsets.UTF_8));

            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            result.put("initiatorNodeId", nodeId);
            result.put("initiatorName", call.getString("name", "TheOrc Companion"));
            result.put("initiatorFingerprint", ""); // TheOrc derives this from the verified public key.
            result.put("signingPublicKeyDer", identity.getString("signingPublicKeyDer"));
            result.put("exchangePublicKeyDer", identity.getString("exchangePublicKeyDer"));
            result.put("proofSignature", b64(derEcdsaToP1363(signer.sign())));
            result.put("isMobileClient", true);
            result.put("vramMb", call.getInt("vramMb", 0));
            result.put("suggestedRole", "Worker");
            result.put("hiveId", preferences().getString("hiveId", ""));
            call.resolve(result);
        } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void trustPeer(PluginCall call) {
        try {
            String nodeId = required(call, "nodeId");
            byte[] signingDer = Base64.decode(required(call, "signingPublicKeyDer"), Base64.DEFAULT);
            if (!nodeId.equalsIgnoreCase(hex(sha256(signingDer)))) throw new SecurityException("Peer NodeId does not match signing key.");
            byte[] exchangeDer = Base64.decode(required(call, "exchangePublicKeyDer"), Base64.DEFAULT);
            PublicKey peerKey = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(exchangeDer));
            KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
            agreement.init(privateKey(EXCHANGE));
            agreement.doPhase(peerKey, true);
            // .NET ECDiffieHellman.DeriveKeyMaterial applies SHA-256 to the raw agreement
            // before HiveIdentity's HKDF step; mirror that exact wire behavior on Android.
            byte[] secret = hkdf(sha256(agreement.generateSecret()), xorNodeIds(identityJson().getString("nodeId"), nodeId), "hive-session-v1".getBytes(StandardCharsets.UTF_8));
            saveSecret(nodeId, secret);
            String hiveId = call.getString("hiveId", "");
            if (!hiveId.isEmpty()) preferences().edit().putString("hiveId", hiveId).apply();
            call.resolve(new JSObject().put("nodeId", nodeId));
        } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void forgetPeer(PluginCall call) {
        preferences().edit().remove("peer:" + call.getString("nodeId", "")).apply();
        call.resolve();
    }

    @PluginMethod
    public void signRequest(PluginCall call) {
        try {
            String nodeId = required(call, "nodeId");
            String method = required(call, "method").toUpperCase();
            String path = required(call, "path");
            String body = call.getString("body", "");
            byte[] nonceBytes = new byte[16]; random.nextBytes(nonceBytes);
            String nonce = hex(nonceBytes);
            String timestamp = Long.toString(System.currentTimeMillis());
            String canonical = method + "\n" + path.replace("\r", "%0D").replace("\n", "%0A") + "\n" + nonce + "\n" + timestamp + "\n" + hex(sha256(body.getBytes(StandardCharsets.UTF_8)));
            String signature = hex(hmac(loadSecret(nodeId), canonical.getBytes(StandardCharsets.UTF_8)));
            JSObject result = new JSObject();
            result.put("X-Hive-Node-Id", identityJson().getString("nodeId"));
            result.put("X-Hive-Nonce", nonce);
            result.put("X-Hive-Ts", timestamp);
            result.put("X-Hive-Sig", signature);
            call.resolve(result);
        } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void encryptControl(PluginCall call) {
        try {
            byte[] key = controlKey(required(call, "nodeId"));
            byte[] nonce = new byte[12]; random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(CONTROL_INFO);
            byte[] combined = cipher.doFinal(required(call, "json").getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = java.util.Arrays.copyOf(combined, combined.length - 16);
            byte[] tag = java.util.Arrays.copyOfRange(combined, combined.length - 16, combined.length);
            call.resolve(new JSObject().put("nonce", b64(nonce)).put("ciphertext", b64(ciphertext)).put("tag", b64(tag)));
        } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void decryptControl(PluginCall call) {
        try {
            byte[] nonce = Base64.decode(required(call, "nonce"), Base64.DEFAULT);
            byte[] ciphertext = Base64.decode(required(call, "ciphertext"), Base64.DEFAULT);
            byte[] tag = Base64.decode(required(call, "tag"), Base64.DEFAULT);
            byte[] combined = new byte[ciphertext.length + tag.length];
            System.arraycopy(ciphertext, 0, combined, 0, ciphertext.length);
            System.arraycopy(tag, 0, combined, ciphertext.length, tag.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(controlKey(required(call, "nodeId")), "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(CONTROL_INFO);
            String json = new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("json", json));
        } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    private JSObject identityJson() throws Exception {
        KeyPair signing = keyPair(SIGNING, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY);
        KeyPair exchange = keyPair(EXCHANGE, KeyProperties.PURPOSE_AGREE_KEY);
        String nodeId = hex(sha256(signing.getPublic().getEncoded()));
        return new JSObject().put("nodeId", nodeId)
            .put("signingPublicKeyDer", b64(signing.getPublic().getEncoded()))
            .put("exchangePublicKeyDer", b64(exchange.getPublic().getEncoded()));
    }

    private KeyPair keyPair(String alias, int purposes) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(alias)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(alias, purposes)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256).build());
            generator.generateKeyPair();
        }
        return new KeyPair(store.getCertificate(alias).getPublicKey(), (PrivateKey) store.getKey(alias, null));
    }

    private PrivateKey privateKey(String alias) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        return (PrivateKey) store.getKey(alias, null);
    }

    private SecretKey storageKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(STORAGE)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(STORAGE, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(STORAGE, null);
    }

    private void saveSecret(String nodeId, byte[] secret) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, storageKey());
        byte[] ciphertext = cipher.doFinal(secret);
        preferences().edit().putString("peer:" + nodeId, b64(cipher.getIV()) + "." + b64(ciphertext)).apply();
    }

    private byte[] loadSecret(String nodeId) throws Exception {
        String stored = preferences().getString("peer:" + nodeId, null);
        if (stored == null) throw new SecurityException("Peer is not paired.");
        String[] parts = stored.split("\\.", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, storageKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.DEFAULT)));
        return cipher.doFinal(Base64.decode(parts[1], Base64.DEFAULT));
    }

    private byte[] controlKey(String nodeId) throws Exception {
        return hkdf(loadSecret(nodeId), "TheOrc.HIVE.Control".getBytes(StandardCharsets.UTF_8), CONTROL_INFO);
    }

    private SharedPreferences preferences() { return getContext().getSharedPreferences(STORE, 0); }
    private static String required(PluginCall call, String name) { String value = call.getString(name); if (value == null) throw new IllegalArgumentException(name + " is required"); return value; }
    private static byte[] sha256(byte[] value) throws Exception { return MessageDigest.getInstance("SHA-256").digest(value); }
    private static byte[] hmac(byte[] key, byte[] value) throws Exception { Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256")); return mac.doFinal(value); }
    private static byte[] hkdf(byte[] input, byte[] salt, byte[] info) throws Exception {
        byte[] prk = hmac(salt, input); Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info); mac.update((byte) 1); return mac.doFinal();
    }
    private static byte[] xorNodeIds(String a, String b) { byte[] aa = fromHex(a.substring(0, 64)); byte[] bb = fromHex(b.substring(0, 64)); byte[] out = new byte[32]; for (int i = 0; i < 32; i++) out[i] = (byte) (aa[i] ^ bb[i]); return out; }
    private static byte[] derEcdsaToP1363(byte[] der) {
        int cursor = 2;
        if ((der[1] & 0x80) != 0) cursor = 2 + (der[1] & 0x7f);
        if (der[cursor++] != 0x02) throw new IllegalArgumentException("Invalid ECDSA signature.");
        int rLen = der[cursor++] & 0xff; byte[] r = java.util.Arrays.copyOfRange(der, cursor, cursor + rLen); cursor += rLen;
        if (der[cursor++] != 0x02) throw new IllegalArgumentException("Invalid ECDSA signature.");
        int sLen = der[cursor++] & 0xff; byte[] s = java.util.Arrays.copyOfRange(der, cursor, cursor + sLen);
        byte[] out = new byte[64]; copyUnsigned(r, out, 0); copyUnsigned(s, out, 32); return out;
    }
    private static void copyUnsigned(byte[] value, byte[] output, int offset) {
        int start = value.length > 32 && value[0] == 0 ? value.length - 32 : 0;
        int length = Math.min(32, value.length - start);
        System.arraycopy(value, start, output, offset + 32 - length, length);
    }
    private static byte[] fromHex(String value) { byte[] out = new byte[value.length() / 2]; for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16); return out; }
    private static String hex(byte[] value) { StringBuilder out = new StringBuilder(value.length * 2); for (byte b : value) out.append(String.format("%02x", b & 0xff)); return out.toString(); }
    private static String b64(byte[] value) { return Base64.encodeToString(value, Base64.NO_WRAP); }
}
