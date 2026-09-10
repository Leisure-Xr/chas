package studio.lexiao.linuxdo;

import java.util.List;

public final class ReaderFavoritesTest {
    public static void main(String[] args) {
        manageFolders();
        organizeAndDeduplicateTopics();
        roundTripAndRejectDamagedData();
    }

    private static void manageFolders() {
        List<ReaderFavorites.Folder> folders = ReaderFavorites.createFolder(List.of(), " 技术  资料 ", "folder-1", 1000);
        assert folders.get(0).name().equals("技术 资料");
        folders = ReaderFavorites.renameFolder(folders, "folder-1", "稍后阅读");
        assert folders.get(0).name().equals("稍后阅读");
        try {
            ReaderFavorites.createFolder(folders, "稍后阅读", "folder-2", 2000);
            throw new AssertionError("duplicate folder name should fail");
        } catch (IllegalArgumentException expected) {
            assert expected.getMessage().contains("已存在");
        }
        assert ReaderFavorites.deleteFolder(folders, "folder-1").isEmpty();
    }

    private static void organizeAndDeduplicateTopics() {
        List<ReaderFavorites.Folder> folders = ReaderFavorites.createFolder(List.of(), "A", "folder-a", 1000);
        folders = ReaderFavorites.createFolder(folders, "B", "folder-b", 2000);
        folders = ReaderFavorites.add(folders, "folder-a", "https://linux.do/t/example/123/4?x=1", "First", 3000);
        folders = ReaderFavorites.add(folders, "folder-a", "https://linux.do/t/example/123", "Updated", 4000);
        folders = ReaderFavorites.add(folders, "folder-b", "https://linux.do/t/example/123", "Updated", 5000);
        assert folders.get(0).items().size() == 1;
        assert folders.get(0).items().get(0).title().equals("Updated");
        assert folders.get(1).items().size() == 1;
        folders = ReaderFavorites.remove(folders, "folder-a", "https://linux.do/t/example/123#post_2");
        assert folders.get(0).items().isEmpty();
        assert folders.get(1).items().size() == 1;
    }

    private static void roundTripAndRejectDamagedData() {
        List<ReaderFavorites.Folder> folders = ReaderFavorites.createFolder(List.of(), "技术", "folder-1", 1000);
        folders = ReaderFavorites.add(folders, "folder-1", "https://linux.do/t/topic/1", "主题", 2000);
        assert ReaderFavorites.parse(ReaderFavorites.serialize(folders)).equals(folders);
        assert ReaderFavorites.parse("broken\nF\t../bad\t1\t%%%\nI\tmissing\t2\t%%%\t%%%").isEmpty();
        try {
            ReaderFavorites.add(folders, "folder-1", "https://example.com/t/1", "Offsite", 3000);
            throw new AssertionError("offsite favorite should fail");
        } catch (IllegalArgumentException expected) {
            assert expected.getMessage().contains("公开");
        }
    }
}
