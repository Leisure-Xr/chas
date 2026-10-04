package studio.lexiao.linuxdo;

import com.intellij.ide.ui.UITheme;
import com.intellij.ui.JBColor;
import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the production Swing panel offscreen, using the installed IDE's theme resources. */
public final class FavoritesUiFixture {
    private static final AtomicReference<List<ReaderFavorites.Folder>> stored = new AtomicReference<>();
    private static FavoritesPanel panel;
    private static String opened;
    private static String copied;
    private static Path output;
    private static JScrollBar topicScroll;

    public static void main(String[] args) throws Exception {
        output = Path.of(args[0]);
        Files.createDirectories(output);
        String scheme = args.length > 1 ? args[1] : "light";
        UIManager.setLookAndFeel("com.intellij.ide.ui.laf.IntelliJLaf");
        String themePath = scheme.equals("dark") ? "themes/expUI/expUI_dark.theme.json" : "themes/expUI/expUI_light.theme.json";
        var loader = UITheme.class.getClassLoader();
        byte[] themeJson = Files.readAllBytes(Path.of(args[2]));
        var method = UITheme.Companion.getClass().getMethod("loadDeprecatedFromJson$intellij_platform_ide_impl", byte[].class, String.class, ClassLoader.class);
        UITheme theme = (UITheme) method.invoke(UITheme.Companion, themeJson, "favorites-qa", loader);
        theme.applyTheme(UIManager.getLookAndFeelDefaults());
        JBColor.setDark(scheme.equals("dark"));
        com.intellij.openapi.util.IconLoader.activate();
        // A normal IDE resolves Chinese text through its font service; the offscreen fixture uses a macOS font.
        Font font = new Font("PingFang SC", Font.PLAIN, 14);
        for (Object key : new ArrayList<>(UIManager.getDefaults().keySet())) {
            if (UIManager.get(key) instanceof Font) UIManager.put(key, new javax.swing.plaf.FontUIResource(font));
        }
        SwingUtilities.invokeAndWait(() -> {
            try {
                stored.set(sample());
                panel = create(stored.get());
                for (int width : new int[]{320, 480, 760}) capture(scheme + "-" + width, width, 440);
                button("新建收藏目录").doClick();
                button("保存").doClick();
                assert contains("目录名称不能为空。");
                field("目录名称").setText("职场与生活");
                button("保存").doClick();
                assert contains("收藏目录名称已存在。");
                capture(scheme + "-validation", 320, 500);
                field("目录名称").setText("新目录");
                button("保存").doClick();
                assert stored.get().size() == 3;
                assert contains("这个目录还是空的");
                field("搜索收藏").setText("毕业");
                assert contains("搜索结果 · 1 个主题");
                capture(scheme + "-search", 480, 440);
                field("搜索收藏").setText("");
                assert contains("这个目录还是空的");
                button("全部收藏 2").doClick();
                button("自愿大厂蒸馏，但是这次想聊聊自己的选择").doClick();
                assert opened.equals("https://linux.do/t/topic/100001");
                button("新建收藏目录").doClick();
                assert panel.dismissTransient();
                assert !panel.dismissTransient();
                button("职场与生活 1").doClick();
                ((JMenuItem) panel.createFolderMenu().getComponent(0)).doClick();
                field("目录名称").setText("职业话题");
                button("保存").doClick();
                assert stored.get().get(0).name().equals("职业话题");
                var entry = new FavoritesViewModel(stored.get()).rows().get(0);
                ((JMenuItem) panel.createTopicMenu(panel, entry).getComponent(1)).doClick();
                assert copied.equals(entry.item().url());
                ((JMenuItem) panel.createTopicMenu(panel, entry).getComponent(3)).doClick();
                assert stored.get().get(0).items().isEmpty();
                ((JMenuItem) panel.createFolderMenu().getComponent(1)).doClick();
                capture(scheme+"-delete",320,500);
                button("删除目录").doClick();
                assert stored.get().size()==2 && contains("全部收藏 · 1 个主题");
                panel.dispose();
                // Exercise the exact old serializer across a new panel instance (restart equivalent for the data layer).
                panel = create(ReaderFavorites.parse(ReaderFavorites.serialize(stored.get())));
                assert contains("2 个目录 · 1 个主题");
                field("搜索收藏").setText("不存在的主题");
                capture(scheme + "-no-results", 320, 440);
                assert contains("没有匹配的收藏");
                panel.dispose();
                panel = create(List.of());
                capture(scheme + "-empty", 320, 440);
                assert contains("还没有收藏主题");
                panel.dispose();
                var folders = sample();
                for (int i=2;i<30;i++) folders=ReaderFavorites.createFolder(folders,"很长的目录名称用于验证窄窗口换行以及文字省略"+i,"long"+i,i+1);
                folders=ReaderFavorites.add(folders,"work","https://linux.do/t/topic/999","很长的收藏标题需要完整悬浮提示且最多显示两行，并且不能挤压右侧菜单。".repeat(5),1791100000000L);
                panel=create(folders);
                for(int width:new int[]{320,480,760}) capture(scheme + "-30-folders-"+width,width,500);
                for (Object key : new ArrayList<>(UIManager.getDefaults().keySet())) {
                    if (UIManager.get(key) instanceof Font) UIManager.put(key,new javax.swing.plaf.FontUIResource(font.deriveFont(20f)));
                }
                SwingUtilities.updateComponentTreeUI(panel);
                capture(scheme+"-large-font",320,600);
                panel.dispose();
            } catch(Exception failure) { throw new RuntimeException(failure); }
        });
        SwingUtilities.invokeAndWait(() -> {
            try {
                var many=ReaderFavorites.createFolder(List.of(), "滚动测试", "scroll", 1);
                for(int i=1;i<=50;i++) many=ReaderFavorites.add(many,"scroll","https://linux.do/t/topic/"+i,"主题 "+i,1000+i);
                panel=create(many);
                capture(scheme+"-scroll",320,440);
                topicScroll=descendants(panel).stream().filter(c->c instanceof JScrollPane pane && pane.getViewport().getView().getClass().getSimpleName().equals("Rows"))
                        .map(c->((JScrollPane)c).getVerticalScrollBar()).findFirst().orElseThrow();
                topicScroll.setValue(180);
                var entry=new FavoritesViewModel(many).rows().get(49);
                ((JMenuItem)panel.createTopicMenu(panel,entry).getComponent(3)).doClick();
                for(int i=0;i<4;i++)layout(panel);
            }catch(Exception failure){throw new RuntimeException(failure);}
        });
        SwingUtilities.invokeAndWait(() -> {
            assert topicScroll.getValue()==180 : "Removing an item changed the scroll position";
            panel.dispose();
        });
        System.out.println("FavoritesUiFixture "+scheme+": layout matrix, forms, search, callbacks and data round trip passed");
        System.exit(0);
    }

    private static FavoritesPanel create(List<ReaderFavorites.Folder> folders) {
        return new FavoritesPanel(folders, stored::set, url->opened=url, url->copied=url, ()->{});
    }
    private static List<ReaderFavorites.Folder> sample() {
        var folders=ReaderFavorites.createFolder(List.of(),"职场与生活","work",1000);
        folders=ReaderFavorites.createFolder(folders,"稍后阅读","read",2000);
        folders=ReaderFavorites.add(folders,"work","https://linux.do/t/topic/100001","自愿大厂蒸馏，但是这次想聊聊自己的选择",1791000000000L);
        return ReaderFavorites.add(folders,"read","https://linux.do/t/topic/100002","想问一下大家毕业之后，是怎么找到方向的？",1790900000000L);
    }
    private static List<Component> descendants(Container parent) {
        List<Component> all=new ArrayList<>();
        for(Component child:parent.getComponents()) {all.add(child);if(child instanceof Container container)all.addAll(descendants(container));}
        return all;
    }
    private static AbstractButton button(String name) {
        return descendants(panel).stream().filter(c->c instanceof AbstractButton && name.equals(c.getAccessibleContext().getAccessibleName())).map(c->(AbstractButton)c).findFirst().orElseThrow(()->new AssertionError("Missing button "+name));
    }
    private static JTextField field(String name) {
        return descendants(panel).stream().filter(c->c instanceof JTextField && name.equals(c.getAccessibleContext().getAccessibleName())).map(c->(JTextField)c).findFirst().orElseThrow();
    }
    private static boolean contains(String text) {
        return descendants(panel).stream().anyMatch(c->c instanceof JLabel label && label.isVisible() && text.equals(label.getText()));
    }
    private static void layout(Container container) {container.doLayout();for(Component c:container.getComponents())if(c instanceof Container child)layout(child);}
    private static boolean visible(Component child) {
        for(Component c=child;c!=null;c=c.getParent()) if(!c.isVisible()) return false;
        return true;
    }
    private static void capture(String name,int width,int height) throws Exception {
        panel.setSize(width,height);
        for(int i=0;i<4;i++)layout(panel);
        for(Component child:descendants(panel)) {
            if(child instanceof JViewport viewport && visible(child)) {
                assert viewport.getView().getWidth() <= viewport.getWidth() : name+": horizontal overflow";
            }
            if(child instanceof AbstractButton button && visible(button)) {
                Object key=button.getClientProperty("favorite.focus");
                if(key instanceof String value && value.startsWith("open:")) {
                    assert button.getHeight() >= button.getFontMetrics(button.getFont()).getHeight()*2 : name+": second title line clipped";
                }
                assert button.getX() >= 0 : name+": button outside container: "+button.getAccessibleContext().getAccessibleName();
                assert button.getX()+button.getWidth() <= button.getParent().getWidth() : name+": clipped button "+button.getAccessibleContext().getAccessibleName();
            }
        }
        BufferedImage image=new BufferedImage(width*2,height*2,BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics=image.createGraphics();graphics.scale(2,2);panel.printAll(graphics);graphics.dispose();
        ImageIO.write(image,"png",output.resolve(name+".png").toFile());
    }
}
