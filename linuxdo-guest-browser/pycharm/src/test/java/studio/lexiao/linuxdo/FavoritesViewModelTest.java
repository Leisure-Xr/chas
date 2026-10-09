package studio.lexiao.linuxdo;

import java.util.List;

public final class FavoritesViewModelTest {
    public static void main(String[] args) {
        List<ReaderFavorites.Folder> folders = ReaderFavorites.createFolder(List.of(), "技术", "a", 1);
        folders = ReaderFavorites.createFolder(folders, "稍后阅读", "b", 2);
        folders = ReaderFavorites.add(folders, "a", "https://linux.do/t/topic/123", "Java 入门", 3);
        folders = ReaderFavorites.add(folders, "b", "https://linux.do/t/topic/123", "Java 入门", 4);
        folders = ReaderFavorites.add(folders, "a", "https://linux.do/t/topic/456", "数据库", 5);
        FavoritesViewModel model = new FavoritesViewModel(ReaderFavorites.parse(ReaderFavorites.serialize(folders)));
        assert model.selectedId() == null;
        assert model.rows().size() == 3;
        assert model.rows().get(0).item().title().equals("数据库");
        assert model.rows().get(1).folder().id().equals("b");
        assert model.rows().get(0).siteName().equals("LINUX DO");
        model.search("linux do");
        assert model.rows().size() == 3;
        model.search("");
        model.select("a");
        assert model.rows().size() == 2;
        model.search("稍后");
        assert model.rows().size() == 1 && model.rows().get(0).folder().id().equals("b");
        assert model.selectedId().equals("a");
        model.search("  JAVA  ");
        assert model.rows().size() == 2;
        model.search("456");
        assert model.rows().size() == 1;
        model.search("missing");
        assert model.rows().isEmpty();
        model.search("");
        assert model.rows().size() == 2;
        model.replace(ReaderFavorites.renameFolder(model.folders(), "a", "编程"));
        assert model.selected().name().equals("编程");
        model.search("java");
        model.replace(ReaderFavorites.remove(model.folders(), "a", "https://linux.do/t/topic/123"));
        assert model.query().equals("java") && model.selectedId().equals("a");
        assert model.rows().size() == 1 && model.rows().get(0).folder().id().equals("b");
        model.replace(ReaderFavorites.deleteFolder(model.folders(), "a"));
        assert model.selectedId() == null && model.rows().size() == 1;
        model.replace(ReaderFavorites.parse(ReaderFavorites.serialize(model.folders())));
        assert model.rows().get(0).item().url().equals("https://linux.do/t/topic/123");
        model.replace(List.of());
        assert model.rows().isEmpty() && model.total() == 0;
        System.out.println("FavoritesViewModelTest passed");
    }
}
