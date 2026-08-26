package studio.lexiao.linuxdo;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class ShareCodeTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final String PASSWORD = "Correct-Horse-电池-9!";
    private static final String FIXTURE = "LDGS2.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.qPTXbADi28MeJ1EAKqDgqJFx-Squ4i8IGrrrP620_Fc28nn5sFlLW0MrpvnbMhAnVbtAnlXZNIouEjFJe3O0-6QBSK_BfJIs3ZsOONXwLy8VjIdmEtE4w5GtuAgtYaWZUuuuDY9KRQSbwNBoPlMfIei9xOq0wZXlwhKWw3RmaA";

    public static void main(String[] args) {
        opensEncryptedShareProducedByVsCode();
        producesEncryptedShareAcceptedByVsCode();
        codeAloneDoesNotRevealTopic();
        rejectsInvalidContentAndPasswords();
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
