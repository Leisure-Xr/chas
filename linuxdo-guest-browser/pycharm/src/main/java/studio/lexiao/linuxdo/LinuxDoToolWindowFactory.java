package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopup;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.JBColor;
import com.intellij.ui.SearchTextField;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
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
import org.cef.handler.CefLoadHandler.ErrorCode;
import org.cef.handler.CefDisplayHandlerAdapter;
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NotNull;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.AbstractButton;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JMenuItem;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JPopupMenu;
import javax.swing.JToggleButton;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.JOptionPane;
import javax.swing.ScrollPaneConstants;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.BorderLayout;
import java.awt.Dimension;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
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
        private static final String DEMO_MODE_PROPERTY = "linuxdo.guest.demoMode.enabled";
        private static final String HISTORY_PROPERTY = "linuxdo.guest.readerHistory";
        private static final String BREAK_ACTION_PATH = "/__lexiao_break/";
        private static final String GAME_BEST_PROPERTY = "linuxdo.guest.gameBest.";
        private static final int SNOOZE_MINUTES = 10;
        private static final String BREAK_OVERLAY_SCRIPT = loadBreakOverlayScript();
        private static final String GAME_CORE_SCRIPT = loadResourceScript("/game-core.js");
        private static final String GAME_UI_SCRIPT = loadResourceScript("/game-ui.js");
        private static final String DEMO_PAGE_STYLE = loadResourceScript("/reader-mode.css");
        private static final String READER_MODE_SCRIPT = loadResourceScript("/reader-mode.js");
        private static final String BASE_PAGE_STYLE = """
                .login-button,
                .sign-up-button,
                .create-account,
                a[href^='/login'],
                a[href^='/signup'] {
                  display: none !important;
                }
                """;
        private static final String DEMO_LOADING_STYLE = """
                #main-outlet img, #main-outlet svg, #main-outlet video, #main-outlet .emoji,
                .avatar, .avatar-flair, .topic-avatar, .topic-avatar img, .topic-list .posters,
                .user-card, .user-card-avatar, .user-card-avatar img, .names .user-title,
                .names .user-status, .names .badge-wrapper, .names .badge-grouping,
                .names .poster-icon, .names .full-name,
                .topic-post .names .user-title, .topic-post .names .user-status,
                .lightbox-controls, .image-controls, .image-overlay, .image-toolbar,
                .lightbox-wrapper .meta, .lightbox-wrapper button,
                .lightbox-wrapper [role='button'], [data-image-toolbar],
                [data-download-image] {
                  visibility: hidden !important;
                }
                #main-outlet .topic-post .cooked img:not(.emoji),
                #main-outlet .topic-post .cooked svg,
                #main-outlet .topic-post .cooked video {
                  visibility: visible !important;
                }
                """;
        private final JBCefBrowser browser = new JBCefBrowser("about:blank");
        private final JBCefCookieManager cookieManager = browser.getJBCefCookieManager();
        private final JButton backButton = iconButton(AllIcons.Actions.Back, "返回");
        private final JButton forwardButton = iconButton(AllIcons.Actions.Forward, "前进");
        private final JButton refreshButton = iconButton(AllIcons.Actions.Refresh, "刷新");
        private final JButton resetButton = iconButton(AllIcons.Actions.Restart, "清理 Cookie 并开始新游客会话");
        private final JButton historyButton = iconButton(AllIcons.Vcs.History, "浏览历史");
        private final JButton gameButton = new JButton("小游戏");
        private final JButton shareButton = new JButton("分享");
        private final JButton openShareButton = new JButton("打开加密分享");
        private final JButton overflowButton = new JButton("⋯");
        private final JToggleButton demoButton = new JToggleButton("</>");
        private final JToggleButton breakReminderButton = new JToggleButton("休息提醒");
        private final JBTextField searchField = new JBTextField();
        private final JLabel status = new JLabel("正在启动游客会话...");
        private final PropertiesComponent properties = PropertiesComponent.getInstance();
        private final List<ReaderHistory.Entry> browsingHistory = new ArrayList<>(
                ReaderHistory.parse(properties.getValue(HISTORY_PROPERTY))
        );
        private final Map<String, JToggleButton> navigationButtons = new LinkedHashMap<>();
        private volatile boolean demoMode = properties.getBoolean(DEMO_MODE_PROPERTY, true);
        private volatile boolean breakOverlayVisible;
        private volatile boolean breakOverlayReminderMode;
        private volatile boolean breakReminderEnabled;
        private volatile String recommendedGame = "2048";
        private Timer breakReminderTimer;
        private volatile boolean guestSessionInitializing = true;
        private volatile String pendingNavigationUrl = HOME_URL;
        private volatile String currentPageTitle = "LINUX DO 公开主题";
        private volatile boolean mainLoadFailed;
        private JBPopup historyPopup;
        private volatile boolean disposed;

        private record ShareSettings(long duration, String password) {}

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
            JPanel navigationControls = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 0));
            JPanel tools = new JPanel(new FlowLayout(FlowLayout.TRAILING, 4, 0));

            styleToolbarButton(backButton, "返回");
            styleToolbarButton(forwardButton, "前进");
            styleToolbarButton(historyButton, "浏览最近访问的公开页面");
            styleToolbarButton(refreshButton, "刷新");
            styleToolbarButton(resetButton, "清理 Cookie 并开始新游客会话");
            styleToolbarButton(demoButton, "切换隐私阅读/原始网页布局");
            styleToolbarButton(breakReminderButton, "随机 31-60 分钟后提醒休息");
            styleToolbarButton(gameButton, "随时打开休息小游戏");
            styleToolbarButton(shareButton, "分享当前主题");
            styleToolbarButton(openShareButton, "打开加密分享");
            styleToolbarButton(overflowButton, "更多操作");

            backButton.setEnabled(false);
            forwardButton.setEnabled(false);
            historyButton.setEnabled(!browsingHistory.isEmpty());
            demoButton.setSelected(demoMode);
            backButton.addActionListener(event -> browser.getCefBrowser().goBack());
            forwardButton.addActionListener(event -> browser.getCefBrowser().goForward());
            historyButton.addActionListener(event -> showHistoryPopup());
            refreshButton.addActionListener(event -> browser.getCefBrowser().reload());
            resetButton.addActionListener(event -> startGuestSession());
            demoButton.addActionListener(event -> {
                demoMode = demoButton.isSelected();
                properties.setValue(DEMO_MODE_PROPERTY, demoMode, true);
                applyPageStyle(browser.getCefBrowser());
            });
            breakReminderButton.addActionListener(event ->
                    setBreakReminderEnabled(breakReminderButton.isSelected(), true));
            gameButton.addActionListener(event -> showBreakGames());
            shareButton.addActionListener(event -> shareCurrentTopic());
            openShareButton.addActionListener(event -> openShareCode());
            overflowButton.addActionListener(event -> showOverflowMenu());
            shareButton.setEnabled(false);

            navigationControls.add(backButton);
            navigationControls.add(forwardButton);
            navigationControls.add(refreshButton);
            tools.add(overflowButton);
            firstRow.add(navigationControls, BorderLayout.WEST);
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
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigation, searchPanel);
                }
            });
            addComponentListener(new ComponentAdapter() {
                @Override
                public void componentResized(ComponentEvent event) {
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigation, searchPanel);
                }
            });
            SwingUtilities.invokeLater(() ->
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigation, searchPanel));
            return toolbar;
        }

        private int availableToolbarWidth(JPanel toolbar) {
            int visibleWidth = toolbar.getVisibleRect().width;
            int panelWidth = getWidth();
            if (visibleWidth > 0 && panelWidth > 0) return Math.min(visibleWidth, panelWidth);
            if (panelWidth > 0) return panelWidth;
            return Math.max(0, toolbar.getWidth());
        }

        private static void styleToolbarButton(AbstractButton button, String tooltip) {
            button.setFocusable(false);
            button.setToolTipText(tooltip);
            button.setMargin(JBUI.insets(2, 7));
            button.putClientProperty("JButton.buttonType", "toolBarButton");
        }

        private void updateResponsiveToolbar(int width, JPanel secondRow, JPanel navigation, JPanel searchPanel) {
            boolean narrow = width < JBUI.scale(520);
            boolean veryNarrow = width < JBUI.scale(360);
            backButton.setVisible(true);
            forwardButton.setVisible(true);
            refreshButton.setVisible(true);
            overflowButton.setVisible(true);
            status.setVisible(width >= JBUI.scale(820));
            navigationButtons.values().forEach(button -> button.setMargin(JBUI.insets(2, narrow ? 5 : 8)));
            int compactMargin = veryNarrow ? 3 : 7;
            backButton.setMargin(JBUI.insets(2, compactMargin));
            forwardButton.setMargin(JBUI.insets(2, compactMargin));
            refreshButton.setMargin(JBUI.insets(2, compactMargin));
            overflowButton.setMargin(JBUI.insets(2, compactMargin));

            secondRow.removeAll();
            secondRow.setLayout(new BorderLayout(narrow ? 0 : JBUI.scale(8), narrow ? JBUI.scale(2) : 0));
            if (narrow) {
                secondRow.add(navigation, BorderLayout.NORTH);
                secondRow.add(searchPanel, BorderLayout.CENTER);
            } else {
                secondRow.add(navigation, BorderLayout.WEST);
                secondRow.add(searchPanel, BorderLayout.CENTER);
                secondRow.add(status, BorderLayout.EAST);
            }
            secondRow.revalidate();
            revalidate();
            repaint();
        }

        private void showOverflowMenu() {
            JPopupMenu menu = new JPopupMenu();
            menu.add(menuAction(demoMode ? "使用原始网页布局" : "使用隐私阅读布局", demoButton::doClick));
            menu.add(menuAction("浏览历史", this::showHistoryPopup));
            menu.add(menuAction(breakReminderEnabled ? "关闭休息提醒" : "开启休息提醒", breakReminderButton::doClick));
            menu.add(menuAction("打开小游戏", gameButton::doClick));
            JMenuItem shareItem = menuAction("分享当前主题", shareButton::doClick);
            shareItem.setEnabled(shareButton.isEnabled());
            menu.add(shareItem);
            menu.add(menuAction("打开加密分享", openShareButton::doClick));
            menu.add(menuAction("加密分享使用说明", this::showShareHelp));
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
                    if (title == null || title.isBlank()) return;
                    currentPageTitle = title.replaceAll("[\\r\\n]+", " ").trim();
                    SwingUtilities.invokeLater(() -> updateHistoryTitle(
                            cefBrowser.getURL(),
                            historyTitleForUrl(cefBrowser.getURL(), safeCurrentTitle())
                    ));
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
                    if (isLoading) {
                        currentPageTitle = "";
                        mainLoadFailed = false;
                    }
                    if (isLoading && demoMode) applyLoadingPrivacyStyle(cefBrowser);
                    SwingUtilities.invokeLater(() -> {
                        if (disposed) {
                            return;
                        }
                        backButton.setEnabled(canGoBack);
                        forwardButton.setEnabled(canGoForward);
                        refreshButton.setEnabled(!isLoading);
                        navigationButtons.values().forEach(button -> button.setEnabled(!isLoading));
                        searchField.setEnabled(!isLoading);
                        status.setText(isLoading ? "加载中..." : (mainLoadFailed ? "加载失败，可重试" : "游客模式"));
                        updateNavigationState(cefBrowser.getURL());
                    });
                }

                @Override
                public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                    if (frame != null && frame.isMain() && httpStatusCode < 400) {
                        mainLoadFailed = false;
                        SwingUtilities.invokeLater(() -> {
                            if (disposed) return;
                            status.setText("游客模式");
                            updateNavigationState(cefBrowser.getURL());
                            recordHistory(cefBrowser.getURL(), safeCurrentTitle());
                        });
                        applyPageStyle(cefBrowser);
                        if (breakOverlayVisible) {
                            showBreakOverlay(cefBrowser);
                        }
                    } else if (frame != null && frame.isMain()) {
                        mainLoadFailed = true;
                        SwingUtilities.invokeLater(() -> {
                            if (!disposed) status.setText("加载失败，可重试");
                        });
                    }
                }

                @Override
                public void onLoadError(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        ErrorCode errorCode,
                        String errorText,
                        String failedUrl
                ) {
                    if (frame == null || !frame.isMain() || errorCode == ErrorCode.ERR_ABORTED) return;
                    mainLoadFailed = true;
                    SwingUtilities.invokeLater(() -> {
                        if (!disposed) status.setText("加载失败，可重试");
                    });
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
            String title = currentPageTitle == null ? "" : currentPageTitle
                    .replaceFirst("^\\([0-9]+\\)\\s*", "")
                    .replaceAll("\\s+-\\s+(?:LINUX DO|搞七捻三)\\s*$", "")
                    .trim();
            return title.isEmpty() ? "LINUX DO 公开主题" : title.substring(0, Math.min(200, title.length()));
        }

        private String historyTitleForUrl(String url, String title) {
            if (samePage(url, HOME_URL)) return "最新主题";
            if (samePage(url, TOP_URL)) return "本周热门";
            if (samePage(url, CATEGORIES_URL)) return "浏览分类";
            if (url != null && url.startsWith("https://linux.do/search")) return "搜索结果";
            String normalized = title == null ? "" : title.trim();
            if (normalized.equalsIgnoreCase("LINUX DO") || normalized.equals("搞七捻三")) return "LINUX DO 公开页面";
            return normalized;
        }

        private void recordHistory(String url, String title) {
            ReaderHistory.Entry entry = ReaderHistory.create(url, historyTitleForUrl(url, title), System.currentTimeMillis());
            if (entry == null) return;
            List<ReaderHistory.Entry> updated = ReaderHistory.add(browsingHistory, entry);
            browsingHistory.clear();
            browsingHistory.addAll(updated);
            properties.setValue(HISTORY_PROPERTY, ReaderHistory.serialize(browsingHistory));
            historyButton.setEnabled(true);
        }

        private void updateHistoryTitle(String url, String title) {
            List<ReaderHistory.Entry> updated = ReaderHistory.updateTitle(browsingHistory, url, title);
            if (updated.equals(browsingHistory)) return;
            browsingHistory.clear();
            browsingHistory.addAll(updated);
            properties.setValue(HISTORY_PROPERTY, ReaderHistory.serialize(browsingHistory));
        }

        private void showHistoryPopup() {
            if (historyPopup != null && historyPopup.isVisible()) {
                historyPopup.cancel();
                return;
            }

            SearchTextField filter = new SearchTextField(false);
            filter.getTextEditor().getEmptyText().setText("搜索标题或 URL");
            JPanel rows = new JPanel();
            rows.setLayout(new BoxLayout(rows, BoxLayout.Y_AXIS));
            JBScrollPane scrollPane = new JBScrollPane(rows);
            scrollPane.setBorder(JBUI.Borders.customLine(JBColor.border(), 1, 0, 1, 0));
            scrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
            scrollPane.getVerticalScrollBar().setUnitIncrement(JBUI.scale(18));

            JBLabel count = new JBLabel();
            count.setForeground(JBColor.GRAY);
            JButton clear = new JButton("清除全部");
            styleToolbarButton(clear, "清除本机保存的全部浏览历史");
            clear.setEnabled(!browsingHistory.isEmpty());
            clear.addActionListener(event -> clearHistory());
            JPanel footer = new JPanel(new BorderLayout());
            footer.setBorder(JBUI.Borders.emptyTop(8));
            footer.add(count, BorderLayout.WEST);
            footer.add(clear, BorderLayout.EAST);

            JPanel panel = new JPanel(new BorderLayout(0, JBUI.scale(10)));
            panel.setBorder(JBUI.Borders.empty(6, 10, 8, 10));
            panel.add(filter, BorderLayout.NORTH);
            panel.add(scrollPane, BorderLayout.CENTER);
            panel.add(footer, BorderLayout.SOUTH);

            Runnable refreshRows = () -> populateHistoryRows(rows, count, filter.getText());
            filter.getTextEditor().getDocument().addDocumentListener(new DocumentListener() {
                @Override
                public void insertUpdate(DocumentEvent event) {
                    refreshRows.run();
                }

                @Override
                public void removeUpdate(DocumentEvent event) {
                    refreshRows.run();
                }

                @Override
                public void changedUpdate(DocumentEvent event) {
                    refreshRows.run();
                }
            });
            refreshRows.run();

            int popupWidth = Math.min(JBUI.scale(720), Math.max(JBUI.scale(300), getWidth() - JBUI.scale(24)));
            int popupHeight = Math.min(JBUI.scale(560), Math.max(JBUI.scale(280), getHeight() - JBUI.scale(120)));
            panel.setPreferredSize(new Dimension(popupWidth, popupHeight));
            historyPopup = JBPopupFactory.getInstance()
                    .createComponentPopupBuilder(panel, filter.getTextEditor())
                    .setTitle("浏览历史")
                    .setResizable(true)
                    .setMovable(true)
                    .setRequestFocus(true)
                    .setCancelOnClickOutside(true)
                    .setCancelOnOtherWindowOpen(true)
                    .createPopup();
            historyPopup.showUnderneathOf(overflowButton);
        }

        private void populateHistoryRows(JPanel rows, JBLabel count, String rawQuery) {
            String query = rawQuery == null ? "" : rawQuery.trim().toLowerCase(Locale.ROOT);
            List<ReaderHistory.Entry> filtered = browsingHistory.stream()
                    .filter(entry -> query.isEmpty() || (entry.title() + " " + entry.url()).toLowerCase(Locale.ROOT).contains(query))
                    .toList();
            rows.removeAll();
            if (filtered.isEmpty()) {
                JBLabel empty = new JBLabel(browsingHistory.isEmpty() ? "暂无浏览历史" : "没有匹配的历史记录", SwingConstants.CENTER);
                empty.setForeground(JBColor.GRAY);
                empty.setBorder(JBUI.Borders.empty(36, 8));
                empty.setAlignmentX(CENTER_ALIGNMENT);
                rows.add(empty);
            } else {
                filtered.forEach(entry -> rows.add(createHistoryRow(entry)));
            }
            count.setText(query.isEmpty()
                    ? browsingHistory.size() + " 条记录"
                    : filtered.size() + " / " + browsingHistory.size() + " 条");
            rows.revalidate();
            rows.repaint();
        }

        private JPanel createHistoryRow(ReaderHistory.Entry entry) {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("MM-dd HH:mm")
                    .withZone(ZoneId.systemDefault());
            JBLabel title = new JBLabel(clip(entry.title(), 76));
            title.setFont(title.getFont().deriveFont(Font.BOLD));
            title.setToolTipText(entry.title());
            JBLabel url = new JBLabel(clip(entry.url(), 92));
            url.setForeground(JBColor.namedColor("Link.activeForeground", new JBColor(0x2474A8, 0x589DF6)));
            url.setFont(url.getFont().deriveFont(Math.max(10f, url.getFont().getSize2D() - 1f)));
            url.setToolTipText(entry.url());
            JBLabel time = new JBLabel(formatter.format(Instant.ofEpochMilli(entry.visitedAt())));
            time.setForeground(JBColor.GRAY);
            time.setFont(time.getFont().deriveFont(Math.max(10f, time.getFont().getSize2D() - 1f)));

            JPanel text = new JPanel();
            text.setLayout(new BoxLayout(text, BoxLayout.Y_AXIS));
            title.setAlignmentX(LEFT_ALIGNMENT);
            url.setAlignmentX(LEFT_ALIGNMENT);
            time.setAlignmentX(LEFT_ALIGNMENT);
            text.add(title);
            text.add(Box.createVerticalStrut(JBUI.scale(3)));
            text.add(url);
            text.add(Box.createVerticalStrut(JBUI.scale(2)));
            text.add(time);

            JButton open = new JButton("打开");
            styleToolbarButton(open, "重新打开此页面");
            open.addActionListener(event -> {
                if (historyPopup != null) historyPopup.cancel();
                navigateTo(entry.url());
            });
            JButton copy = iconButton(AllIcons.Actions.Copy, "复制 URL");
            styleToolbarButton(copy, "复制 URL");
            copy.addActionListener(event -> {
                CopyPasteManager.getInstance().setContents(new StringSelection(entry.url()));
                status.setText("URL 已复制");
            });
            JPanel actions = new JPanel(new FlowLayout(FlowLayout.TRAILING, 2, 0));
            actions.add(open);
            actions.add(copy);

            JPanel row = new JPanel(new BorderLayout(JBUI.scale(8), 0));
            row.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor.border()),
                    JBUI.Borders.empty(8, 4)
            ));
            row.add(text, BorderLayout.CENTER);
            row.add(actions, BorderLayout.EAST);
            row.setMaximumSize(new Dimension(Integer.MAX_VALUE, JBUI.scale(76)));
            return row;
        }

        private static String clip(String value, int maxLength) {
            if (value == null || value.length() <= maxLength) return value == null ? "" : value;
            return value.substring(0, Math.max(1, maxLength - 1)) + "…";
        }

        private void clearHistory() {
            int result = JOptionPane.showConfirmDialog(
                    this,
                    "清除本机保存的全部浏览历史？",
                    "清除浏览历史",
                    JOptionPane.OK_CANCEL_OPTION,
                    JOptionPane.WARNING_MESSAGE
            );
            if (result != JOptionPane.OK_OPTION) return;
            browsingHistory.clear();
            properties.unsetValue(HISTORY_PROPERTY);
            historyButton.setEnabled(false);
            status.setText("浏览历史已清除");
            if (historyPopup != null) historyPopup.cancel();
        }

        private void shareCurrentTopic() {
            ShareCode.Topic topic = ShareCode.fromTopicUrl(browser.getCefBrowser().getURL(), safeCurrentTitle());
            if (topic == null) {
                status.setText("请先打开一个主题");
                return;
            }
            ShareSettings settings = promptShareSettings();
            if (settings == null) return;
            long now = System.currentTimeMillis();
            String code = ShareCode.create(topic, settings.password(), settings.duration(), now);
            CopyPasteManager.getInstance().setContents(new StringSelection(code));
            String expiry = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                    .withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(now + settings.duration()));
            status.setText("加密分享内容已复制，" + expiry + " 失效");
            String message = "加密分享内容已复制到剪贴板。\n\n"
                    + "可再次复制分享内容或密码；密码不会写入分享内容或保存在插件中。\n\n失效时间：" + expiry;
            String[] actions = {"复制分享内容", "复制密码", "完成"};
            while (true) {
                int answer = JOptionPane.showOptionDialog(this, message, "加密分享已生成",
                        JOptionPane.DEFAULT_OPTION, JOptionPane.INFORMATION_MESSAGE, null, actions, actions[2]);
                if (answer == 0) {
                    CopyPasteManager.getInstance().setContents(new StringSelection(code));
                    status.setText("加密分享内容已复制");
                } else if (answer == 1) {
                    CopyPasteManager.getInstance().setContents(new StringSelection(settings.password()));
                    status.setText("分享密码已复制");
                } else {
                    break;
                }
            }
        }

        private ShareSettings promptShareSettings() {
            String[] choices = {"10 分钟", "1 小时", "24 小时", "7 天"};
            JComboBox<String> duration = new JComboBox<>(choices);
            duration.setSelectedIndex(1);
            JPasswordField password = new JPasswordField(28);
            JPasswordField confirmation = new JPasswordField(28);
            char echoCharacter = password.getEchoChar();
            JCheckBox showPassword = new JCheckBox("显示密码");
            JButton generate = new JButton("生成 20 位强密码");

            showPassword.addActionListener(event -> {
                char echo = showPassword.isSelected() ? 0 : echoCharacter;
                password.setEchoChar(echo);
                confirmation.setEchoChar(echo);
            });
            generate.addActionListener(event -> {
                String generated = ShareCode.generatePassword();
                password.setText(generated);
                confirmation.setText(generated);
                if (!showPassword.isSelected()) showPassword.doClick();
                password.selectAll();
                password.requestFocusInWindow();
            });
            JButton copyPassword = new JButton("复制密码");
            copyPassword.addActionListener(event -> {
                char[] passwordChars = password.getPassword();
                try {
                    String value = new String(passwordChars);
                    ShareCode.validatePassword(value);
                    CopyPasteManager.getInstance().setContents(new StringSelection(value));
                    status.setText("分享密码已复制");
                } catch (IllegalArgumentException error) {
                    JOptionPane.showMessageDialog(this, error.getMessage(), "无法复制密码", JOptionPane.WARNING_MESSAGE);
                } finally {
                    Arrays.fill(passwordChars, '\0');
                }
            });

            JPanel form = new JPanel();
            form.setLayout(new BoxLayout(form, BoxLayout.Y_AXIS));
            form.add(new JLabel("有效期"));
            form.add(duration);
            form.add(Box.createVerticalStrut(JBUI.scale(8)));
            form.add(new JLabel("分享密码（至少 12 个字符）"));
            form.add(password);
            form.add(Box.createVerticalStrut(JBUI.scale(6)));
            form.add(new JLabel("确认密码"));
            form.add(confirmation);
            JPanel controls = new JPanel(new FlowLayout(FlowLayout.LEADING, JBUI.scale(6), JBUI.scale(6)));
            controls.add(showPassword);
            controls.add(generate);
            controls.add(copyPassword);
            form.add(controls);
            form.add(new JLabel("<html><small>密码不会保存。可使用“复制密码”后再点击确定。</small></html>"));

            while (true) {
                int answer = JOptionPane.showConfirmDialog(this, form, "设置加密分享",
                        JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
                if (answer != JOptionPane.OK_OPTION) return null;
                char[] passwordChars = password.getPassword();
                char[] confirmationChars = confirmation.getPassword();
                boolean matches = Arrays.equals(passwordChars, confirmationChars);
                String value = new String(passwordChars);
                Arrays.fill(passwordChars, '\0');
                Arrays.fill(confirmationChars, '\0');
                if (!matches) {
                    JOptionPane.showMessageDialog(this, "两次输入的分享密码不一致。", "无法生成分享", JOptionPane.ERROR_MESSAGE);
                    continue;
                }
                try {
                    ShareCode.validatePassword(value);
                } catch (IllegalArgumentException error) {
                    JOptionPane.showMessageDialog(this, error.getMessage(), "无法生成分享", JOptionPane.ERROR_MESSAGE);
                    continue;
                }
                long durationMillis = switch (String.valueOf(duration.getSelectedItem())) {
                    case "10 分钟" -> TimeUnit.MINUTES.toMillis(10);
                    case "24 小时" -> TimeUnit.HOURS.toMillis(24);
                    case "7 天" -> TimeUnit.DAYS.toMillis(7);
                    default -> TimeUnit.HOURS.toMillis(1);
                };
                return new ShareSettings(durationMillis, value);
            }
        }

        private void openShareCode() {
            String clipboard = CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor);
            String initialValue = clipboard != null && clipboard.trim().startsWith("LDGS2.") ? clipboard.trim() : "";
            Object input = JOptionPane.showInputDialog(this,
                    "第 1/2 步：粘贴对方发来的加密分享内容。\n内部格式标识无需手动填写或理解。", "打开加密分享",
                    JOptionPane.PLAIN_MESSAGE, null, null, initialValue);
            if (input == null) return;
            if (input.toString().trim().startsWith("LDGS1.")) {
                JOptionPane.showMessageDialog(this,
                        "旧版分享内容没有密码加密，已停止支持。请让发送方使用新版插件重新生成。",
                        "无法打开分享", JOptionPane.ERROR_MESSAGE);
                return;
            }
            JPasswordField passwordField = new JPasswordField(34);
            JPanel passwordPanel = new JPanel(new BorderLayout(0, JBUI.scale(8)));
            passwordPanel.add(new JLabel("<html>第 2/2 步：输入发送方通过另一渠道提供的分享密码。<br>密码只用于本次解密，不会保存。</html>"), BorderLayout.NORTH);
            passwordPanel.add(passwordField, BorderLayout.CENTER);
            int passwordAnswer = JOptionPane.showConfirmDialog(this, passwordPanel, "输入分享密码",
                    JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
            if (passwordAnswer != JOptionPane.OK_OPTION) return;
            char[] passwordChars = passwordField.getPassword();
            String password = new String(passwordChars);
            Arrays.fill(passwordChars, '\0');
            try {
                ShareCode.Decoded decoded = ShareCode.parse(input.toString(), password, System.currentTimeMillis());
                navigateTo(decoded.topic().url());
            } catch (IllegalArgumentException error) {
                JOptionPane.showMessageDialog(this, error.getMessage(), "无法打开分享", JOptionPane.ERROR_MESSAGE);
            }
        }

        private void showShareHelp() {
            JOptionPane.showMessageDialog(
                    this,
                    "1. 打开一个公开主题，点击工具栏“分享”。\n"
                            + "2. 选择有效期，填写并确认至少 12 个字符的密码；也可生成 20 位强密码。\n"
                            + "3. 插件把加密分享内容复制到剪贴板；把它发给对方，并通过另一渠道告知密码。\n"
                            + "4. 对方选择“打开加密分享”，粘贴分享内容并输入相同密码。\n\n"
                            + "主题、标题、生成时间和过期时间均使用 AES-256-GCM 加密。密码经随机盐和\n"
                            + "600,000 次 PBKDF2-HMAC-SHA256 派生密钥；密码不进入分享内容，也不会保存。\n"
                            + "只有分享内容而没有密码，即使知道算法和源码也无法直接还原主题。\n\n"
                            + "请使用不易猜测的密码并通过另一渠道发送。如果中间人同时获得分享内容和密码，\n"
                            + "或密码过于简单，纯客户端插件无法继续保密。到期后插件拒绝导入，\n"
                            + "但已经打开或另行保存的公开 URL 无法撤回。",
                    "加密分享使用说明",
                    JOptionPane.INFORMATION_MESSAGE
            );
        }

        private void applyPageStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) {
                return;
            }
            String css = BASE_PAGE_STYLE + (demoMode ? DEMO_PAGE_STYLE : "");
            String script = "(function(){"
                    + "var id='lexiao-guest-reader-style';"
                    + "var style=document.getElementById(id);"
                    + "if(!style){style=document.createElement('style');style.id=id;document.head.appendChild(style);}"
                    + "style.textContent=\"" + escapeJavaScript(css) + "\";"
                    + "var loadingId='lexiao-guest-loading-privacy';"
                    + "var loadingStyle=document.getElementById(loadingId);"
                    + "if(loadingStyle){loadingStyle.textContent=\"" + escapeJavaScript(demoMode ? DEMO_LOADING_STYLE : "") + "\";}"
                    + "})();\n"
                    + READER_MODE_SCRIPT.replace("__LEXIAO_DEMO_MODE__", Boolean.toString(demoMode));
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private void applyLoadingPrivacyStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) return;
            String script = "(function(){"
                    + "var id='lexiao-guest-loading-privacy';"
                    + "var style=document.getElementById(id);"
                    + "if(!style){style=document.createElement('style');style.id=id;document.head.appendChild(style);}"
                    + "style.textContent=\"" + escapeJavaScript(DEMO_LOADING_STYLE) + "\";"
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
            String script = GAME_CORE_SCRIPT + "\n" + GAME_UI_SCRIPT + "\n" + BREAK_OVERLAY_SCRIPT.replace(
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
                    + "var overlay=document.getElementById('linuxdo-game-overlay');"
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
            if (historyPopup != null) historyPopup.cancel();
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
