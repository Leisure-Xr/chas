package studio.lexiao.linuxdo;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Presentation state only; the persisted format remains owned by ReaderFavorites. */
final class FavoritesViewModel {
    record Row(ReaderFavorites.Folder folder, ReaderFavorites.Item item) {
        String key() { return folder.id() + ":" + item.url(); }

        String siteName() {
            ForumSite site = ForumSite.forUrl(item.url());
            return site == null ? "" : site.displayName();
        }
    }

    private List<ReaderFavorites.Folder> folders;
    private String selectedFolder;
    private String query = "";

    FavoritesViewModel(List<ReaderFavorites.Folder> folders) { replace(folders); }

    List<ReaderFavorites.Folder> folders() { return folders; }
    String selectedId() { return selectedFolder; }
    String query() { return query; }
    boolean searching() { return !query.isBlank(); }
    int total() { return folders.stream().mapToInt(folder -> folder.items().size()).sum(); }

    ReaderFavorites.Folder selected() {
        return folders.stream().filter(folder -> folder.id().equals(selectedFolder)).findFirst().orElse(null);
    }

    void replace(List<ReaderFavorites.Folder> updated) {
        folders = List.copyOf(ReaderFavorites.normalize(updated));
        if (selected() == null) selectedFolder = null;
    }

    void select(String id) {
        selectedFolder = id;
        if (selected() == null) selectedFolder = null;
    }

    void search(String text) { query = text == null ? "" : text; }

    List<Row> rows() {
        String needle = query.trim().toLowerCase(Locale.ROOT);
        return folders.stream()
                .filter(folder -> !needle.isEmpty() || selectedFolder == null || folder.id().equals(selectedFolder))
                .flatMap(folder -> folder.items().stream().map(item -> new Row(folder, item)))
                .filter(row -> needle.isEmpty() || (row.siteName() + " " + row.folder().name() + " " + row.item().title() + " " + row.item().url())
                        .toLowerCase(Locale.ROOT).contains(needle))
                .sorted(Comparator.comparingLong((Row row) -> row.item().savedAt()).reversed())
                .toList();
    }
}
