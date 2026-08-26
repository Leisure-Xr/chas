package studio.lexiao.linuxdo;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ReaderHistory {
    static final int MAX_ENTRIES = 60;
    private static final int MAX_TITLE_LENGTH = 200;
    private static final int MAX_URL_LENGTH = 2048;
    private static final Pattern TOPIC_PATH = Pattern.compile("^/t/(?:([^/]+)/)?([1-9][0-9]*)(?:/.*)?$");

    record Entry(String url, String title, long visitedAt) {
    }

    private ReaderHistory() {
    }

    static Entry create(String rawUrl, String rawTitle, long visitedAt) {
        String url = normalizeUrl(rawUrl);
        if (url == null || visitedAt <= 0) return null;
        String title = String.valueOf(rawTitle == null ? "" : rawTitle)
                .replaceAll("[\\r\\n\\t]+", " ")
                .replaceAll("\\s+", " ")
                .replaceFirst("^\\([0-9]+\\)\\s*", "")
                .replaceAll("\\s+-\\s+(?:LINUX DO|搞七捻三)\\s*$", "")
                .trim();
        if (url.equals("https://linux.do/latest")) title = "最新主题";
        else if (url.equals("https://linux.do/top")) title = "本周热门";
        else if (url.equals("https://linux.do/categories")) title = "浏览分类";
        else if (url.startsWith("https://linux.do/search")) title = "搜索结果";
        if (title.isEmpty()) title = "公开页面";
        if (title.length() > MAX_TITLE_LENGTH) title = title.substring(0, MAX_TITLE_LENGTH);
        return new Entry(url, title, visitedAt);
    }

    static List<Entry> add(List<Entry> current, Entry candidate) {
        ArrayList<Entry> result = new ArrayList<>();
        if (candidate != null) result.add(candidate);
        if (current != null) {
            for (Entry entry : current) {
                if (entry == null || candidate != null && candidate.url().equals(entry.url())) continue;
                Entry normalized = create(entry.url(), entry.title(), entry.visitedAt());
                if (normalized != null) result.add(normalized);
                if (result.size() >= MAX_ENTRIES) break;
            }
        }
        return result;
    }

    static List<Entry> updateTitle(List<Entry> current, String rawUrl, String rawTitle) {
        String url = normalizeUrl(rawUrl);
        if (url == null || current == null || current.isEmpty()) return current == null ? List.of() : new ArrayList<>(current);
        ArrayList<Entry> result = new ArrayList<>();
        for (Entry entry : current) {
            if (entry == null) continue;
            Entry updated = url.equals(entry.url()) ? create(entry.url(), rawTitle, entry.visitedAt()) : entry;
            Entry normalized = updated == null ? null : create(updated.url(), updated.title(), updated.visitedAt());
            if (normalized != null) result.add(normalized);
            if (result.size() >= MAX_ENTRIES) break;
        }
        return result;
    }

    static String serialize(List<Entry> entries) {
        StringBuilder result = new StringBuilder();
        if (entries == null) return "";
        int count = 0;
        for (Entry entry : entries) {
            Entry normalized = entry == null ? null : create(entry.url(), entry.title(), entry.visitedAt());
            if (normalized == null) continue;
            if (count > 0) result.append('\n');
            result.append(normalized.visitedAt()).append('\t')
                    .append(encode(normalized.title())).append('\t')
                    .append(encode(normalized.url()));
            count += 1;
            if (count >= MAX_ENTRIES) break;
        }
        return result.toString();
    }

    static List<Entry> parse(String value) {
        ArrayList<Entry> entries = new ArrayList<>();
        if (value == null || value.isBlank()) return entries;
        for (String line : value.split("\\n")) {
            String[] fields = line.split("\\t", -1);
            if (fields.length != 3) continue;
            try {
                long visitedAt = Long.parseLong(fields[0]);
                Entry entry = create(decode(fields[2]), decode(fields[1]), visitedAt);
                if (entry != null && entries.stream().noneMatch(current -> current.url().equals(entry.url()))) {
                    entries.add(entry);
                }
            } catch (IllegalArgumentException ignored) {
                // Ignore a damaged local history entry without losing valid entries.
            }
            if (entries.size() >= MAX_ENTRIES) break;
        }
        return entries;
    }

    private static String normalizeUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.length() > MAX_URL_LENGTH) return null;
        try {
            URI uri = URI.create(rawUrl.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"linux.do".equalsIgnoreCase(uri.getHost())
                    || uri.getUserInfo() != null) return null;
            String path = uri.getPath() == null || uri.getPath().isBlank() ? "/latest" : uri.getPath();
            String lowerPath = path.toLowerCase();
            if (lowerPath.startsWith("/login") || lowerPath.startsWith("/signup")
                    || lowerPath.startsWith("/session") || lowerPath.startsWith("/auth")
                    || lowerPath.startsWith("/cdn-cgi/")) return null;
            String query = uri.getQuery();
            if (query != null && query.toLowerCase().contains("__cf_chl")) return null;
            Matcher topic = TOPIC_PATH.matcher(path);
            if (topic.matches()) {
                String slug = topic.group(1) == null ? "topic" : topic.group(1);
                path = "/t/" + slug + "/" + topic.group(2);
                query = null;
            } else if (lowerPath.matches("/(?:latest|top|categories)/?")) {
                path = lowerPath.replaceAll("/$", "");
                query = null;
            }
            return new URI("https", null, "linux.do", -1, path, query, null).toString();
        } catch (IllegalArgumentException | URISyntaxException ignored) {
            return null;
        }
    }

    private static String encode(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String value) {
        byte[] bytes = Base64.getUrlDecoder().decode(value);
        if (bytes.length > MAX_URL_LENGTH * 4) throw new IllegalArgumentException("history field too large");
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
