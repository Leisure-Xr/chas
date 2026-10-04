package studio.lexiao.linuxdo;

import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.util.List;

public final class FavoritesPanelTest {
    public static void main(String[] args) {
        BufferedImage image = new BufferedImage(760, 200, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        for (int fontSize : new int[]{13, 18, 26}) {
            FontMetrics metrics = graphics.getFontMetrics(new Font(Font.DIALOG, Font.PLAIN, fontSize));
            for (int width : new int[]{180, 340, 600}) {
                String title = "很长的收藏主题：Java、数据库与职业选择😀".repeat(8);
                List<String> lines = FavoritesPanel.wrapTitle(title, metrics, width);
                assert lines.size() == 2;
                assert lines.get(1).endsWith("…");
                for (String line : lines) {
                    assert metrics.stringWidth(line) <= width;
                    assert !Character.isHighSurrogate(line.charAt(line.length() - 1));
                }
            }
            assert FavoritesPanel.wrapTitle("短标题", metrics, 300).equals(List.of("短标题"));
        }
        graphics.dispose();
        System.out.println("FavoritesPanelTest passed");
    }
}
