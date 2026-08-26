package studio.lexiao.linuxdo;

public final class ShareCodeTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final String FIXTURE = "LDGS1.dj0xJmlkPTEyMzQ1JnNsdWc9aGVsbG8tbGludXgtZG8mdGl0bGU9JUU1JTg1JUFDJUU1JUJDJTgwJUU0JUI4JUJCJUU5JUEyJTk4JmlhdD0xODAwMDAwMDAwMDAwJmV4cD0xODAwMDAzNjAwMDAw.e8e9aca9e05466c1";

    public static void main(String[] args) {
        opensShareCodeProducedByVsCode();
        producesShareCodeAcceptedByVsCode();
        rejectsInvalidCodes();
    }

    private static void opensShareCodeProducedByVsCode() {
        ShareCode.Topic topic = new ShareCode.Topic(12345, "hello-linux-do", "公开主题");
        ShareCode.Decoded decoded = ShareCode.parse(FIXTURE, NOW + 1);
        require(decoded.topic().equals(topic), "topic mismatch");
        require(decoded.expiresAt() == NOW + 60 * 60 * 1000L, "expiry mismatch");
    }

    private static void producesShareCodeAcceptedByVsCode() {
        ShareCode.Topic topic = new ShareCode.Topic(12345, "hello-linux-do", "公开主题");
        String code = ShareCode.create(topic, 60 * 60 * 1000L, NOW);
        require(FIXTURE.equals(code), "cross-platform fixture mismatch");
        require(ShareCode.fromTopicUrl("https://linux.do/t/hello-linux-do/12345/7", "公开主题").equals(topic), "URL parse mismatch");
    }

    private static void rejectsInvalidCodes() {
        expectFailure(() -> ShareCode.parse(FIXTURE, NOW + 60 * 60 * 1000L));
        expectFailure(() -> ShareCode.parse(FIXTURE.substring(0, FIXTURE.length() - 1) + "0", NOW));
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
