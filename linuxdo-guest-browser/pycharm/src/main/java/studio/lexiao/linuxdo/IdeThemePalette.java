package studio.lexiao.linuxdo;

import com.intellij.ui.JBColor;
import com.intellij.util.ui.UIUtil;

import javax.swing.UIManager;
import java.awt.Color;
import java.util.Locale;

record IdeThemePalette(
        Color background,
        Color panel,
        Color text,
        Color muted,
        Color border,
        Color accent,
        Color accentText,
        Color soft,
        Color hover,
        boolean dark
) {
    static IdeThemePalette current() {
        Color background = color("Panel.background", UIUtil.getPanelBackground());
        Color panel = color("TextField.background", background);
        Color text = color("Label.foreground", UIUtil.getLabelForeground());
        Color muted = color("Label.disabledForeground", JBColor.GRAY);
        Color border = color("Component.borderColor", JBColor.border());
        Color accent = color(
                "Link.activeForeground",
                JBColor.namedColor("Link.activeForeground", new JBColor(0x2474A8, 0x589DF6))
        );
        return create(background, panel, text, muted, border, accent);
    }

    static IdeThemePalette create(
            Color background,
            Color panel,
            Color text,
            Color muted,
            Color border,
            Color accent
    ) {
        Color resolvedBackground = opaque(background, Color.WHITE);
        Color resolvedPanel = opaque(panel, resolvedBackground);
        Color resolvedText = opaque(text, Color.BLACK);
        Color resolvedMuted = ensureContrast(
                opaque(muted, mix(resolvedBackground, resolvedText, 0.58)),
                resolvedText,
                4.5,
                resolvedBackground,
                resolvedPanel
        );
        Color resolvedBorder = opaque(border, mix(resolvedBackground, resolvedText, 0.22));
        Color resolvedAccent = opaque(accent, resolvedText);
        boolean dark = relativeLuminance(resolvedBackground) < 0.45;
        return new IdeThemePalette(
                resolvedBackground,
                resolvedPanel,
                resolvedText,
                resolvedMuted,
                resolvedBorder,
                resolvedAccent,
                contrastText(resolvedAccent),
                mix(resolvedBackground, resolvedText, dark ? 0.10 : 0.055),
                mix(resolvedBackground, resolvedText, dark ? 0.16 : 0.10),
                dark
        );
    }

    String applyToReaderCss(String css) {
        return css
                .replace("__LEX_IDE_BG__", hex(background))
                .replace("__LEX_IDE_PANEL__", hex(panel))
                .replace("__LEX_IDE_SOFT__", hex(soft))
                .replace("__LEX_IDE_BORDER__", hex(border))
                .replace("__LEX_IDE_TEXT__", hex(text))
                .replace("__LEX_IDE_MUTED__", hex(muted))
                .replace("__LEX_IDE_ACCENT__", hex(accent))
                .replace("__LEX_IDE_SCHEME__", dark ? "dark" : "light");
    }

    String gameThemeJson() {
        return "{"
                + "\"background\":\"" + hex(background) + "\","
                + "\"panel\":\"" + hex(panel) + "\","
                + "\"text\":\"" + hex(text) + "\","
                + "\"muted\":\"" + hex(muted) + "\","
                + "\"line\":\"" + hex(border) + "\","
                + "\"accent\":\"" + hex(accent) + "\","
                + "\"accentText\":\"" + hex(accentText) + "\","
                + "\"soft\":\"" + hex(soft) + "\","
                + "\"hover\":\"" + hex(hover) + "\","
                + "\"overlay\":\"" + rgba(background, dark ? 0.88 : 0.84) + "\","
                + "\"state\":\"" + rgba(panel, 0.97) + "\","
                + "\"scheme\":\"" + (dark ? "dark" : "light") + "\""
                + "}";
    }

    private static Color color(String key, Color fallback) {
        return opaque(UIManager.getColor(key), fallback);
    }

    private static Color opaque(Color value, Color fallback) {
        Color resolved = value == null ? fallback : value;
        if (resolved == null) resolved = Color.GRAY;
        return new Color(resolved.getRed(), resolved.getGreen(), resolved.getBlue());
    }

    private static Color mix(Color background, Color foreground, double foregroundWeight) {
        double weight = Math.max(0, Math.min(1, foregroundWeight));
        double backgroundWeight = 1 - weight;
        return new Color(
                (int) Math.round(background.getRed() * backgroundWeight + foreground.getRed() * weight),
                (int) Math.round(background.getGreen() * backgroundWeight + foreground.getGreen() * weight),
                (int) Math.round(background.getBlue() * backgroundWeight + foreground.getBlue() * weight)
        );
    }

    private static Color contrastText(Color background) {
        double blackContrast = (relativeLuminance(background) + 0.05) / 0.05;
        double whiteContrast = 1.05 / (relativeLuminance(background) + 0.05);
        return whiteContrast >= blackContrast ? Color.WHITE : Color.BLACK;
    }

    static double contrastRatio(Color foreground, Color background) {
        double foregroundLuminance = relativeLuminance(foreground);
        double backgroundLuminance = relativeLuminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
                / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    }

    private static Color ensureContrast(
            Color candidate,
            Color preferred,
            double minimumRatio,
            Color... backgrounds
    ) {
        if (minimumContrast(candidate, backgrounds) >= minimumRatio) return candidate;
        Color target = minimumContrast(preferred, backgrounds) >= minimumRatio
                ? preferred
                : bestContrastTarget(backgrounds);
        for (int step = 1; step <= 100; step++) {
            Color adjusted = mix(candidate, target, step / 100.0);
            if (minimumContrast(adjusted, backgrounds) >= minimumRatio) return adjusted;
        }
        return target;
    }

    private static double minimumContrast(Color foreground, Color... backgrounds) {
        double minimum = Double.POSITIVE_INFINITY;
        for (Color background : backgrounds) {
            minimum = Math.min(minimum, contrastRatio(foreground, background));
        }
        return minimum;
    }

    private static Color bestContrastTarget(Color... backgrounds) {
        return minimumContrast(Color.WHITE, backgrounds) >= minimumContrast(Color.BLACK, backgrounds)
                ? Color.WHITE
                : Color.BLACK;
    }

    private static double relativeLuminance(Color color) {
        return 0.2126 * linear(color.getRed())
                + 0.7152 * linear(color.getGreen())
                + 0.0722 * linear(color.getBlue());
    }

    private static double linear(int component) {
        double value = component / 255.0;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }

    private static String hex(Color color) {
        return String.format(Locale.ROOT, "#%02x%02x%02x", color.getRed(), color.getGreen(), color.getBlue());
    }

    private static String rgba(Color color, double alpha) {
        return String.format(
                Locale.ROOT,
                "rgba(%d,%d,%d,%.2f)",
                color.getRed(),
                color.getGreen(),
                color.getBlue(),
                alpha
        );
    }
}
