package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBTextField;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefCookieManager;
import com.intellij.util.ui.JBUI;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefResourceRequestHandler;
import org.cef.handler.CefResourceRequestHandlerAdapter;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.handler.CefDisplayHandlerAdapter;
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NotNull;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.AbstractButton;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JMenuItem;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JToggleButton;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.JOptionPane;
import java.awt.BorderLayout;
import java.awt.Font;
import java.awt.FlowLayout;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

public final class LinuxDoToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        if (!JBCefApp.isSupported()) {
            JLabel message = new JLabel(
                    "LINUX DO Guest Browser requires the JetBrains Runtime with JCEF.",
                    SwingConstants.CENTER
            );
            Content content = ContentFactory.getInstance().createContent(message, "", false);
            toolWindow.getContentManager().addContent(content);
            return;
        }

        GuestBrowserPanel panel = new GuestBrowserPanel();
        Disposer.register(project, panel);
        Content content = ContentFactory.getInstance().createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);
    }

    private static final class GuestBrowserPanel extends JPanel implements Disposable {
        private static final String HOME_URL = "https://linux.do/latest";
        private static final String DOMAIN_URL = "https://linux.do/";
        private static final String TOP_URL = "https://linux.do/top";
        private static final String CATEGORIES_URL = "https://linux.do/categories";
        private static final String BREAK_REMINDER_PROPERTY = "linuxdo.guest.breakReminder.enabled";
        private static final String BREAK_ACTION_PATH = "/__lexiao_break/";
        private static final String GAME_BEST_PROPERTY = "linuxdo.guest.gameBest.";
        private static final int SNOOZE_MINUTES = 10;
        private static final String BREAK_OVERLAY_SCRIPT = loadBreakOverlayScript();
        private static final String GAME_CORE_SCRIPT = loadResourceScript("/game-core.js");
        private static final String BASE_PAGE_STYLE = """
                .login-button,
                .sign-up-button,
                .create-account,
                a[href^='/login'],
                a[href^='/signup'] {
                  display: none !important;
                }
                """;
        private static final String COMPACT_PAGE_STYLE = """
                .d-header,
                .sidebar-wrapper,
                .sidebar-container,
                .topic-footer-main-buttons,
                #reply-control,
                .post-controls .actions {
                  display: none !important;
                }

                body.has-sidebar-page #main-outlet-wrapper,
                #main-outlet-wrapper {
                  display: grid !important;
                  grid-template-columns: minmax(0, 1fr) !important;
                  padding: 0 14px !important;
                }

                #main-outlet,
                .wrap {
                  width: 100% !important;
                  max-width: 1120px !important;
                }

                #main-outlet {
                  padding-top: 12px !important;
                }

                .navigation-container,
                .category-breadcrumb,
                #topic-title {
                  margin-bottom: 8px !important;
                }

                .topic-list .topic-list-data {
                  padding-top: 8px !important;
                  padding-bottom: 8px !important;
                }

                .topic-list .main-link a.title,
                .topic-list .link-top-line a.title {
                  font-size: 14px !important;
                  font-weight: 500 !important;
                  line-height: 1.35 !important;
                }

                .topic-list .topic-excerpt {
                  display: -webkit-box !important;
                  overflow: hidden !important;
                  -webkit-box-orient: vertical !important;
                  -webkit-line-clamp: 1 !important;
                  margin-top: 3px !important;
                  font-size: 12px !important;
                  line-height: 1.35 !important;
                }

                .topic-list .posters {
                  width: 34px !important;
                }

                .topic-list .posters a:not(:first-child) {
                  display: none !important;
                }

                .topic-list .posters .avatar {
                  width: 28px !important;
                  height: 28px !important;
                }

                #topic-title h1,
                #topic-title .fancy-title {
                  font-size: 18px !important;
                  line-height: 1.35 !important;
                }

                .topic-post article {
                  padding-top: 12px !important;
                }

                .topic-body {
                  width: calc(100% - 48px) !important;
                }

                .topic-avatar {
                  width: 42px !important;
                  padding-top: 13px !important;
                }

                .topic-avatar .avatar {
                  width: 30px !important;
                  height: 30px !important;
                }

                .topic-post .contents {
                  font-size: 13px !important;
                  line-height: 1.55 !important;
                }

                .topic-post .cooked p {
                  margin-bottom: 10px !important;
                }

                .timeline-container {
                  opacity: .72 !important;
                }
                """;

        private final JBCefBrowser browser = new JBCefBrowser("about:blank");
        private final JBCefCookieManager cookieManager = browser.getJBCefCookieManager();
        private final JButton backButton = iconButton(AllIcons.Actions.Back, "返回");
        private final JButton forwardButton = iconButton(AllIcons.Actions.Forward, "前进");
        private final JButton refreshButton = iconButton(AllIcons.Actions.Refresh, "刷新");
        private final JButton resetButton = iconButton(AllIcons.Actions.Restart, "清理 Cookie 并开始新游客会话");
        private final JButton gameButton = new JButton("小游戏");
        private final JButton shareButton = new JButton("分享");
        private final JButton openShareButton = new JButton("打开分享码");
        private final JButton overflowButton = new JButton("⋯");
        private final JToggleButton compactButton = new JToggleButton("≡", true);
        private final JToggleButton breakReminderButton = new JToggleButton("休息提醒");
        private final JBTextField searchField = new JBTextField();
        private final JLabel status = new JLabel("正在启动游客会话...");
        private final JLabel brandLabel = new JLabel("LINUX DO");
        private final JLabel readOnlyLabel = new JLabel("只读");
        private final PropertiesComponent properties = PropertiesComponent.getInstance();
        private final Map<String, JToggleButton> navigationButtons = new LinkedHashMap<>();
        private volatile boolean compactMode = true;
        private volatile boolean breakOverlayVisible;
        private volatile boolean breakOverlayReminderMode;
        private volatile boolean breakReminderEnabled;
        private volatile String recommendedGame = "2048";
        private Timer breakReminderTimer;
        private volatile boolean guestSessionInitializing = true;
        private volatile String pendingNavigationUrl = HOME_URL;
        private volatile String currentPageTitle = "LINUX DO 公开主题";
        private volatile boolean disposed;

        private GuestBrowserPanel() {
            super(new BorderLayout());
            setBorder(BorderFactory.createEmptyBorder());
            add(createToolbar(), BorderLayout.NORTH);
            add(browser.getComponent(), BorderLayout.CENTER);
            installGuestOnlyNavigationGuard();
            installHistoryStateHandler();
            startGuestSession();
            setBreakReminderEnabled(properties.getBoolean(BREAK_REMINDER_PROPERTY, false), false);
        }

        private JPanel createToolbar() {
            JPanel toolbar = new JPanel(new BorderLayout(0, JBUI.scale(2)));
            toolbar.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor.border()),
                    JBUI.Borders.empty(4, 6)
            ));

            JPanel firstRow = new JPanel(new BorderLayout(JBUI.scale(8), 0));
            JPanel historyAndBrand = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 0));
            JPanel tools = new JPanel(new FlowLayout(FlowLayout.TRAILING, 4, 0));

            brandLabel.setFont(brandLabel.getFont().deriveFont(Font.BOLD, brandLabel.getFont().getSize2D() - 1f));
            readOnlyLabel.setForeground(JBColor.GRAY);
            readOnlyLabel.setFont(readOnlyLabel.getFont().deriveFont(readOnlyLabel.getFont().getSize2D() - 2f));
            readOnlyLabel.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createLineBorder(JBColor.border()),
                    JBUI.Borders.empty(1, 5)
            ));

            styleToolbarButton(backButton, "返回");
            styleToolbarButton(forwardButton, "前进");
            styleToolbarButton(refreshButton, "刷新");
            styleToolbarButton(resetButton, "清理 Cookie 并开始新游客会话");
            styleToolbarButton(compactButton, "切换紧凑/原始网页布局");
            styleToolbarButton(breakReminderButton, "随机 31-60 分钟后提醒休息");
            styleToolbarButton(gameButton, "随时打开休息小游戏");
            styleToolbarButton(shareButton, "分享当前主题");
            styleToolbarButton(openShareButton, "打开临时分享码");
            styleToolbarButton(overflowButton, "更多操作");

            backButton.setEnabled(false);
            forwardButton.setEnabled(false);
            backButton.addActionListener(event -> browser.getCefBrowser().goBack());
            forwardButton.addActionListener(event -> browser.getCefBrowser().goForward());
            refreshButton.addActionListener(event -> browser.getCefBrowser().reload());
            resetButton.addActionListener(event -> startGuestSession());
            compactButton.addActionListener(event -> {
                compactMode = compactButton.isSelected();
                applyPageStyle(browser.getCefBrowser());
            });
            breakReminderButton.addActionListener(event ->
                    setBreakReminderEnabled(breakReminderButton.isSelected(), true));
            gameButton.addActionListener(event -> showBreakGames());
            shareButton.addActionListener(event -> shareCurrentTopic());
            openShareButton.addActionListener(event -> openShareCode());
            overflowButton.addActionListener(event -> showOverflowMenu());
            shareButton.setEnabled(false);

            historyAndBrand.add(backButton);
            historyAndBrand.add(forwardButton);
            historyAndBrand.add(Box.createHorizontalStrut(4));
            historyAndBrand.add(brandLabel);
            historyAndBrand.add(readOnlyLabel);
            tools.add(compactButton);
            tools.add(breakReminderButton);
            tools.add(gameButton);
            tools.add(shareButton);
            tools.add(openShareButton);
            tools.add(refreshButton);
            tools.add(resetButton);
            tools.add(overflowButton);
            firstRow.add(historyAndBrand, BorderLayout.WEST);
            firstRow.add(tools, BorderLayout.EAST);

            JPanel secondRow = new JPanel(new BorderLayout(JBUI.scale(8), 0));
            JPanel navigation = new JPanel(new FlowLayout(FlowLayout.LEADING, 3, 0));
            navigation.add(navigationButton("最新", HOME_URL));
            navigation.add(navigationButton("热门", TOP_URL));
            navigation.add(navigationButton("分类", CATEGORIES_URL));

            searchField.getEmptyText().setText("搜索公开主题");
            searchField.setToolTipText("搜索公开主题");
            searchField.addActionListener(event -> search());
            JButton searchButton = iconButton(AllIcons.Actions.Search, "搜索");
            styleToolbarButton(searchButton, "搜索");
            searchButton.addActionListener(event -> search());
            JPanel searchPanel = new JPanel(new BorderLayout(2, 0));
            searchPanel.add(searchField, BorderLayout.CENTER);
            searchPanel.add(searchButton, BorderLayout.EAST);

            status.setForeground(JBColor.GRAY);
            status.setFont(status.getFont().deriveFont(status.getFont().getSize2D() - 2f));
            secondRow.add(navigation, BorderLayout.WEST);
            secondRow.add(searchPanel, BorderLayout.CENTER);
            secondRow.add(status, BorderLayout.EAST);

            toolbar.add(firstRow, BorderLayout.NORTH);
            toolbar.add(secondRow, BorderLayout.SOUTH);
            toolbar.addComponentListener(new ComponentAdapter() {
                @Override
                public void componentResized(ComponentEvent event) {
                    updateResponsiveToolbar(toolbar.getWidth());
                }
            });
            SwingUtilities.invokeLater(() -> updateResponsiveToolbar(toolbar.getWidth()));
            return toolbar;
        }

        private static void styleToolbarButton(AbstractButton button, String tooltip) {
            button.setFocusable(false);
            button.setToolTipText(tooltip);
            button.setMargin(JBUI.insets(2, 7));
            button.putClientProperty("JButton.buttonType", "toolBarButton");
        }

        private void updateResponsiveToolbar(int width) {
            boolean wide = width >= JBUI.scale(760);
            boolean narrow = width < JBUI.scale(520);
            brandLabel.setVisible(width >= JBUI.scale(620));
            readOnlyLabel.setVisible(width >= JBUI.scale(620));
            compactButton.setVisible(wide);
            breakReminderButton.setVisible(wide);
            gameButton.setVisible(!narrow);
            shareButton.setVisible(!narrow);
            openShareButton.setVisible(wide);
            resetButton.setVisible(wide);
            overflowButton.setVisible(!wide);
            status.setVisible(width >= JBUI.scale(820));
            gameButton.setText(wide ? "小游戏" : "游戏");
            navigationButtons.values().forEach(button -> button.setMargin(JBUI.insets(2, narrow ? 5 : 8)));
            revalidate();
            repaint();
        }

        private void showOverflowMenu() {
            JPopupMenu menu = new JPopupMenu();
            menu.add(menuAction(compactMode ? "使用原始网页布局" : "使用紧凑网页布局", compactButton::doClick));
            menu.add(menuAction(breakReminderEnabled ? "关闭休息提醒" : "开启休息提醒", breakReminderButton::doClick));
            menu.add(menuAction("打开小游戏", gameButton::doClick));
            JMenuItem shareItem = menuAction("分享当前主题", shareButton::doClick);
            shareItem.setEnabled(shareButton.isEnabled());
            menu.add(shareItem);
            menu.add(menuAction("打开临时分享码", openShareButton::doClick));
            menu.addSeparator();
            menu.add(menuAction("清理 Cookie 并重置会话", resetButton::doClick));
            menu.show(overflowButton, 0, overflowButton.getHeight());
        }

        private static JMenuItem menuAction(String label, Runnable action) {
            JMenuItem item = new JMenuItem(label);
            item.addActionListener(event -> action.run());
            return item;
        }

        private JToggleButton navigationButton(String label, String url) {
            JToggleButton button = new JToggleButton(label);
            button.setFocusable(false);
            button.setMargin(JBUI.insets(2, 8));
            button.addActionListener(event -> navigateTo(url));
            navigationButtons.put(url, button);
            return button;
        }

        private void search() {
            String query = searchField.getText().trim();
            if (query.isEmpty() || disposed) {
                return;
            }
            navigateTo("https://linux.do/search?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8));
        }

        private static JButton iconButton(javax.swing.Icon icon, String tooltip) {
            JButton button = new JButton(icon);
            button.setToolTipText(tooltip);
            button.setFocusable(false);
            return button;
        }

        private void installHistoryStateHandler() {
            browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
                @Override
                public void onTitleChange(CefBrowser cefBrowser, String title) {
                    if (title != null && !title.isBlank()) currentPageTitle = title.replaceAll("[\\r\\n]+", " ").trim();
                }
            }, browser.getCefBrowser());
            browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
                @Override
                public void onLoadingStateChange(
                        CefBrowser cefBrowser,
                        boolean isLoading,
                        boolean canGoBack,
                        boolean canGoForward
                ) {
                    SwingUtilities.invokeLater(() -> {
                        if (disposed) {
                            return;
                        }
                        backButton.setEnabled(canGoBack);
                        forwardButton.setEnabled(canGoForward);
                        refreshButton.setEnabled(!isLoading);
                        navigationButtons.values().forEach(button -> button.setEnabled(!isLoading));
                        searchField.setEnabled(!isLoading);
                        status.setText(isLoading ? "加载中..." : "游客模式");
                        updateNavigationState(cefBrowser.getURL());
                    });
                }

                @Override
                public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                    if (frame != null && frame.isMain() && httpStatusCode < 400) {
                        SwingUtilities.invokeLater(() -> updateNavigationState(cefBrowser.getURL()));
                        applyPageStyle(cefBrowser);
                        if (breakOverlayVisible) {
                            showBreakOverlay(cefBrowser);
                        }
                    }
                }
            }, browser.getCefBrowser());
        }

        private void navigateTo(String url) {
            if (disposed || !isAllowedGuestUrl(url)) return;
            if (guestSessionInitializing) {
                pendingNavigationUrl = url;
                status.setText("准备游客会话，将打开" + navigationLabel(url));
                return;
            }
            pendingNavigationUrl = null;
            CefBrowser cefBrowser = browser.getCefBrowser();
            if (samePage(cefBrowser.getURL(), url)) cefBrowser.reload();
            else cefBrowser.loadURL(url);
        }

        private void updateNavigationState(String currentUrl) {
            navigationButtons.forEach((url, button) -> button.setSelected(samePage(currentUrl, url)));
            shareButton.setEnabled(ShareCode.fromTopicUrl(currentUrl, safeCurrentTitle()) != null);
        }

        private String navigationLabel(String url) {
            if (samePage(url, TOP_URL)) return "热门";
            if (samePage(url, CATEGORIES_URL)) return "分类";
            if (url != null && url.startsWith("https://linux.do/search")) return "搜索结果";
            return "最新";
        }

        private static boolean samePage(String left, String right) {
            if (left == null || right == null) return false;
            try {
                URI leftUri = URI.create(left);
                URI rightUri = URI.create(right);
                String leftPath = leftUri.getPath() == null ? "/" : leftUri.getPath().replaceAll("/$", "");
                String rightPath = rightUri.getPath() == null ? "/" : rightUri.getPath().replaceAll("/$", "");
                return leftPath.equalsIgnoreCase(rightPath) && String.valueOf(leftUri.getQuery()).equals(String.valueOf(rightUri.getQuery()));
            } catch (IllegalArgumentException ignored) {
                return left.equals(right);
            }
        }

        private String safeCurrentTitle() {
            String title = currentPageTitle == null ? "" : currentPageTitle.replaceAll("\\s+-\\s+LINUX DO.*$", "").trim();
            return title.isEmpty() ? "LINUX DO 公开主题" : title.substring(0, Math.min(200, title.length()));
        }

        private void shareCurrentTopic() {
            ShareCode.Topic topic = ShareCode.fromTopicUrl(browser.getCefBrowser().getURL(), safeCurrentTitle());
            if (topic == null) {
                status.setText("请先打开一个主题");
                return;
            }
            String[] choices = {"10 分钟", "1 小时", "24 小时", "7 天"};
            Object selected = JOptionPane.showInputDialog(this, "选择分享码有效期", "分享当前主题",
                    JOptionPane.PLAIN_MESSAGE, null, choices, choices[1]);
            if (selected == null) return;
            long duration = switch (selected.toString()) {
                case "10 分钟" -> TimeUnit.MINUTES.toMillis(10);
                case "24 小时" -> TimeUnit.HOURS.toMillis(24);
                case "7 天" -> TimeUnit.DAYS.toMillis(7);
                default -> TimeUnit.HOURS.toMillis(1);
            };
            long now = System.currentTimeMillis();
            String code = ShareCode.create(topic, duration, now);
            CopyPasteManager.getInstance().setContents(new StringSelection(code));
            String expiry = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                    .withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(now + duration));
            status.setText("分享码已复制，" + expiry + " 失效");
        }

        private void openShareCode() {
            String clipboard = CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor);
            String initialValue = clipboard != null && clipboard.trim().startsWith("LDGS1.") ? clipboard.trim() : "";
            Object input = JOptionPane.showInputDialog(this, "粘贴 LDGS1 临时分享码", "打开临时分享码",
                    JOptionPane.PLAIN_MESSAGE, null, null, initialValue);
            if (input == null) return;
            try {
                ShareCode.Decoded decoded = ShareCode.parse(input.toString(), System.currentTimeMillis());
                navigateTo(decoded.topic().url());
            } catch (IllegalArgumentException error) {
                JOptionPane.showMessageDialog(this, error.getMessage(), "无法打开分享码", JOptionPane.ERROR_MESSAGE);
            }
        }

        private void applyPageStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) {
                return;
            }
            String css = BASE_PAGE_STYLE + (compactMode ? COMPACT_PAGE_STYLE : "");
            String script = "(function(){"
                    + "var id='lexiao-guest-reader-style';"
                    + "var style=document.getElementById(id);"
                    + "if(!style){style=document.createElement('style');style.id=id;document.head.appendChild(style);}"
                    + "style.textContent=\"" + escapeJavaScript(css) + "\";"
                    + "})();";
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private static String escapeJavaScript(String value) {
            return value
                    .replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\r", "")
                    .replace("\n", "\\n");
        }

        private void installGuestOnlyNavigationGuard() {
            CefResourceRequestHandler authenticationBlocker = new CefResourceRequestHandlerAdapter() {
                @Override
                public boolean onBeforeResourceLoad(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        CefRequest request
                ) {
                    SwingUtilities.invokeLater(() -> status.setText("已阻止登录请求"));
                    return true;
                }
            };

            browser.getJBCefClient().addRequestHandler(new CefRequestHandlerAdapter() {
                @Override
                public boolean onBeforeBrowse(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        CefRequest request,
                        boolean userGesture,
                        boolean isRedirect
                ) {
                    if (frame == null || !frame.isMain()) {
                        return false;
                    }

                    String url = request.getURL();
                    if (handleBreakAction(url)) {
                        return true;
                    }
                    if (isAllowedGuestUrl(url)) {
                        SwingUtilities.invokeLater(() -> status.setText("游客模式"));
                        return false;
                    }

                    SwingUtilities.invokeLater(() -> status.setText("已阻止站外或登录页面"));
                    return true;
                }

                @Override
                public CefResourceRequestHandler getResourceRequestHandler(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        CefRequest request,
                        boolean isNavigation,
                        boolean isDownload,
                        String requestInitiator,
                        BoolRef disableDefaultHandling
                ) {
                    return isAuthenticationWrite(request) ? authenticationBlocker : null;
                }
            }, browser.getCefBrowser());
        }

        private boolean handleBreakAction(String url) {
            try {
                URI uri = URI.create(url);
                if (!"linux.do".equalsIgnoreCase(uri.getHost()) || uri.getPath() == null
                        || !uri.getPath().startsWith(BREAK_ACTION_PATH)) {
                    return false;
                }

                String action = uri.getPath().substring(BREAK_ACTION_PATH.length());
                SwingUtilities.invokeLater(() -> {
                    if ("snooze".equals(action)) {
                        finishBreak(true);
                    } else if ("continue".equals(action)) {
                        finishBreak(false);
                    } else if ("score".equals(action)) {
                        saveGameScore(uri.getQuery());
                    }
                });
                return true;
            } catch (IllegalArgumentException ignored) {
                return false;
            }
        }

        private void saveGameScore(String query) {
            if (query == null) return;
            String game = null;
            int value = -1;
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                if (separator <= 0) continue;
                String key = java.net.URLDecoder.decode(part.substring(0, separator), StandardCharsets.UTF_8);
                String itemValue = java.net.URLDecoder.decode(part.substring(separator + 1), StandardCharsets.UTF_8);
                if ("game".equals(key)) game = itemValue;
                if ("value".equals(key)) {
                    try { value = Integer.parseInt(itemValue); } catch (NumberFormatException ignored) { value = -1; }
                }
            }
            if ("dodge".equals(game)) game = "racer";
            if ("runner".equals(game)) game = "jumper";
            if (game != null && game.matches("2048|snake|racer|jumper|mines") && value >= 0) {
                int previous = properties.getInt(GAME_BEST_PROPERTY + game, 0);
                if (value > previous) properties.setValue(GAME_BEST_PROPERTY + game, value, 0);
            }
        }

        private void setBreakReminderEnabled(boolean enabled, boolean persist) {
            breakReminderEnabled = enabled;
            breakReminderButton.setSelected(enabled);
            if (persist) {
                properties.setValue(BREAK_REMINDER_PROPERTY, enabled, false);
            }

            stopBreakTimer();
            if (enabled) {
                scheduleBreakReminder(31, 60);
                status.setText("休息提醒已开启");
            } else {
                breakOverlayVisible = false;
                removeBreakOverlay();
                status.setText("休息提醒已关闭");
            }
        }

        private void scheduleBreakReminder(int minimumMinutes, int maximumMinutes) {
            stopBreakTimer();
            if (!breakReminderEnabled || disposed) {
                return;
            }

            int minutes = ThreadLocalRandom.current().nextInt(minimumMinutes, maximumMinutes + 1);
            breakReminderTimer = new Timer((int) TimeUnit.MINUTES.toMillis(minutes), event -> {
                breakReminderTimer = null;
                showBreakReminder();
            });
            breakReminderTimer.setRepeats(false);
            breakReminderTimer.start();
            breakReminderButton.setToolTipText("休息提醒已开启；下一次约 " + minutes + " 分钟后");
        }

        private void stopBreakTimer() {
            if (breakReminderTimer != null) {
                breakReminderTimer.stop();
                breakReminderTimer = null;
            }
        }

        private void showBreakReminder() {
            if (!breakReminderEnabled || disposed) {
                return;
            }
            String[] games = {"2048", "snake", "racer", "jumper", "mines"};
            recommendedGame = games[ThreadLocalRandom.current().nextInt(games.length)];
            breakOverlayVisible = true;
            breakOverlayReminderMode = true;
            status.setText("该休息一下了");
            showBreakOverlay(browser.getCefBrowser());
        }

        private void showBreakGames() {
            if (disposed) {
                return;
            }
            String[] games = {"2048", "snake", "racer", "jumper", "mines"};
            recommendedGame = games[ThreadLocalRandom.current().nextInt(games.length)];
            breakOverlayVisible = true;
            breakOverlayReminderMode = false;
            showBreakOverlay(browser.getCefBrowser());
        }

        private void showBreakOverlay(CefBrowser cefBrowser) {
            if (disposed || !breakOverlayVisible || cefBrowser == null) {
                return;
            }
            String script = GAME_CORE_SCRIPT + "\n" + BREAK_OVERLAY_SCRIPT.replace(
                    "__LEXIAO_RECOMMENDED_GAME__",
                    "\"" + escapeJavaScript(recommendedGame) + "\""
            ).replace("__LEXIAO_REMINDER_MODE__", Boolean.toString(breakOverlayReminderMode))
                    .replace("__LEXIAO_BEST_SCORES__", gameBestScoresJson());
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private String gameBestScoresJson() {
            String[] games = {"2048", "snake", "racer", "jumper", "mines"};
            StringBuilder json = new StringBuilder("{");
            for (int index = 0; index < games.length; index += 1) {
                if (index > 0) json.append(',');
                String legacy = "racer".equals(games[index]) ? "dodge"
                        : "jumper".equals(games[index]) ? "runner" : games[index];
                int score = Math.max(
                        properties.getInt(GAME_BEST_PROPERTY + games[index], 0),
                        properties.getInt(GAME_BEST_PROPERTY + legacy, 0)
                );
                if (score > properties.getInt(GAME_BEST_PROPERTY + games[index], 0)) {
                    properties.setValue(GAME_BEST_PROPERTY + games[index], score, 0);
                }
                json.append('"').append(games[index]).append("\":").append(Math.max(0, score));
            }
            return json.append('}').toString();
        }

        private void finishBreak(boolean snooze) {
            breakOverlayVisible = false;
            removeBreakOverlay();
            if (breakReminderEnabled) {
                if (snooze) {
                    scheduleBreakReminder(SNOOZE_MINUTES, SNOOZE_MINUTES);
                    status.setText("将在 10 分钟后再提醒");
                } else {
                    scheduleBreakReminder(31, 60);
                    status.setText("游客模式");
                }
            }
        }

        private void removeBreakOverlay() {
            if (disposed) {
                return;
            }
            CefBrowser cefBrowser = browser.getCefBrowser();
            String script = "if(window.__lexiaoBreakCleanup){window.__lexiaoBreakCleanup();}"
                    + "var overlay=document.getElementById('lexiao-break-overlay');"
                    + "if(overlay){overlay.remove();}";
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private static String loadBreakOverlayScript() {
            return loadResourceScript("/break-overlay.js");
        }

        private static String loadResourceScript(String name) {
            try (InputStream input = LinuxDoToolWindowFactory.class.getResourceAsStream(name)) {
                if (input == null) {
                    throw new IllegalStateException("Missing resource " + name);
                }
                return new String(input.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException error) {
                throw new IllegalStateException("Cannot load resource " + name, error);
            }
        }

        private static boolean isAuthenticationWrite(CefRequest request) {
            String method = request.getMethod();
            if (method == null || method.equalsIgnoreCase("GET") || method.equalsIgnoreCase("HEAD")) {
                return false;
            }

            try {
                URI uri = URI.create(request.getURL());
                String host = uri.getHost();
                String path = uri.getPath() == null ? "/" : uri.getPath().toLowerCase();
                boolean linuxDoHost = "linux.do".equalsIgnoreCase(host)
                        || (host != null && host.toLowerCase().endsWith(".linux.do"));
                if (!linuxDoHost) {
                    return false;
                }

                return path.equals("/session")
                        || path.startsWith("/session/")
                        || path.equals("/users")
                        || path.startsWith("/users/")
                        || path.equals("/auth")
                        || path.startsWith("/auth/")
                        || path.equals("/oauth2")
                        || path.startsWith("/oauth2/")
                        || path.equals("/user-api-key")
                        || path.startsWith("/user-api-key/");
            } catch (IllegalArgumentException ignored) {
                return true;
            }
        }

        private static boolean isAllowedGuestUrl(String url) {
            if (url == null || url.equals("about:blank")) {
                return true;
            }

            try {
                URI uri = URI.create(url);
                String host = uri.getHost();
                String path = uri.getPath() == null ? "/" : uri.getPath().toLowerCase();
                boolean linuxDoHost = "linux.do".equalsIgnoreCase(host)
                        || (host != null && host.toLowerCase().endsWith(".linux.do"));
                if (!linuxDoHost) {
                    return false;
                }

                return !path.equals("/login")
                        && !path.startsWith("/login/")
                        && !path.equals("/signup")
                        && !path.startsWith("/signup/")
                        && !path.equals("/session")
                        && !path.startsWith("/session/")
                        && !path.equals("/auth")
                        && !path.startsWith("/auth/")
                        && !path.equals("/oauth2")
                        && !path.startsWith("/oauth2/");
            } catch (IllegalArgumentException ignored) {
                return false;
            }
        }

        private void startGuestSession() {
            guestSessionInitializing = true;
            pendingNavigationUrl = HOME_URL;
            status.setText("正在清理游客会话...");
            clearLinuxDoCookies(() -> {
                guestSessionInitializing = false;
                status.setText("游客模式");
                String target = pendingNavigationUrl == null ? HOME_URL : pendingNavigationUrl;
                pendingNavigationUrl = null;
                navigateTo(target);
            });
        }

        private void loadHome() {
            if (!disposed) {
                navigateTo(HOME_URL);
            }
        }

        private void clearLinuxDoCookies(Runnable afterClear) {
            CompletableFuture.runAsync(() -> {
                try {
                    Future<Boolean> deletion = cookieManager.deleteCookies(DOMAIN_URL, null);
                    deletion.get(10, TimeUnit.SECONDS);
                } catch (Exception ignored) {
                    // A failed cleanup must not freeze the IDE; navigation remains auth-blocked.
                }
            }).whenComplete((unused, error) -> SwingUtilities.invokeLater(() -> {
                if (!disposed) {
                    afterClear.run();
                }
            }));
        }

        @Override
        public void dispose() {
            stopBreakTimer();
            breakOverlayVisible = false;
            removeBreakOverlay();
            disposed = true;
            try {
                cookieManager.deleteCookies(DOMAIN_URL, null);
            } finally {
                browser.dispose();
            }
        }
    }
}
