package studio.lexiao.linuxdo;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Base64;

public final class ShareCodeTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final String PASSWORD = "Correct-Horse-电池-9!";
    private static final String FIXTURE = "LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTXbADi28MeJ1EAKqDgqJFx-Squ4i8IGrrrP620_Fc28nn5sFlLW0MrpvnbMhAnVbtAnlXZNIouEjFJe3O0-6QBSK_BfJIs3ZsOONXwLy8VjIdmEtE4w5GtuAgtYaWZUuuuDY9KRQSbwNBoPlMfIei9xOq0wZXlwhKWw3RmaA";

    private static final String TIMES = "&title=%E5%85%AC%E5%BC%80%E4%B8%BB%E9%A2%98&iat=1800000000000&exp=1800003600000";
    // {site id, topic id, slug, golden code, plaintext, URL}. Same salt, nonce, password and times as FIXTURE;
    // the golden codes were produced independently with Node's crypto and match the PyCharm producer.
    private static final String[][] FORUM_VECTORS = {
            {"linuxdo", "12345", "hello-linux-do", FIXTURE,
                    "v=2&id=12345&slug=hello-linux-do" + TIMES, "https://linux.do/t/hello-linux-do/12345"},
            {"nodeseek", "12345", "", "LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTWbBrvkpcRegpRaaDpuJ1q-Cv_v3IWQuajPrzt9F0to1W4-QRDW0ddpoTbMhMnVcZFnlKuNPAmEjY_e3S1-6dxSNPAf7p_jJ8HJoyhayIUhIdmEtE41cTl-AUsf_DREuasA49KRQSYz-_tx3U-r01oFdOWhraBKA",
                    "v=3&site=nodeseek&id=12345" + TIMES, "https://www.nodeseek.com/post-12345-1"},
            {"v2ex", "12345", "", "LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTWbBrvkpcRYldQdPXluct9o3z2u2ZRH6fpL-i83Q01viWonX9TOzM7wYLLL2FBNcpQ-S-_U_A7ck1YHwOp595lBIuMZOImyJIGLoyhayIUhIdwR5l4zpCluAgtd_PXEuavBY-q21fqvd34R_UWzvEyvXij",
                    "v=3&site=v2ex&id=12345" + TIMES, "https://www.v2ex.com/t/12345"},
            {"idcflare", "12345", "topic", "LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTWbBrvkpcRfQFWar_tr5Nq-Cv_v3IWQuajObns_wVk6WDkvxoCF3Jy5vzLUmRBSMtQ-lS_VIc7dTdYZgGpm9JmL9LdG5E7vZsTX460YioC3dYiH9Aww5GtuAgtd_DREua5UMcKSAWQxtBoPlAZfq8HOtyb8pGK8_Y5g6eoPIcgnEmp",
                    "v=3&site=idcflare&id=12345&slug=topic" + TIMES, "https://idcflare.com/t/topic/12345"},
    };
    private static byte[] independentKey;

    public static void main(String[] args) throws Exception {
        opensEncryptedShareProducedByVsCode();
        producesEncryptedShareAcceptedByVsCode();
        codeAloneDoesNotRevealTopic();
        rejectsInvalidContentAndPasswords();
        encodesEveryForumWithGoldenVectors();
        readsTopicsFromEveryForum();
        rejectsMalformedForumPayloads();
    }

    private static void encodesEveryForumWithGoldenVectors() throws Exception {
        for (String[] row : FORUM_VECTORS) {
            ShareCode.Topic topic = new ShareCode.Topic(ForumSite.forShareId(row[0]), Long.parseLong(row[1]), row[2], "公开主题");
            String code = ShareCode.create(topic, PASSWORD, 60 * 60 * 1000L, NOW, sequence(0, 16), sequence(160, 12));
            require(row[3].equals(code), row[0] + " golden vector mismatch");
            require(row[4].equals(decryptIndependently(code)), row[0] + " plaintext mismatch");
            ShareCode.Decoded decoded = ShareCode.parse(code, PASSWORD, NOW + 1);
            require(decoded.topic().equals(topic), row[0] + " round trip mismatch");
            require(row[5].equals(decoded.topic().url()), row[0] + " URL mismatch");
            require(decoded.expiresAt() == NOW + 60 * 60 * 1000L, row[0] + " expiry mismatch");
        }
    }

    private static void readsTopicsFromEveryForum() {
        String[][] rows = {
                {"https://www.nodeseek.com/post-969428-3#12", "https://www.nodeseek.com/post-969428-1"},
                {"https://v2ex.com/t/1246711?p=2#reply5", "https://www.v2ex.com/t/1246711"},
                {"https://idcflare.com/t/topic/39038/5", "https://idcflare.com/t/topic/39038"},
                {"https://linux.do/t/中文/123", "https://linux.do/t/topic/123"},
                {"https://linux.do/t/123/4", "https://linux.do/t/topic/123"},
                {"https://linux.do/latest", null},
                {"https://www.v2ex.com/go/python", null},
        };
        for (String[] row : rows) {
            ShareCode.Topic topic = ShareCode.fromTopicUrl(row[0], "公开主题");
            String url = topic == null ? null : topic.url();
            require(java.util.Objects.equals(url, row[1]), "topic URL " + row[0] + " -> " + url);
        }
    }

    private static void rejectsMalformedForumPayloads() throws Exception {
        String times = "&title=T&iat=" + NOW + "&exp=" + (NOW + 60_000);
        String[][] rows = {
                {"v=3&site=linuxdo&id=1&slug=topic" + times, "加密分享内容无效。"},
                {"v=3&site=unknown&id=1" + times, "加密分享内容无效。"},
                {"v=3&id=1" + times, "加密分享内容无效。"},
                {"v=3&site=nodeseek&id=1&slug=topic" + times, "加密分享内容无效。"},
                {"v=3&site=idcflare&id=1" + times, "加密分享内容无效。"},
                {"v=2&site=nodeseek&id=1&slug=topic" + times, "加密分享内容无效。"},
                {"v=3&site=v2ex&site=v2ex&id=1" + times, "加密分享内容无效。"},
                {"v=3&site=nodeseek&id=0" + times, "主题编号无效。"},
                {"v=3&site=idcflare&id=1&slug=%E4%B8%AD" + times, "主题地址无效。"},
                {"v=4&site=nodeseek&id=1&extra=1" + times, "此加密分享由更新版本的插件生成，请升级插件后再打开。"},
        };
        for (String[] row : rows) {
            String code = sealIndependently(row[0]);
            try {
                ShareCode.parse(code, PASSWORD, NOW + 1);
                throw new AssertionError("expected rejection: " + row[0]);
            } catch (IllegalArgumentException expected) {
                require(row[1].equals(expected.getMessage()), row[0] + " -> " + expected.getMessage());
            }
        }
    }

    // An implementation independent of ShareCode: the platform PBKDF2 and AES-GCM.
    private static byte[] key() throws Exception {
        if (independentKey == null) {
            char[] password = Normalizer.normalize(PASSWORD, Normalizer.Form.NFKC).toCharArray();
            independentKey = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(new PBEKeySpec(password, sequence(0, 16), ShareCode.PBKDF2_ITERATIONS, 256)).getEncoded();
        }
        return independentKey;
    }

    private static String decryptIndependently(String code) throws Exception {
        String[] parts = code.split("\\.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key(), "AES"),
                new GCMParameterSpec(128, Base64.getUrlDecoder().decode(parts[2])));
        cipher.updateAAD("LDGS2".getBytes(StandardCharsets.US_ASCII));
        return new String(cipher.doFinal(Base64.getUrlDecoder().decode(parts[3])), StandardCharsets.UTF_8);
    }

    private static String sealIndependently(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(128, sequence(160, 12)));
        cipher.updateAAD("LDGS2".getBytes(StandardCharsets.US_ASCII));
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return "LDGS2." + encoder.encodeToString(sequence(0, 16)) + "." + encoder.encodeToString(sequence(160, 12))
                + "." + encoder.encodeToString(cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)));
    }

    private static void opensEncryptedShareProducedByVsCode() {
        ShareCode.Topic topic = new ShareCode.Topic(12345, "hello-linux-do", "公开主题");
        ShareCode.Decoded decoded = ShareCode.parse(FIXTURE, PASSWORD, NOW + 1);
        require(decoded.topic().equals(topic), "topic mismatch");
        require(decoded.expiresAt() == NOW + 60 * 60 * 1000L, "expiry mismatch");
    }

    private static void producesEncryptedShareAcceptedByVsCode() {
        ShareCode.Topic topic = new ShareCode.Topic(12345, "hello-linux-do", "公开主题");
        String code = ShareCode.create(topic, PASSWORD, 60 * 60 * 1000L, NOW, sequence(0, 16), sequence(160, 12));
        require(FIXTURE.equals(code), "cross-platform fixture mismatch");
        require(ShareCode.fromTopicUrl("https://linux.do/t/hello-linux-do/12345/7", "公开主题").equals(topic), "URL parse mismatch");
    }

    private static void codeAloneDoesNotRevealTopic() {
        StringBuilder visible = new StringBuilder();
        for (String part : FIXTURE.split("\\.", -1)) {
            if (!"LDGS2".equals(part)) visible.append(new String(Base64.getUrlDecoder().decode(part), StandardCharsets.UTF_8));
        }
        String value = visible.toString();
        require(!value.contains("12345") && !value.contains("hello-linux-do") && !value.contains("公开主题")
                && !value.contains("1800003600000"), "encrypted content leaked metadata");
    }

    private static void rejectsInvalidContentAndPasswords() {
        expectFailure(() -> ShareCode.parse(FIXTURE, "Wrong-Password-123!", NOW));
        String[] parts = FIXTURE.split("\\.");
        byte[] sealed = Base64.getUrlDecoder().decode(parts[3]);
        sealed[0] ^= 1;
        String damaged = parts[0] + "." + parts[1] + "." + parts[2] + "."
                + Base64.getUrlEncoder().withoutPadding().encodeToString(sealed);
        expectFailure(() -> ShareCode.parse(damaged, PASSWORD, NOW));
        expectFailure(() -> ShareCode.parse(FIXTURE, PASSWORD, NOW + 60 * 60 * 1000L));
        expectFailure(() -> ShareCode.parse("LDGS1.legacy.value", PASSWORD, NOW));
        expectFailure(() -> ShareCode.create(new ShareCode.Topic(1, "topic", "Title"), "too-short", 60_000, NOW));
        String generated = ShareCode.generatePassword();
        require(generated.length() == 20, "generated password length mismatch");
        require(generated.matches(".*[A-Z].*") && generated.matches(".*[a-z].*")
                && generated.matches(".*[2-9].*") && generated.matches(".*[!@#$%*\\-_=+].*"),
                "generated password groups missing");
    }

    private static byte[] sequence(int start, int length) {
        byte[] result = new byte[length];
        for (int index = 0; index < length; index++) result[index] = (byte) (start + index);
        return result;
    }

    private static void expectFailure(Runnable action) {
        try {
            action.run();
            throw new AssertionError("expected failure");
        } catch (IllegalArgumentException expected) {
            // Expected.
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
