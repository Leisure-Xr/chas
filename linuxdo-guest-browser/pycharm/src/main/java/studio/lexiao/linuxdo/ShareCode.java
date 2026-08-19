package studio.lexiao.linuxdo;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.DateFormat;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ShareCode {
    public static final long MAX_DURATION_MS = 7L * 24 * 60 * 60 * 1000;
    private static final long MIN_DURATION_MS = 60_000;
    private static final long CLOCK_SKEW_MS = 5 * 60 * 1000;
    private static final Pattern TOPIC_PATH = Pattern.compile("^/t/([^/]+)/([1-9][0-9]*)(?:/.*)?$");

    private ShareCode() {}

    public record Topic(long id, String slug, String title) {
        public String url() {
            return "https://linux.do/t/" + slug + "/" + id;
        }
    }

    public record Decoded(Topic topic, long createdAt, long expiresAt) {}

    public static String create(Topic topic, long durationMs, long now) {
        Topic normalized = normalize(topic);
        if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS || now <= 0) {
            throw new IllegalArgumentException("分享有效期必须在 1 分钟到 7 天之间。");
        }
        String payloadText = "v=1&id=" + normalized.id()
                + "&slug=" + encode(normalized.slug())
                + "&title=" + encode(normalized.title())
                + "&iat=" + now
                + "&exp=" + (now + durationMs);
        byte[] payload = payloadText.getBytes(StandardCharsets.UTF_8);
        return "LDGS1." + Base64.getUrlEncoder().withoutPadding().encodeToString(payload) + "." + checksum(payload);
    }

    public static Decoded parse(String input, long now) {
        String code = input == null ? "" : input.trim();
        if (code.length() > 4096) throw new IllegalArgumentException("分享码过长。");
        String[] parts = code.split("\\.", -1);
        if (parts.length != 3 || !"LDGS1".equals(parts[0])
                || !parts[1].matches("[A-Za-z0-9_-]+") || !parts[2].matches("[a-f0-9]{16}")) {
            throw new IllegalArgumentException("分享码格式不正确。");
        }

        byte[] payload;
        try {
            payload = Base64.getUrlDecoder().decode(parts[1]);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("分享码格式不正确。");
        }
        if (payload.length == 0 || !checksum(payload).equals(parts[2])) {
            throw new IllegalArgumentException("分享码已损坏或被修改。");
        }

        Map<String, String> values = parseQuery(new String(payload, StandardCharsets.UTF_8));
        if (!"1".equals(values.get("v"))) throw new IllegalArgumentException("分享码版本不受支持。");
        long id = parseLong(values.get("id"), "主题编号无效。");
        Topic topic = normalize(new Topic(id, values.get("slug"), values.get("title")));
        long createdAt = parseLong(values.get("iat"), "分享码时间信息无效。");
        long expiresAt = parseLong(values.get("exp"), "分享码时间信息无效。");
        if (createdAt <= 0 || expiresAt <= createdAt) throw new IllegalArgumentException("分享码时间信息无效。");
        if (createdAt > now + CLOCK_SKEW_MS) throw new IllegalArgumentException("分享码生成时间晚于当前设备时间。");
        long duration = expiresAt - createdAt;
        if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) throw new IllegalArgumentException("分享码有效期无效。");
        if (expiresAt <= now) {
            String expiredAt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM, java.util.Locale.CHINA)
                    .format(new Date(expiresAt));
            throw new IllegalArgumentException("分享码已于 " + expiredAt + " 失效。");
        }
        return new Decoded(topic, createdAt, expiresAt);
    }

    public static Topic fromTopicUrl(String rawUrl, String title) {
        try {
            URI uri = URI.create(rawUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"linux.do".equalsIgnoreCase(uri.getHost())) return null;
            Matcher matcher = TOPIC_PATH.matcher(uri.getPath() == null ? "" : uri.getPath());
            if (!matcher.matches()) return null;
            return normalize(new Topic(Long.parseLong(matcher.group(2)), matcher.group(1), title));
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static Topic normalize(Topic topic) {
        if (topic == null || topic.id() <= 0) throw new IllegalArgumentException("主题编号无效。");
        String slug = topic.slug() == null ? "" : topic.slug().trim();
        String title = topic.title() == null ? "" : topic.title().replaceAll("[\\r\\n]+", " ").trim();
        if (!slug.matches("[A-Za-z0-9_-]{1,200}")) throw new IllegalArgumentException("主题地址无效。");
        if (title.isEmpty() || title.length() > 200) throw new IllegalArgumentException("主题标题无效。");
        return new Topic(topic.id(), slug, title);
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> values = new HashMap<>();
        for (String part : query.split("&")) {
            int separator = part.indexOf('=');
            if (separator <= 0) throw new IllegalArgumentException("分享码格式不正确。");
            String key = decode(part.substring(0, separator));
            if (values.put(key, decode(part.substring(separator + 1))) != null) {
                throw new IllegalArgumentException("分享码格式不正确。");
            }
        }
        return values;
    }

    private static long parseLong(String value, String message) {
        try {
            return Long.parseLong(value);
        } catch (RuntimeException error) {
            throw new IllegalArgumentException(message);
        }
    }

    private static String checksum(byte[] payload) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(payload);
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
