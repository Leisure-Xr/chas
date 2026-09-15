package studio.lexiao.linuxdo;

import java.awt.Color;

public final class IdeThemePaletteTest {
    public static void main(String[] args) {
        serializeLightPaletteForReaderAndGameUi();
        serializeDarkPaletteAndChooseReadableAccentText();
        tolerateMissingLookAndFeelColors();
    }

    private static void serializeLightPaletteForReaderAndGameUi() {
        IdeThemePalette palette = IdeThemePalette.create(
                new Color(0xf2f2f2),
                Color.WHITE,
                new Color(0x202020),
                new Color(0x6b6b6b),
                new Color(0xc8c8c8),
                new Color(0x2468a2)
        );
        String css = palette.applyToReaderCss("""
                body { color-scheme: __LEX_IDE_SCHEME__; color: __LEX_IDE_TEXT__;
                  background: __LEX_IDE_BG__; border-color: __LEX_IDE_BORDER__;
                  --panel: __LEX_IDE_PANEL__; --soft: __LEX_IDE_SOFT__;
                  --muted: __LEX_IDE_MUTED__; --accent: __LEX_IDE_ACCENT__; }
                """);
        require(!palette.dark(), "light palette classified as dark");
        require(css.contains("color-scheme: light"), "light scheme missing");
        require(css.contains("#f2f2f2") && css.contains("#ffffff"), "light backgrounds missing");
        require(!css.contains("__LEX_IDE_"), "reader placeholder was not resolved");
        require(palette.gameThemeJson().contains("\"scheme\":\"light\""), "light game scheme missing");
        require(IdeThemePalette.contrastRatio(palette.muted(), palette.background()) >= 4.5,
                "light muted text is too faint on the page background");
        require(IdeThemePalette.contrastRatio(palette.muted(), palette.panel()) >= 4.5,
                "light muted text is too faint on the panel background");
    }

    private static void serializeDarkPaletteAndChooseReadableAccentText() {
        IdeThemePalette palette = IdeThemePalette.create(
                new Color(0x2b2d30),
                new Color(0x1e1f22),
                new Color(0xdfe1e5),
                new Color(0x9da0a8),
                new Color(0x43454a),
                new Color(0x3574f0)
        );
        String json = palette.gameThemeJson();
        require(palette.dark(), "dark palette classified as light");
        require(json.contains("\"background\":\"#2b2d30\""), "dark background missing");
        require(json.contains("\"scheme\":\"dark\""), "dark game scheme missing");
        require(IdeThemePalette.contrastRatio(palette.muted(), palette.background()) >= 4.5,
                "dark muted text is too faint on the page background");
        require(IdeThemePalette.contrastRatio(palette.muted(), palette.panel()) >= 4.5,
                "dark muted text is too faint on the panel background");
        require(json.matches("\\{(?:\"[A-Za-z]+\":\"(?:#[0-9a-f]{6}|rgba\\([0-9,.]+\\)|dark|light)\",?)+}"),
                "game theme contains an unsafe value: " + json);
    }

    private static void tolerateMissingLookAndFeelColors() {
        IdeThemePalette palette = IdeThemePalette.create(null, null, null, null, null, null);
        require(palette.background().equals(Color.WHITE), "missing background fallback changed");
        require(palette.panel().equals(Color.WHITE), "missing panel fallback changed");
        require(palette.text().equals(Color.BLACK), "missing text fallback changed");
        require(palette.gameThemeJson().contains("\"accentText\""), "accent contrast color missing");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
