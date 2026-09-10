package studio.lexiao.linuxdo;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class ReaderFavorites {
    static final int MAX_FOLDERS = 30;
    static final int MAX_ITEMS_PER_FOLDER = 100;
    static final int MAX_TOTAL_ITEMS = 300;
    private static final int MAX_FOLDER_NAME_LENGTH = 50;

    record Item(String url, String title, long savedAt) {}

    record Folder(String id, String name, long createdAt, List<Item> items) {
        Folder {
            items = List.copyOf(items == null ? List.of() : items);
        }
    }

    private ReaderFavorites() {}

    static List<Folder> normalize(List<Folder> current) {
        ArrayList<Folder> result = new ArrayList<>();
        int totalItems = 0;
        if (current == null) return result;
        for (Folder rawFolder : current) {
            Folder folder = normalizeFolder(rawFolder);
            if (folder == null || result.stream().anyMatch(entry ->
                    entry.id().equals(folder.id()) || sameName(entry.name(), folder.name()))) continue;
            ArrayList<Item> items = new ArrayList<>();
            for (Item rawItem : folder.items()) {
                Item item = normalizeItem(rawItem);
                if (item == null || items.stream().anyMatch(entry -> entry.url().equals(item.url()))
                        || totalItems >= MAX_TOTAL_ITEMS) continue;
                items.add(item);
                totalItems += 1;
                if (items.size() >= MAX_ITEMS_PER_FOLDER) break;
            }
            result.add(new Folder(folder.id(), folder.name(), folder.createdAt(), items));
            if (result.size() >= MAX_FOLDERS) break;
        }
        return result;
    }

    static List<Folder> createFolder(List<Folder> current, String rawName, String rawId, long createdAt) {
        List<Folder> folders = normalize(current);
        String name = requireFolderName(rawName);
        String id = rawId == null ? "" : rawId.trim();
        if (!id.matches("[A-Za-z0-9_-]{1,64}") || createdAt <= 0) throw new IllegalArgumentException("收藏目录标识无效。");
        if (folders.size() >= MAX_FOLDERS) throw new IllegalArgumentException("最多创建 " + MAX_FOLDERS + " 个收藏目录。");
        if (folders.stream().anyMatch(folder -> folder.id().equals(id) || sameName(folder.name(), name))) {
            throw new IllegalArgumentException("收藏目录名称已存在。");
        }
        ArrayList<Folder> result = new ArrayList<>(folders);
        result.add(new Folder(id, name, createdAt, List.of()));
        return result;
    }

    static List<Folder> renameFolder(List<Folder> current, String folderId, String rawName) {
        List<Folder> folders = normalize(current);
        String name = requireFolderName(rawName);
        if (folders.stream().anyMatch(folder -> !folder.id().equals(folderId) && sameName(folder.name(), name))) {
            throw new IllegalArgumentException("收藏目录名称已存在。");
        }
        boolean found = false;
        ArrayList<Folder> result = new ArrayList<>();
        for (Folder folder : folders) {
            if (folder.id().equals(folderId)) {
                result.add(new Folder(folder.id(), name, folder.createdAt(), folder.items()));
                found = true;
            } else result.add(folder);
        }
        if (!found) throw new IllegalArgumentException("收藏目录不存在。");
        return result;
    }

    static List<Folder> deleteFolder(List<Folder> current, String folderId) {
        List<Folder> folders = normalize(current);
        ArrayList<Folder> result = new ArrayList<>(folders.stream()
                .filter(folder -> !folder.id().equals(folderId)).toList());
        if (result.size() == folders.size()) throw new IllegalArgumentException("收藏目录不存在。");
        return result;
    }

    static List<Folder> add(List<Folder> current, String folderId, String url, String title, long savedAt) {
        List<Folder> folders = normalize(current);
        Item item = normalizeItem(new Item(url, title, savedAt));
        if (item == null) throw new IllegalArgumentException("只能收藏公开的 LINUX DO 主题。");
        int totalItems = folders.stream().mapToInt(folder -> folder.items().size()).sum();
        boolean found = false;
        ArrayList<Folder> result = new ArrayList<>();
        for (Folder folder : folders) {
            if (!folder.id().equals(folderId)) {
                result.add(folder);
                continue;
            }
            found = true;
            ArrayList<Item> items = new ArrayList<>(folder.items().stream()
                    .filter(entry -> !entry.url().equals(item.url())).toList());
            if (items.size() >= MAX_ITEMS_PER_FOLDER) throw new IllegalArgumentException("每个目录最多收藏 " + MAX_ITEMS_PER_FOLDER + " 个主题。");
            if (items.size() == folder.items().size() && totalItems >= MAX_TOTAL_ITEMS) {
                throw new IllegalArgumentException("收藏夹最多保存 " + MAX_TOTAL_ITEMS + " 个主题。");
            }
            items.add(0, item);
            result.add(new Folder(folder.id(), folder.name(), folder.createdAt(), items));
        }
        if (!found) throw new IllegalArgumentException("收藏目录不存在。");
        return result;
    }

    static List<Folder> remove(List<Folder> current, String folderId, String rawUrl) {
        List<Folder> folders = normalize(current);
        ReaderHistory.Entry normalized = ReaderHistory.create(rawUrl, "收藏", 1);
        String url = normalized == null ? "" : normalized.url();
        boolean found = false;
        ArrayList<Folder> result = new ArrayList<>();
        for (Folder folder : folders) {
            if (!folder.id().equals(folderId)) {
                result.add(folder);
                continue;
            }
            found = true;
            result.add(new Folder(folder.id(), folder.name(), folder.createdAt(), folder.items().stream()
                    .filter(item -> !item.url().equals(url)).toList()));
        }
        if (!found) throw new IllegalArgumentException("收藏目录不存在。");
        return result;
    }

    static String serialize(List<Folder> current) {
        StringBuilder result = new StringBuilder();
        for (Folder folder : normalize(current)) {
            appendLine(result, "F\t" + folder.id() + "\t" + folder.createdAt() + "\t" + encode(folder.name()));
            for (Item item : folder.items()) {
                appendLine(result, "I\t" + folder.id() + "\t" + item.savedAt() + "\t" + encode(item.title()) + "\t" + encode(item.url()));
            }
        }
        return result.toString();
    }

    static List<Folder> parse(String value) {
        Map<String, MutableFolder> folders = new LinkedHashMap<>();
        int totalItems = 0;
        if (value == null || value.isBlank()) return List.of();
        for (String line : value.split("\n")) {
            String[] fields = line.split("\t", -1);
            try {
                if (fields.length == 4 && fields[0].equals("F")) {
                    Folder folder = normalizeFolder(new Folder(fields[1], decode(fields[3]), Long.parseLong(fields[2]), List.of()));
                    if (folder != null && folders.size() < MAX_FOLDERS && folders.values().stream()
                            .noneMatch(entry -> entry.id.equals(folder.id()) || sameName(entry.name, folder.name()))) {
                        folders.put(folder.id(), new MutableFolder(folder.id(), folder.name(), folder.createdAt()));
                    }
                } else if (fields.length == 5 && fields[0].equals("I")) {
                    MutableFolder folder = folders.get(fields[1]);
                    if (folder == null) continue;
                    Item item = normalizeItem(new Item(decode(fields[4]), decode(fields[3]), Long.parseLong(fields[2])));
                    if (item != null && folder.items.size() < MAX_ITEMS_PER_FOLDER && totalItems < MAX_TOTAL_ITEMS
                            && folder.items.stream().noneMatch(entry -> entry.url().equals(item.url()))) {
                        folder.items.add(item);
                        totalItems += 1;
                    }
                }
            } catch (IllegalArgumentException ignored) {
                // Ignore one damaged entry without discarding the rest of the library.
            }
        }
        return normalize(folders.values().stream()
                .map(folder -> new Folder(folder.id, folder.name, folder.createdAt, folder.items)).toList());
    }

    private static Folder normalizeFolder(Folder folder) {
        if (folder == null || folder.id() == null || !folder.id().matches("[A-Za-z0-9_-]{1,64}") || folder.createdAt() <= 0) return null;
        String name = normalizeFolderName(folder.name());
        return name.isEmpty() ? null : new Folder(folder.id(), name, folder.createdAt(), folder.items());
    }

    private static Item normalizeItem(Item item) {
        if (item == null || item.savedAt() <= 0) return null;
        ReaderHistory.Entry normalized = ReaderHistory.create(item.url(), item.title(), item.savedAt());
        if (normalized == null || !normalized.url().startsWith("https://linux.do/t/")) return null;
        return new Item(normalized.url(), normalized.title(), item.savedAt());
    }

    private static String requireFolderName(String value) {
        String name = normalizeFolderName(value);
        if (name.isEmpty()) throw new IllegalArgumentException("目录名称不能为空。");
        return name;
    }

    private static String normalizeFolderName(String value) {
        String name = String.valueOf(value == null ? "" : value).replaceAll("[\\r\\n\\t]+", " ").replaceAll("\\s+", " ").trim();
        return name.substring(0, Math.min(MAX_FOLDER_NAME_LENGTH, name.length()));
    }

    private static boolean sameName(String left, String right) {
        return left.toLowerCase(Locale.ROOT).equals(right.toLowerCase(Locale.ROOT));
    }

    private static void appendLine(StringBuilder result, String line) {
        if (!result.isEmpty()) result.append('\n');
        result.append(line);
    }

    private static String encode(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String value) {
        byte[] bytes = Base64.getUrlDecoder().decode(value);
        if (bytes.length > 8192) throw new IllegalArgumentException("favorite field too large");
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static final class MutableFolder {
        private final String id;
        private final String name;
        private final long createdAt;
        private final List<Item> items = new ArrayList<>();

        private MutableFolder(String id, String name, long createdAt) {
            this.id = id;
            this.name = name;
            this.createdAt = createdAt;
        }
    }
}
