package studio.lexiao.linuxdo;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.text.DateFormat;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ShareCode {
    public static final long MAX_DURATION_MS = 7L * 24 * 60 * 60 * 1000;
    public static final int MIN_PASSWORD_LENGTH = 12;
    public static final int MAX_PASSWORD_LENGTH = 128;
    public static final int PBKDF2_ITERATIONS = 600_000;
    private static final long MIN_DURATION_MS = 60_000;
    private static final long CLOCK_SKEW_MS = 5 * 60 * 1000;
    private static final int SALT_BYTES = 16;
    private static final int NONCE_BYTES = 12;
    private static final int KEY_BYTES = 32;
    private static final int TAG_BITS = 128;
    private static final byte[] AAD = "LDGS2".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern TOPIC_PATH = Pattern.compile("^/t/([^/]+)/([1-9][0-9]*)(?:/.*)?$");
    private static final String[] PASSWORD_GROUPS = {
            "ABCDEFGHJKLMNPQRSTUVWXYZ",
            "abcdefghijkmnopqrstuvwxyz",
            "23456789",
            "!@#$%*-_=+"
    };

    private ShareCode() {}

    public record Topic(long id, String slug, String title) {
        public String url() {
            return "https://linux.do/t/" + slug + "/" + id;
        }
    }

    public record Decoded(Topic topic, long createdAt, long expiresAt) {}

    public static String create(Topic topic, String password, long durationMs, long now) {
        byte[] salt = new byte[SALT_BYTES];
        byte[] nonce = new byte[NONCE_BYTES];
        RANDOM.nextBytes(salt);
        RANDOM.nextBytes(nonce);
        return create(topic, password, durationMs, now, salt, nonce);
    }

    static String create(Topic topic, String password, long durationMs, long now, byte[] rawSalt, byte[] rawNonce) {
        Topic normalized = normalize(topic);
        String normalizedPassword = normalizePassword(password);
        if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS || now <= 0) {
            throw new IllegalArgumentException("分享有效期必须在 1 分钟到 7 天之间。");
        }
        byte[] salt = fixedLength(rawSalt, SALT_BYTES, "分享盐");
        byte[] nonce = fixedLength(rawNonce, NONCE_BYTES, "分享随机数");
        String payloadText = "v=2&id=" + normalized.id()
                + "&slug=" + encode(normalized.slug())
                + "&title=" + encode(normalized.title())
                + "&iat=" + now
                + "&exp=" + (now + durationMs);
        byte[] key = deriveKey(normalizedPassword, salt);
        byte[] sealed;
        try {
            sealed = crypt(Cipher.ENCRYPT_MODE, payloadText.getBytes(StandardCharsets.UTF_8), key, nonce);
        } finally {
            Arrays.fill(key, (byte) 0);
        }
        return "LDGS2." + base64(salt) + "." + base64(nonce) + "." + base64(sealed);
    }

    public static Decoded parse(String input, String password, long now) {
        String code = input == null ? "" : input.trim();
        if (code.startsWith("LDGS1.")) {
            throw new IllegalArgumentException("旧版分享内容没有密码加密，已停止支持。请让发送方使用新版插件重新生成。");
        }
        if (code.length() > 4096) throw new IllegalArgumentException("加密分享内容过长。");
        String[] parts = code.split("\\.", -1);
        if (parts.length != 4 || !"LDGS2".equals(parts[0])
                || !parts[1].matches("[A-Za-z0-9_-]+")
                || !parts[2].matches("[A-Za-z0-9_-]+")
                || !parts[3].matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException("加密分享内容格式不正确。");
        }
        String normalizedPassword = normalizePassword(password);

        byte[] salt;
        byte[] nonce;
        byte[] sealed;
        try {
            salt = fixedLength(decodeBase64(parts[1]), SALT_BYTES, "分享盐");
            nonce = fixedLength(decodeBase64(parts[2]), NONCE_BYTES, "分享随机数");
            sealed = decodeBase64(parts[3]);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("加密分享内容格式不正确。");
        }
        if (sealed.length <= TAG_BITS / 8 || sealed.length > 4096) {
            throw new IllegalArgumentException("加密分享内容格式不正确。");
        }

        byte[] key = deriveKey(normalizedPassword, salt);
        byte[] payload;
        try {
            payload = crypt(Cipher.DECRYPT_MODE, sealed, key, nonce);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("分享密码不正确，或加密分享内容已被修改。");
        } finally {
            Arrays.fill(key, (byte) 0);
        }

        Map<String, String> values = parseQuery(new String(payload, StandardCharsets.UTF_8));
        List<String> expected = List.of("v", "id", "slug", "title", "iat", "exp");
        if (values.size() != expected.size() || !values.keySet().containsAll(expected) || !"2".equals(values.get("v"))) {
            throw new IllegalArgumentException("加密分享内容无效。");
        }
        long id = parseLong(values.get("id"), "主题编号无效。");
        Topic topic = normalize(new Topic(id, values.get("slug"), values.get("title")));
        long createdAt = parseLong(values.get("iat"), "分享时间信息无效。");
        long expiresAt = parseLong(values.get("exp"), "分享时间信息无效。");
        if (createdAt <= 0 || expiresAt <= createdAt) throw new IllegalArgumentException("分享时间信息无效。");
        if (createdAt > now + CLOCK_SKEW_MS) throw new IllegalArgumentException("分享生成时间晚于当前设备时间。");
        long duration = expiresAt - createdAt;
        if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) throw new IllegalArgumentException("分享有效期无效。");
        if (expiresAt <= now) {
            String expiredAt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM, java.util.Locale.CHINA)
                    .format(new Date(expiresAt));
            throw new IllegalArgumentException("加密分享已于 " + expiredAt + " 失效。");
        }
        return new Decoded(topic, createdAt, expiresAt);
    }

    public static String generatePassword() {
        String alphabet = String.join("", PASSWORD_GROUPS);
        ArrayList<Character> characters = new ArrayList<>();
        for (String group : PASSWORD_GROUPS) characters.add(group.charAt(RANDOM.nextInt(group.length())));
        while (characters.size() < 20) characters.add(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
        for (int index = characters.size() - 1; index > 0; index--) {
            int other = RANDOM.nextInt(index + 1);
            Character value = characters.get(index);
            characters.set(index, characters.get(other));
            characters.set(other, value);
        }
        StringBuilder result = new StringBuilder(characters.size());
        characters.forEach(result::append);
        return result.toString();
    }

    public static void validatePassword(String password) {
        normalizePassword(password);
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

    private static String normalizePassword(String password) {
        String normalized = Normalizer.normalize(password == null ? "" : password, Normalizer.Form.NFKC);
        int length = normalized.codePointCount(0, normalized.length());
        if (length < MIN_PASSWORD_LENGTH) throw new IllegalArgumentException("分享密码至少需要 12 个字符。");
        if (length > MAX_PASSWORD_LENGTH) throw new IllegalArgumentException("分享密码不能超过 128 个字符。");
        return normalized;
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
            if (separator <= 0) throw new IllegalArgumentException("加密分享内容无效。");
            String name = decode(part.substring(0, separator));
            if (values.put(name, decode(part.substring(separator + 1))) != null) {
                throw new IllegalArgumentException("加密分享内容无效。");
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

    private static byte[] deriveKey(String password, byte[] salt) {
        byte[] passwordBytes = password.getBytes(StandardCharsets.UTF_8);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(passwordBytes, "HmacSHA256"));
            byte[] firstBlock = ByteBuffer.allocate(salt.length + 4)
                    .put(salt).putInt(1).array();
            byte[] previous = mac.doFinal(firstBlock);
            byte[] result = Arrays.copyOf(previous, previous.length);
            for (int iteration = 1; iteration < PBKDF2_ITERATIONS; iteration++) {
                previous = mac.doFinal(previous);
                for (int index = 0; index < result.length; index++) result[index] ^= previous[index];
            }
            return Arrays.copyOf(result, KEY_BYTES);
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException(impossible);
        } finally {
            Arrays.fill(passwordBytes, (byte) 0);
        }
    }

    private static byte[] crypt(int mode, byte[] input, byte[] key, byte[] nonce) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(AAD);
            return cipher.doFinal(input);
        } catch (GeneralSecurityException error) {
            throw new IllegalArgumentException("分享加密或解密失败。", error);
        }
    }

    private static byte[] fixedLength(byte[] value, int length, String label) {
        if (value == null || value.length != length) throw new IllegalArgumentException(label + "长度无效。");
        return Arrays.copyOf(value, value.length);
    }

    private static byte[] decodeBase64(String value) {
        byte[] decoded = Base64.getUrlDecoder().decode(value);
        if (decoded.length == 0 || !base64(decoded).equals(value)) throw new IllegalArgumentException("Base64URL 无效。");
        return decoded;
    }

    private static String base64(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
