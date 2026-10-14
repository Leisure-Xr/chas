package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopup;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.ui.popup.JBPopupListener;
import com.intellij.openapi.ui.popup.LightweightWindowEvent;
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
import com.intellij.util.concurrency.AppExecutorUtil;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.CefSettings;
import org.cef.handler.CefResourceRequestHandler;
import org.cef.handler.CefResourceRequestHandlerAdapter;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.handler.CefLoadHandler.ErrorCode;
import org.cef.handler.CefDisplayHandlerAdapter;
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.cef.network.CefResponse;
import org.jetbrains.annotations.NotNull;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.AbstractButton;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JCheckBoxMenuItem;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JMenu;
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
import java.awt.CardLayout;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.FlowLayout;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public final class LinuxDoToolWindowFactory implements ToolWindowFactory, DumbAware {
    private static final Logger LOG = Logger.getInstance(LinuxDoToolWindowFactory.class);
    // 工具窗口 ID 仍是 "LINUX DO"（保留用户的窗口布局），这里只改显示名；plugin.xml 的 bundle 也声明了同一名称。
    private static final String STRIPE_TITLE = "论坛游客阅读器";

    @Override
    public void init(@NotNull ToolWindow toolWindow) {
        toolWindow.setStripeTitle(STRIPE_TITLE);
    }

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        if (!JBCefApp.isSupported()) {
            JLabel message = new JLabel(STRIPE_TITLE + "需要带 JCEF 的 JetBrains Runtime。", SwingConstants.CENTER);
            Content content = ContentFactory.getInstance().createContent(message, "", false);
            toolWindow.getContentManager().addContent(content);
            return;
        }

        GuestBrowserPanel panel = new GuestBrowserPanel();
        Content content = ContentFactory.getInstance().createContent(panel, "", false);
        content.setDisposer(panel);
        toolWindow.getContentManager().addContent(content);
        panel.setSiteListener(site -> content.setDisplayName(site.displayName()));
    }

    private static final class GuestBrowserPanel extends JPanel implements Disposable {
        private static final String BREAK_REMINDER_PROPERTY = "linuxdo.guest.breakReminder.enabled";
        private static final String DEMO_MODE_PROPERTY = "linuxdo.guest.demoMode.enabled";
        private static final String SITE_PROPERTY = "linuxdo.guest.site";
        private static final String HISTORY_PROPERTY = "linuxdo.guest.readerHistory";
        private static final String FAVORITES_PROPERTY = "linuxdo.guest.favoriteFolders";
        private static final String BREAK_ACTION_PATH = "/__lexiao_break/";
        private static final String GAME_BEST_PROPERTY = "linuxdo.guest.gameBest.";
        private static final int SNOOZE_MINUTES = 10;
        private static final int COOKIE_CLEANUP_TIMEOUT_SECONDS = 10;
        private static final int PAGE_LOAD_TIMEOUT_MILLIS = 30_000;
        // 加载停止却没被判定为完成时的兜底：进程外 JCEF 丢过 isLoading=true 边沿，
        // 这时既不会完成也不会失败，页面会静默卡在遮罩里。
        private static final int DOCUMENT_SETTLE_TIMEOUT_MILLIS = 4_000;
        // 遮罩样式的 JS 侧自清时限，必须比上面两个兜底都长，让 Java 侧先有机会正常揭开。
        private static final int LOADING_MASK_MAX_MILLIS = 8_000;
        private static final String BREAK_OVERLAY_SCRIPT = loadBreakOverlayScript();
        private static final String GAME_CORE_SCRIPT = loadResourceScript("/game-core.js");
        private static final String GAME_UI_SCRIPT = loadResourceScript("/game-ui.js");
        private static final String DEMO_PAGE_STYLE = loadResourceScript("/reader-mode.css");
        private static final String READER_MODE_SCRIPT = loadResourceScript("/reader-mode.js");
        private static final String PAGE_PROBE_SCRIPT = loadResourceScript("/page-probe.js");
        // 各站点自己的阅读样式和加载遮罩，启动时一次读齐，缺文件立即失败。
        private static final Map<String, String> SITE_STYLES = loadSiteStyles();
        private static final String DEMO_LOADING_STYLE = """
                html, body {
                  color-scheme: __LEX_IDE_SCHEME__;
                  background: __LEX_IDE_BG__ !important;
                  color: __LEX_IDE_TEXT__ !important;
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
        private volatile ForumSite currentSite = ForumSite.byId(properties.getValue(SITE_PROPERTY));
        // 导航行、搜索框和标题栏当前呈现的站点，只在 EDT 上读写。
        private ForumSite renderedSite;
        private final JPanel navigationPanel = new JPanel(new FlowLayout(FlowLayout.LEADING, 3, 0));
        private final JButton searchButton = iconButton(AllIcons.Actions.Search, "搜索");
        private Runnable relayoutToolbar = () -> {};
        private boolean navigationLocked;
        private final List<ReaderHistory.Entry> browsingHistory = new ArrayList<>(
                ReaderHistory.parse(properties.getValue(HISTORY_PROPERTY))
        );
        private final List<ReaderFavorites.Folder> favoriteFolders = new ArrayList<>(
                ReaderFavorites.parse(properties.getValue(FAVORITES_PROPERTY))
        );
        private final Map<String, JToggleButton> navigationButtons = new LinkedHashMap<>();
        private volatile IdeThemePalette ideTheme = IdeThemePalette.current();
        private volatile boolean demoMode = properties.getBoolean(DEMO_MODE_PROPERTY, true);
        private volatile boolean readerFallbackActive = false;
        private volatile boolean breakOverlayVisible;
        private volatile boolean breakOverlayReminderMode;
        private volatile boolean breakReminderEnabled;
        private volatile String recommendedGame = "2048";
        private Timer breakReminderTimer;
        private volatile boolean guestSessionInitializing = true;
        private volatile String pendingNavigationUrl = currentSite.homeUrl();
        private volatile String currentPageTitle = currentSite.genericTopicTitle();
        private volatile boolean mainLoadFailed;
        private final DocumentLoadState documentLoadState = new DocumentLoadState();
        private volatile String lastRequestedUrl = currentSite.homeUrl();
        private volatile boolean showingErrorPage;
        private final Timer pageLoadTimer = new Timer(PAGE_LOAD_TIMEOUT_MILLIS, event -> handleLoadTimeout());
        private final Timer documentSettleTimer =
                new Timer(DOCUMENT_SETTLE_TIMEOUT_MILLIS, event -> handleSettleTimeout());
        // Cloudflare 的 "Just a moment…" 挑战页就是带着 403/503 返回的，这是正常流程而非失败。
        // 自动等待期限按站点取；期限结束后提示用户操作，保留验证页面。
        private final Timer challengeTimer =
                new Timer(currentSite.challengeTimeoutMillis(), event -> handleChallengeTimeout());
        // 最近一次主框架响应的 cf-mitigated 头；null 表示没读到响应头。
        private volatile String mainFrameCfMitigated;
        // 正在加载的主框架所属站点。跨站导航开始时浏览器报告的仍是旧地址，加载遮罩要按目标站点选。
        private volatile ForumSite loadingSite;
        private final CardLayout pageLayout = new CardLayout();
        private final JPanel pageContainer = new JPanel(pageLayout);
        private final JPanel challengeNotice = new JPanel(new BorderLayout(0, JBUI.scale(4)));
        private final JBLabel challengeMessage = new JBLabel();
        private final JLabel loadErrorMessage = new JLabel("网页暂时无法显示", SwingConstants.CENTER);
        private JBPopup historyPopup;
        private JBPopup favoritesPopup;
        private FavoritesPanel favoritesPanel;
        private volatile boolean disposed;
        private Consumer<ForumSite> siteListener = site -> {};

        private record ShareSettings(long duration, String password) {}

        private GuestBrowserPanel() {
            super(new BorderLayout());
            pageLoadTimer.setRepeats(false);
            documentSettleTimer.setRepeats(false);
            challengeTimer.setRepeats(false);
            setBorder(BorderFactory.createEmptyBorder());
            browser.getComponent().setBackground(ideTheme.background());
            add(createToolbar(), BorderLayout.NORTH);
            renderSite(currentSite);
            pageContainer.add(browser.getComponent(), "browser");
            pageContainer.add(createLoadErrorPanel(), "error");
            JPanel pageArea = new JPanel(new BorderLayout());
            pageArea.add(createChallengeNotice(), BorderLayout.NORTH);
            pageArea.add(pageContainer, BorderLayout.CENTER);
            add(pageArea, BorderLayout.CENTER);
            installGuestOnlyNavigationGuard();
            installHistoryStateHandler();
            ApplicationManager.getApplication().getMessageBus().connect(this).subscribe(
                    LafManagerListener.TOPIC,
                    source -> SwingUtilities.invokeLater(this::refreshIdeTheme)
            );
            startGuestSession();
            setBreakReminderEnabled(properties.getBoolean(BREAK_REMINDER_PROPERTY, false), false);
        }

        void setSiteListener(Consumer<ForumSite> listener) {
            siteListener = listener;
            listener.accept(currentSite);
        }

        private JPanel createChallengeNotice() {
            challengeNotice.setBorder(JBUI.Borders.empty(8));
            challengeNotice.add(challengeMessage, BorderLayout.CENTER);
            JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEADING, JBUI.scale(6), 0));
            JButton retry = new JButton("重新验证");
            retry.addActionListener(event -> reloadCurrentPage());
            JButton stop = new JButton("停止验证");
            stop.addActionListener(event -> showLoadFailure("已停止站点验证", lastRequestedUrl));
            actions.add(retry);
            actions.add(stop);
            challengeNotice.add(actions, BorderLayout.SOUTH);
            challengeNotice.setVisible(false);
            return challengeNotice;
        }

        private String challengeStatus() {
            return documentLoadState.challengeNeedsInteraction() ? "请完成站点验证" : "站点正在进行人机验证...";
        }

        // Keep this notice outside the responsive toolbar, whose status is hidden in narrow windows.
        private void updateChallengeNotice() {
            boolean active = documentLoadState.isChallengeActive();
            challengeMessage.setText(documentLoadState.challengeNeedsInteraction()
                    ? "<html>验证尚未完成。请在下方完成验证；若一直没有反应，可重新验证或停止。</html>"
                    : "<html>站点正在验证浏览器。若下方出现验证框，请按提示操作。</html>");
            challengeNotice.setVisible(active);
            challengeNotice.revalidate();
        }

        private JPanel createLoadErrorPanel() {
            JPanel panel = new JPanel(new BorderLayout());
            JPanel message = new JPanel();
            message.setLayout(new BoxLayout(message, BoxLayout.Y_AXIS));
            loadErrorMessage.setAlignmentX(CENTER_ALIGNMENT);
            JButton retry = new JButton("重试加载");
            retry.setAlignmentX(CENTER_ALIGNMENT);
            retry.addActionListener(event -> navigateTo(lastRequestedUrl));
            message.add(Box.createVerticalGlue());
            message.add(loadErrorMessage);
            message.add(Box.createVerticalStrut(JBUI.scale(12)));
            message.add(retry);
            message.add(Box.createVerticalGlue());
            panel.add(message, BorderLayout.CENTER);
            return panel;
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
            refreshButton.addActionListener(event -> reloadCurrentPage());
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

            searchField.addActionListener(event -> search());
            styleToolbarButton(searchButton, "搜索");
            searchButton.addActionListener(event -> search());
            JPanel searchPanel = new JPanel(new BorderLayout(2, 0));
            searchPanel.add(searchField, BorderLayout.CENTER);
            searchPanel.add(searchButton, BorderLayout.EAST);

            status.setForeground(JBColor.GRAY);
            status.setFont(status.getFont().deriveFont(status.getFont().getSize2D() - 2f));
            secondRow.add(navigationPanel, BorderLayout.WEST);
            secondRow.add(searchPanel, BorderLayout.CENTER);
            secondRow.add(status, BorderLayout.EAST);

            toolbar.add(firstRow, BorderLayout.NORTH);
            toolbar.add(secondRow, BorderLayout.SOUTH);
            toolbar.addComponentListener(new ComponentAdapter() {
                @Override
                public void componentResized(ComponentEvent event) {
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigationPanel, searchPanel);
                }
            });
            addComponentListener(new ComponentAdapter() {
                @Override
                public void componentResized(ComponentEvent event) {
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigationPanel, searchPanel);
                }
            });
            relayoutToolbar = () ->
                    updateResponsiveToolbar(availableToolbarWidth(toolbar), secondRow, navigationPanel, searchPanel);
            SwingUtilities.invokeLater(relayoutToolbar);
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
            if (demoMode && readerFallbackActive) {
                menu.add(menuAction("重新应用隐私阅读布局（当前已回退）", this::retryReaderMode));
            }
            menu.add(forumMenu());
            menu.add(menuAction(demoMode ? "使用原始网页布局" : "使用隐私阅读布局", demoButton::doClick));
            menu.add(menuAction("浏览历史", this::showHistoryPopup));
            JMenuItem favoriteItem = menuAction("收藏当前主题", this::favoriteCurrentTopic);
            favoriteItem.setEnabled(ForumSite.topicUrl(browser.getCefBrowser().getURL()) != null);
            menu.add(favoriteItem);
            menu.add(menuAction("收藏夹", this::showFavoritesPopup));
            menu.add(menuAction(breakReminderEnabled ? "关闭休息提醒" : "开启休息提醒", breakReminderButton::doClick));
            menu.add(menuAction("打开小游戏", gameButton::doClick));
            JMenuItem shareItem = menuAction(
                    currentSite.shareSupported() ? "分享当前主题" : "分享当前主题（暂仅支持 LINUX DO）", shareButton::doClick);
            shareItem.setEnabled(shareButton.isEnabled());
            menu.add(shareItem);
            menu.add(menuAction("打开加密分享", openShareButton::doClick));
            menu.add(menuAction("加密分享使用说明", this::showShareHelp));
            menu.addSeparator();
            menu.add(menuAction("清理 Cookie 并重置会话", resetButton::doClick));
            menu.show(overflowButton, 0, overflowButton.getHeight());
        }

        private JMenu forumMenu() {
            JMenu menu = new JMenu("切换论坛");
            ButtonGroup group = new ButtonGroup();
            for (ForumSite site : ForumSite.values()) {
                JCheckBoxMenuItem item = new JCheckBoxMenuItem(site.displayName(), site == currentSite);
                item.addActionListener(event -> switchSite(site));
                group.add(item);
                menu.add(item);
            }
            return menu;
        }

        private void switchSite(ForumSite site) {
            renderSite(site);
            navigateTo(site.homeUrl());
        }

        // 当前站点跟随主框架 URL：点到另一个受支持论坛的链接时，导航行、搜索和标题一并切换。
        private void renderSite(ForumSite site) {
            currentSite = site;
            if (site == renderedSite) return;
            renderedSite = site;
            properties.setValue(SITE_PROPERTY, site.id(), ForumSite.DEFAULT.id());
            navigationButtons.clear();
            navigationPanel.removeAll();
            for (ForumSite.NavEntry entry : site.navigation()) {
                JToggleButton button = navigationButton(entry.label(), site.url(entry));
                button.setEnabled(!navigationLocked);
                navigationPanel.add(button);
            }
            updateSearchAvailability();
            siteListener.accept(site);
            relayoutToolbar.run();
            updateNavigationState(browser.getCefBrowser().getURL());
        }

        private void updateSearchAvailability() {
            boolean supported = currentSite.supportsSearch();
            String hint = supported ? "搜索公开主题" : currentSite.searchUnavailableHint();
            if (!supported) searchField.setText("");
            searchField.getEmptyText().setText(hint);
            searchField.setToolTipText(hint);
            searchField.setEnabled(supported && !navigationLocked);
            searchButton.setEnabled(supported && !navigationLocked);
        }

        private String idleStatus() {
            return "游客模式 · " + currentSite.displayName();
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
            String url = currentSite.searchUrl(query);
            if (url == null) status.setText(currentSite.searchUnavailableHint());
            else navigateTo(url);
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
                public void onAddressChange(CefBrowser cefBrowser, CefFrame frame, String url) {
                    if (frame == null || !frame.isMain()) return;
                    if (ForumSite.isAuthenticationUrl(url)) {
                        showLoadFailure("站点将游客请求重定向到登录页面", url);
                        return;
                    }
                    SwingUtilities.invokeLater(() -> {
                        if (disposed) return;
                        ForumSite site = ForumSite.forUrl(url);
                        if (site != null) renderSite(site);
                        updateNavigationState(url);
                        recordHistory(url, historyTitleForUrl(url, safeCurrentTitle()));
                    });
                }

                @Override
                public void onTitleChange(CefBrowser cefBrowser, String title) {
                    if (title == null || title.isBlank()) return;
                    currentPageTitle = title.replaceAll("[\\r\\n]+", " ").trim();
                    SwingUtilities.invokeLater(() -> updateHistoryTitle(
                            cefBrowser.getURL(),
                            historyTitleForUrl(cefBrowser.getURL(), safeCurrentTitle())
                    ));
                }

                @Override
                public boolean onConsoleMessage(
                        CefBrowser cefBrowser,
                        CefSettings.LogSeverity level,
                        String message,
                        String source,
                        int line
                ) {
                    if (message != null && message.startsWith("LEXIAO_")) {
                        LOG.info("LINUX DO " + message);
                        if (message.startsWith("LEXIAO_READER_STATE ")) {
                            readerFallbackActive = message.contains("\"suppressed\":true");
                        }
                    }
                    return false;
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
                    boolean blankPage = isBlankPage(cefBrowser.getURL());
                    boolean trackedLoad = !blankPage && documentLoadState.isAwaiting();
                    if (isLoading && trackedLoad) {
                        readerFallbackActive = false;
                        documentLoadState.loadingStarted();
                        currentPageTitle = "";
                        mainLoadFailed = false;
                        if (!documentLoadState.isChallengeActive()) pageLoadTimer.restart();
                        LOG.info("LINUX DO JCEF load started: " + diagnosticUrl(cefBrowser.getURL()));
                        if (demoMode && !documentLoadState.isChallengeActive()) applyLoadingPrivacyStyle(cefBrowser);
                    } else if (!isLoading && trackedLoad) {
                        LOG.info("LINUX DO JCEF load stopped: " + diagnosticUrl(cefBrowser.getURL())
                                + ", failed=" + mainLoadFailed);
                        if (mainLoadFailed) {
                            pageLoadTimer.stop();
                        } else if (documentLoadState.isChallengeActive()) {
                            // 挑战页本身加载完了，但验证还没过。保持等待，绝不能判成完成——
                            // 否则验证通过后的真实页面就不再被跟踪，样式也不会重新注入。
                            LOG.info("LINUX DO JCEF challenge page settled, awaiting verification");
                            clearLoadingPrivacyStyle(cefBrowser);
                        } else if (documentLoadState.completeFromLoadingState()) {
                            completeDocumentLoad(cefBrowser, "loading-state", null);
                        } else {
                            // 加载停止了却判定不出完成。绝不能在这里停表：一旦停了，既不会
                            // 完成也不会失败，页面就静默卡在遮罩里——这正是白屏的形状。
                            LOG.warn("LINUX DO JCEF load stopped without settle: "
                                    + diagnosticUrl(cefBrowser.getURL()));
                            documentSettleTimer.restart();
                        }
                    }
                    if (!isLoading && !blankPage) {
                        // 探针独立于 trackedLoad、阅读模式和完成判定。0.14.1–0.14.3 三次误判，
                        // 正是因为唯一的诊断通道挂在那条已经断掉的链路上。
                        injectPageProbe(cefBrowser);
                    }
                    SwingUtilities.invokeLater(() -> {
                        if (disposed) {
                            return;
                        }
                        boolean verifying = documentLoadState.isChallengeActive();
                        boolean showLoading = isLoading && documentLoadState.isAwaiting() && !verifying;
                        backButton.setEnabled(canGoBack);
                        forwardButton.setEnabled(canGoForward);
                        refreshButton.setEnabled(!showLoading);
                        navigationLocked = showLoading;
                        navigationButtons.values().forEach(button -> button.setEnabled(!showLoading));
                        updateSearchAvailability();
                        status.setText(mainLoadFailed ? "加载失败，可重试" : verifying ? challengeStatus()
                                : showLoading ? "加载中..." : idleStatus());
                        updateChallengeNotice();
                        updateNavigationState(cefBrowser.getURL());
                    });
                }

                @Override
                public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                    if (frame != null && frame.isMain() && isBlankPage(frame.getURL())) {
                        LOG.info("LINUX DO JCEF initial blank frame completed");
                        return;
                    }
                    if (frame != null && frame.isMain() && ForumSite.isAuthenticationUrl(frame.getURL())) {
                        showLoadFailure("站点将游客请求重定向到登录页面", frame.getURL());
                        return;
                    }
                    if (frame != null && frame.isMain() && httpStatusCode < 400) {
                        if (documentLoadState.completeFromMainFrame()) {
                            completeDocumentLoad(cefBrowser, "main-frame", httpStatusCode);
                        }
                    } else if (frame != null && frame.isMain()) {
                        if (isChallengeStatus(httpStatusCode) && !deniedWithoutChallenge(httpStatusCode)) {
                            handleChallengeResponse(cefBrowser, httpStatusCode);
                        } else if (httpStatusCode == 403) {
                            showLoadFailure("HTTP 403：站点拒绝了游客访问（可能需要登录）", cefBrowser.getURL());
                        } else {
                            showLoadFailure("HTTP " + httpStatusCode, cefBrowser.getURL());
                        }
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
                    showLoadFailure(errorCode.name(), failedUrl);
                }
            }, browser.getCefBrowser());
        }

        private void navigateTo(String url) {
            if (disposed || !ForumSite.isAllowedGuestUrl(url)) return;
            ForumSite target = ForumSite.forUrl(url);
            if (target != null) renderSite(target);
            lastRequestedUrl = url;
            showingErrorPage = false;
            pageLayout.show(pageContainer, "browser");
            if (guestSessionInitializing) {
                pendingNavigationUrl = url;
                status.setText("准备游客会话，将打开" + navigationLabel(url));
                return;
            }
            pendingNavigationUrl = null;
            CefBrowser cefBrowser = browser.getCefBrowser();
            challengeTimer.stop();
            documentLoadState.begin();
            updateChallengeNotice();
            pageLoadTimer.restart();
            status.setText("加载中...");
            LOG.info("LINUX DO JCEF navigation requested: " + diagnosticUrl(url));
            if (ForumSite.samePage(cefBrowser.getURL(), url)) cefBrowser.reload();
            else cefBrowser.loadURL(url);
        }

        private void reloadCurrentPage() {
            if (disposed) return;
            if (showingErrorPage) {
                navigateTo(lastRequestedUrl);
                return;
            }
            CefBrowser cefBrowser = browser.getCefBrowser();
            String url = cefBrowser.getURL();
            if (!ForumSite.isAllowedGuestUrl(url) || isBlankPage(url)) url = lastRequestedUrl;
            lastRequestedUrl = url;
            showingErrorPage = false;
            pageLayout.show(pageContainer, "browser");
            challengeTimer.stop();
            documentLoadState.begin();
            updateChallengeNotice();
            pageLoadTimer.restart();
            status.setText("加载中...");
            LOG.info("LINUX DO JCEF reload requested: " + diagnosticUrl(url));
            cefBrowser.reload();
        }

        private void completeDocumentLoad(CefBrowser cefBrowser, String trigger, Integer httpStatusCode) {
            if (disposed || cefBrowser == null) return;
            pageLoadTimer.stop();
            documentSettleTimer.stop();
            challengeTimer.stop();
            mainLoadFailed = false;
            String statusCode = httpStatusCode == null ? "unknown" : httpStatusCode.toString();
            LOG.info("LINUX DO JCEF document completed: " + diagnosticUrl(cefBrowser.getURL())
                    + ", trigger=" + trigger + ", status=" + statusCode
                    + ", " + browserComponentDiagnostics());
            SwingUtilities.invokeLater(() -> {
                if (disposed) return;
                pageLayout.show(pageContainer, "browser");
                updateChallengeNotice();
                status.setText(idleStatus());
                updateNavigationState(cefBrowser.getURL());
                recordHistory(cefBrowser.getURL(), safeCurrentTitle());
            });
            applyPageStyle(cefBrowser);
            if (breakOverlayVisible) showBreakOverlay(cefBrowser);
        }

        private void continuePendingNavigation() {
            if (disposed || guestSessionInitializing || pendingNavigationUrl == null) return;
            String target = pendingNavigationUrl;
            pendingNavigationUrl = null;
            navigateTo(target);
        }

        private static boolean isBlankPage(String url) {
            return url == null || url.isBlank() || "about:blank".equals(url);
        }

        private void handleLoadTimeout() {
            if (!disposed && !showingErrorPage && documentLoadState.isAwaiting()
                    && !documentLoadState.isChallengeActive()) showLoadFailure("加载超时", lastRequestedUrl);
        }

        // 加载已经停止，但完成判定没走通。这时文档通常其实是好的，只是丢了状态边沿，
        // 所以先尝试补判为完成（顺带揭开遮罩）；补不上才让用户看到可重试的错误页。
        private void handleSettleTimeout() {
            if (disposed || showingErrorPage || mainLoadFailed || documentLoadState.isChallengeActive()) return;
            CefBrowser cefBrowser = browser.getCefBrowser();
            if (documentLoadState.completeFromMainFrame()) {
                LOG.warn("LINUX DO JCEF settle watchdog recovered: " + diagnosticUrl(cefBrowser.getURL()));
                completeDocumentLoad(cefBrowser, "settle-watchdog", null);
            }
        }

        // Cloudflare 的人机验证页带着这些状态码返回，它们代表“验证进行中”，不是加载失败。
        private static boolean isChallengeStatus(int httpStatusCode) {
            return httpStatusCode == 403 || httpStatusCode == 503;
        }

        // 关键：这里不能走 showLoadFailure。它会调用 stopLoad()，把页内验证脚本当场掐断，
        // 于是永远拿不到 cf_clearance——报错越“及时”，越不可能连上。
        private void handleChallengeResponse(CefBrowser cefBrowser, int httpStatusCode) {
            if (disposed || showingErrorPage || !documentLoadState.isAwaiting()) return;
            LOG.info("LINUX DO JCEF challenge response: " + diagnosticUrl(cefBrowser.getURL())
                    + ", status=" + httpStatusCode);
            documentLoadState.challengeReceived(System.nanoTime(), siteFor(cefBrowser.getURL()).challengeTimeoutMillis());
            pageLoadTimer.stop();
            documentSettleTimer.stop();
            handleChallengeTimeout();
            // 撤掉遮罩，否则验证界面会被糊成纯白，用户既看不见进度也无法交互。
            clearLoadingPrivacyStyle(cefBrowser);
            SwingUtilities.invokeLater(() -> {
                if (disposed || !documentLoadState.isChallengeActive()) return;
                pageLayout.show(pageContainer, "browser");
                refreshButton.setEnabled(true);
                navigationLocked = false;
                navigationButtons.values().forEach(button -> button.setEnabled(true));
                updateSearchAvailability();
                updateChallengeNotice();
                status.setText(challengeStatus());
            });
        }

        // 读到了响应头、却没有 cf-mitigated: challenge 的 403 是真正的拒绝访问（例如需要登录的帖子），
        // 不必干等验证超时。读不到响应头时仍按验证页处理：宁可多等，也不能掐断真正的验证。
        private boolean deniedWithoutChallenge(int httpStatusCode) {
            String mitigated = mainFrameCfMitigated;
            return httpStatusCode == 403 && mitigated != null && !"challenge".equalsIgnoreCase(mitigated.trim());
        }

        private void handleChallengeTimeout() {
            if (disposed || !documentLoadState.isChallengeActive()) return;
            if (documentLoadState.challengeNeedsInteraction()) return;
            int remaining = documentLoadState.challengeRemainingMillis(System.nanoTime());
            if (remaining > 0) {
                challengeTimer.setInitialDelay(remaining);
                challengeTimer.restart();
                return;
            }
            // A challenge may switch from automatic verification to a checkbox. stopLoad()
            // here would abort that transition and make successful manual verification impossible.
            challengeTimer.stop();
            if (!documentLoadState.requestChallengeInteraction()) return;
            LOG.info("LINUX DO JCEF challenge awaiting user interaction: " + diagnosticUrl(lastRequestedUrl));
            SwingUtilities.invokeLater(() -> {
                if (disposed || !documentLoadState.isChallengeActive()) return;
                updateChallengeNotice();
                status.setText(challengeStatus());
                clearLoadingPrivacyStyle(browser.getCefBrowser());
            });
        }

        // 只撤遮罩，不注入阅读模式样式——验证页不是正文，不该被当作内容处理。
        private void clearLoadingPrivacyStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) return;
            String script = "(function(){"
                    + "var style=document.getElementById('lexiao-guest-loading-privacy');"
                    + "if(style){style.remove();}"
                    + "if(window.__lexiaoLoadingMaskTimer){"
                    + "clearTimeout(window.__lexiaoLoadingMaskTimer);window.__lexiaoLoadingMaskTimer=0;}"
                    + "})();";
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        // 组件尺寸为 0 或未上屏，会呈现出和“页面是白的”完全一样的效果，必须可区分。
        private String browserComponentDiagnostics() {
            java.awt.Component component = browser.getComponent();
            return "component=" + component.getWidth() + "x" + component.getHeight()
                    + ", showing=" + component.isShowing()
                    + ", card=" + (showingErrorPage ? "error" : "browser");
        }

        private void showLoadFailure(String reason, String failedUrl) {
            if (showingErrorPage || disposed) return;
            documentLoadState.fail();
            mainLoadFailed = true;
            pageLoadTimer.stop();
            documentSettleTimer.stop();
            challengeTimer.stop();
            String target = ForumSite.isAllowedGuestUrl(failedUrl) && !"about:blank".equals(failedUrl)
                    ? failedUrl : lastRequestedUrl;
            LOG.warn("LINUX DO JCEF main frame failed: " + diagnosticUrl(target) + ", reason=" + reason);
            SwingUtilities.invokeLater(() -> {
                if (disposed) return;
                showingErrorPage = true;
                updateChallengeNotice();
                status.setText("加载失败，可重试");
                loadErrorMessage.setText("网页暂时无法显示：" + reason);
                refreshButton.setEnabled(true);
                navigationLocked = false;
                navigationButtons.values().forEach(button -> button.setEnabled(true));
                updateSearchAvailability();
                browser.getCefBrowser().stopLoad();
                pageLayout.show(pageContainer, "error");
            });
        }

        private static String diagnosticUrl(String value) {
            if (value == null || value.isBlank()) return "<empty>";
            try {
                URI uri = URI.create(value);
                String host = uri.getHost();
                return host == null ? uri.getScheme() + ":" : uri.getScheme() + "://" + host + uri.getPath();
            } catch (IllegalArgumentException ignored) {
                return "<invalid>";
            }
        }

        private void updateNavigationState(String currentUrl) {
            navigationButtons.forEach((url, button) -> button.setSelected(ForumSite.samePage(currentUrl, url)));
            shareButton.setEnabled(siteFor(currentUrl).shareSupported()
                    && ShareCode.fromTopicUrl(currentUrl, safeCurrentTitle()) != null);
        }

        private ForumSite siteFor(String url) {
            ForumSite site = ForumSite.forUrl(url);
            return site != null ? site : currentSite;
        }

        private String navigationLabel(String url) {
            return siteFor(url).navigationLabel(url);
        }

        private String safeCurrentTitle() {
            return siteFor(browser.getCefBrowser().getURL()).pageTitle(currentPageTitle);
        }

        private String historyTitleForUrl(String url, String title) {
            return siteFor(url).historyTitle(url, title);
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

        private void favoriteCurrentTopic() {
            String topicUrl = ForumSite.topicUrl(browser.getCefBrowser().getURL());
            if (topicUrl == null) {
                status.setText("请先打开一个主题");
                return;
            }
            String title = safeCurrentTitle();
            ReaderFavorites.Folder folder = chooseFavoriteFolder();
            if (folder == null) return;
            try {
                replaceFavoriteFolders(ReaderFavorites.add(
                        favoriteFolders, folder.id(), topicUrl, title, System.currentTimeMillis()));
                status.setText("已收藏到“" + folder.name() + "”");
            } catch (IllegalArgumentException error) {
                JOptionPane.showMessageDialog(this, error.getMessage(), "无法收藏", JOptionPane.WARNING_MESSAGE);
            }
        }

        private ReaderFavorites.Folder chooseFavoriteFolder() {
            ArrayList<String> options = favoriteFolders.stream()
                    .map(ReaderFavorites.Folder::name)
                    .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            String createLabel = "＋ 新建收藏目录";
            options.add(createLabel);
            Object selected = JOptionPane.showInputDialog(
                    this, "选择收藏目录", "收藏当前主题", JOptionPane.PLAIN_MESSAGE,
                    null, options.toArray(), options.get(0));
            if (selected == null) return null;
            if (createLabel.equals(selected.toString())) return promptCreateFavoriteFolder();
            return favoriteFolders.stream().filter(folder -> folder.name().equals(selected.toString())).findFirst().orElse(null);
        }

        private ReaderFavorites.Folder promptCreateFavoriteFolder() {
            while (true) {
                String name = JOptionPane.showInputDialog(this, "目录名称", "新建收藏目录", JOptionPane.PLAIN_MESSAGE);
                if (name == null) return null;
                String id = "folder-" + UUID.randomUUID().toString().replace("-", "");
                try {
                    replaceFavoriteFolders(ReaderFavorites.createFolder(
                            favoriteFolders, name, id, System.currentTimeMillis()));
                    return favoriteFolders.stream().filter(folder -> folder.id().equals(id)).findFirst().orElse(null);
                } catch (IllegalArgumentException error) {
                    JOptionPane.showMessageDialog(this, error.getMessage(), "无法创建目录", JOptionPane.WARNING_MESSAGE);
                }
            }
        }

        private void replaceFavoriteFolders(List<ReaderFavorites.Folder> updated) {
            favoriteFolders.clear();
            favoriteFolders.addAll(updated);
            if (favoriteFolders.isEmpty()) properties.unsetValue(FAVORITES_PROPERTY);
            else properties.setValue(FAVORITES_PROPERTY, ReaderFavorites.serialize(favoriteFolders));
        }

        private void showFavoritesPopup() {
            if (favoritesPopup != null && favoritesPopup.isVisible()) {
                favoritesPopup.cancel();
                return;
            }
            FavoritesPanel panel = new FavoritesPanel(favoriteFolders, this::replaceFavoriteFolders,
                    url -> {
                        if (favoritesPopup != null) favoritesPopup.cancel();
                        navigateTo(url);
                    }, url -> {
                        CopyPasteManager.getInstance().setContents(new StringSelection(url));
                        status.setText("链接已复制");
                    }, () -> { if (favoritesPopup != null) favoritesPopup.cancel(); });
            favoritesPanel = panel;
            int popupWidth = Math.min(JBUI.scale(760), Math.max(JBUI.scale(320), getWidth() - JBUI.scale(24)));
            int popupHeight = Math.min(JBUI.scale(600), Math.max(JBUI.scale(400), getHeight() - JBUI.scale(120)));
            panel.setPreferredSize(new Dimension(popupWidth, popupHeight));
            JBPopup popup = JBPopupFactory.getInstance()
                    .createComponentPopupBuilder(panel, panel.preferredFocus())
                    .setMinSize(new Dimension(JBUI.scale(320), JBUI.scale(400)))
                    .setResizable(true)
                    .setMovable(true)
                    .setRequestFocus(true)
                    .setCancelKeyEnabled(false)
                    .setCancelOnClickOutside(true)
                    .setCancelOnOtherWindowOpen(false)
                    .createPopup();
            popup.addListener(new JBPopupListener() {
                @Override public void onClosed(@NotNull LightweightWindowEvent event) {
                    panel.dispose();
                    if (favoritesPopup == popup) {
                        favoritesPopup = null;
                        favoritesPanel = null;
                    }
                }
            });
            favoritesPopup = popup;
            favoritesPopup.showUnderneathOf(overflowButton);
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
            shareButton.setEnabled(false);
            status.setText("正在生成加密分享…");
            CompletableFuture
                    .supplyAsync(() -> ShareCode.create(topic, settings.password(), settings.duration(), now))
                    .whenComplete((code, error) -> SwingUtilities.invokeLater(() -> {
                        if (disposed) return;
                        updateNavigationState(browser.getCefBrowser().getURL());
                        if (error != null) {
                            status.setText(idleStatus());
                            JOptionPane.showMessageDialog(this, failureMessage(error), "无法生成分享", JOptionPane.ERROR_MESSAGE);
                            return;
                        }
                        showShareResult(code, settings, now);
                    }));
        }

        private void showShareResult(String code, ShareSettings settings, long now) {
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
            String content = input.toString();
            openShareButton.setEnabled(false);
            status.setText("正在解密分享内容…");
            CompletableFuture
                    .supplyAsync(() -> ShareCode.parse(content, password, System.currentTimeMillis()))
                    .whenComplete((decoded, error) -> SwingUtilities.invokeLater(() -> {
                        if (disposed) return;
                        openShareButton.setEnabled(true);
                        if (error != null) {
                            status.setText(idleStatus());
                            JOptionPane.showMessageDialog(this, failureMessage(error), "无法打开分享", JOptionPane.ERROR_MESSAGE);
                            return;
                        }
                        navigateTo(decoded.topic().url());
                    }));
        }

        private static String failureMessage(Throwable error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            String message = cause.getMessage();
            return message == null || message.isBlank() ? cause.toString() : message;
        }

        private void showShareHelp() {
            JOptionPane.showMessageDialog(
                    this,
                    "加密分享目前只支持 LINUX DO 主题。\n\n"
                            + "1. 打开一个公开主题，点击工具栏“分享”。\n"
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

        private void retryReaderMode() {
            CefBrowser cefBrowser = browser.getCefBrowser();
            if (disposed || cefBrowser == null) return;
            readerFallbackActive = false;
            cefBrowser.executeJavaScript("window.__lexiaoReaderModeApplied=null;", cefBrowser.getURL(), 0);
            applyPageStyle(cefBrowser);
        }

        private void applyPageStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) {
                return;
            }
            boolean readerMode = demoMode;
            ForumSite.Reader reader = siteFor(cefBrowser.getURL()).reader();
            String css = readerMode ? ideTheme.applyToReaderCss(DEMO_PAGE_STYLE + "\n" + SITE_STYLES.get(reader.css())) : "";
            String script = "(function(){"
                    + "var id='lexiao-guest-reader-style';"
                    + "var style=document.getElementById(id);"
                    + "if(!style){style=document.createElement('style');style.id=id;document.head.appendChild(style);}"
                    + "style.textContent=\"" + escapeJavaScript(css) + "\";"
                    + "var loadingId='lexiao-guest-loading-privacy';"
                    + "var loadingStyle=document.getElementById(loadingId);"
                    + "if(loadingStyle){loadingStyle.remove();}"
                    + "if(window.__lexiaoLoadingMaskTimer){"
                    + "clearTimeout(window.__lexiaoLoadingMaskTimer);window.__lexiaoLoadingMaskTimer=0;}"
                    + "})();\n"
                    + "if(window.__lexiaoReaderModeApplied!==" + readerMode + "){\n"
                    + READER_MODE_SCRIPT.replace("__LEXIAO_DEMO_MODE__", Boolean.toString(readerMode))
                            .replace("__LEXIAO_READER_SITE__", readerSiteJson(reader))
                    + "\nwindow.__lexiaoReaderModeApplied=" + readerMode + ";}"
                    + "else if(window.__lexiaoReaderModeSync){window.__lexiaoReaderModeSync();}";
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private void applyLoadingPrivacyStyle(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) return;
            ForumSite site = loadingSite != null ? loadingSite : siteFor(cefBrowser.getURL());
            String loadingCss = ideTheme.applyToReaderCss(DEMO_LOADING_STYLE + SITE_STYLES.get(site.reader().loadingCss()));
            String script = "(function(){"
                    + "var id='lexiao-guest-loading-privacy';"
                    + "var style=document.getElementById(id);"
                    + "if(!style){style=document.createElement('style');style.id=id;"
                    + "(document.head||document.documentElement).appendChild(style);}"
                    + "style.textContent=\"" + escapeJavaScript(loadingCss) + "\";"
                    // 任何“先遮住、等 Java 回调再揭开”的机制，都必须能在回调永不到来时自行恢复。
                    // 进程外 JCEF 已经证明那个回调会丢，遮罩留下就是一片白且没有任何提示。
                    + "if(window.__lexiaoLoadingMaskTimer){clearTimeout(window.__lexiaoLoadingMaskTimer);}"
                    + "window.__lexiaoLoadingMaskTimer=setTimeout(function(){"
                    + "window.__lexiaoLoadingMaskTimer=0;"
                    + "var stale=document.getElementById(id);"
                    + "if(stale){stale.remove();"
                    + "console.info('LEXIAO_MASK_SELF_CLEARED {\"after\":" + LOADING_MASK_MAX_MILLIS + "}');}"
                    + "if(window.__lexiaoPageProbe){window.__lexiaoPageProbe('mask-self-cleared');}"
                    + "}," + LOADING_MASK_MAX_MILLIS + ");"
                    + "})();";
            cefBrowser.executeJavaScript(script, cefBrowser.getURL(), 0);
        }

        private void injectPageProbe(CefBrowser cefBrowser) {
            if (disposed || cefBrowser == null) return;
            String root = jsString(siteFor(cefBrowser.getURL()).reader().root());
            cefBrowser.executeJavaScript(PAGE_PROBE_SCRIPT.replace("__LEXIAO_ROOT_SELECTOR__", root), cefBrowser.getURL(), 0);
        }

        private void refreshIdeTheme() {
            if (disposed) return;
            ideTheme = IdeThemePalette.current();
            browser.getComponent().setBackground(ideTheme.background());
            applyPageStyle(browser.getCefBrowser());
            String script = "if(window.__linuxDoGameUIController?.setTheme){"
                    + "window.__linuxDoGameUIController.setTheme(" + ideTheme.gameThemeJson() + ");}";
            browser.getCefBrowser().executeJavaScript(script, browser.getCefBrowser().getURL(), 0);
        }

        private static String readerSiteJson(ForumSite.Reader reader) {
            return "{\"root\":" + jsString(reader.root())
                    + ",\"content\":" + jsString(reader.content())
                    + ",\"identity\":" + jsString(reader.identity())
                    + ",\"username\":" + jsString(reader.username()) + "}";
        }

        private static String jsString(String value) {
            return "\"" + escapeJavaScript(value) + "\"";
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

            CefResourceRequestHandler mainFrameResponseObserver = new CefResourceRequestHandlerAdapter() {
                @Override
                public boolean onResourceResponse(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        CefRequest request,
                        CefResponse response
                ) {
                    Map<String, String> headers = new HashMap<>();
                    response.getHeaderMap(headers);
                    String mitigated = "";
                    for (Map.Entry<String, String> header : headers.entrySet()) {
                        if ("cf-mitigated".equalsIgnoreCase(header.getKey())) mitigated = header.getValue();
                    }
                    mainFrameCfMitigated = headers.isEmpty() ? null : mitigated;
                    LOG.info("LINUX DO JCEF main frame response: " + diagnosticUrl(request.getURL())
                            + ", status=" + response.getStatus() + ", headers=" + headers.size()
                            + ", cf-mitigated=" + mainFrameCfMitigated);
                    return false;
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
                    if (ForumSite.isAuthenticationUrl(url)) {
                        if (isRedirect || !userGesture) {
                            showLoadFailure("站点将游客请求重定向到登录页面", url);
                        } else {
                            SwingUtilities.invokeLater(() -> status.setText("游客模式不允许登录"));
                        }
                        return true;
                    }
                    if (ForumSite.isAllowedGuestUrl(url)) {
                        mainFrameCfMitigated = null;
                        loadingSite = ForumSite.forUrl(url);
                        // A new request is not proof that verification passed. Keep the original
                        // deadline across automatic reloads/redirects until a successful main frame.
                        if (documentLoadState.isChallengeActive()) {
                            lastRequestedUrl = url;
                            LOG.info("LINUX DO JCEF challenge navigation, still awaiting verification: "
                                    + diagnosticUrl(url));
                            return false;
                        }
                        if (!ForumSite.samePage(cefBrowser.getURL(), url)) {
                            documentLoadState.begin();
                            lastRequestedUrl = url;
                            showingErrorPage = false;
                            SwingUtilities.invokeLater(() -> {
                                if (disposed || documentLoadState.isChallengeActive()) return;
                                pageLoadTimer.restart();
                                pageLayout.show(pageContainer, "browser");
                                status.setText("加载中...");
                            });
                        } else {
                            SwingUtilities.invokeLater(() -> {
                                if (!disposed && !documentLoadState.isChallengeActive()) status.setText(idleStatus());
                            });
                        }
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
                    if (ForumSite.isAuthenticationWrite(request.getMethod(), request.getURL())) return authenticationBlocker;
                    return isNavigation && frame != null && frame.isMain() ? mainFrameResponseObserver : null;
                }
            }, browser.getCefBrowser());
        }

        private boolean handleBreakAction(String url) {
            try {
                ForumSite site = ForumSite.forUrl(url);
                if (site == null || !url.startsWith(site.origin() + BREAK_ACTION_PATH)) {
                    return false;
                }
                URI uri = URI.create(url);

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
            String bundle = "if(!window.__lexiaoGameBundleLoaded){\n"
                    + GAME_CORE_SCRIPT + "\n" + GAME_UI_SCRIPT
                    + "\nwindow.__lexiaoGameBundleLoaded=true;}";
            String overlay = BREAK_OVERLAY_SCRIPT.replace(
                    "__LEXIAO_RECOMMENDED_GAME__",
                    "\"" + escapeJavaScript(recommendedGame) + "\""
            ).replace("__LEXIAO_REMINDER_MODE__", Boolean.toString(breakOverlayReminderMode))
                    .replace("__LEXIAO_BEST_SCORES__", gameBestScoresJson())
                    .replace("__LEXIAO_THEME__", ideTheme.gameThemeJson());
            String url = cefBrowser.getURL();
            overlay = overlay.replace("__LEXIAO_BREAK_BASE__", jsString(siteFor(url).origin() + BREAK_ACTION_PATH));
            cefBrowser.executeJavaScript(bundle, url, 0);
            cefBrowser.executeJavaScript(overlay, url, 0);
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
                    status.setText(idleStatus());
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

        private static Map<String, String> loadSiteStyles() {
            Map<String, String> styles = new LinkedHashMap<>();
            for (ForumSite site : ForumSite.values()) {
                styles.computeIfAbsent(site.reader().css(), GuestBrowserPanel::loadResourceScript);
                styles.computeIfAbsent(site.reader().loadingCss(), GuestBrowserPanel::loadResourceScript);
            }
            return styles;
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

        private void startGuestSession() {
            guestSessionInitializing = true;
            pendingNavigationUrl = currentSite.homeUrl();
            status.setText("正在清理游客会话...");
            clearForumCookies(() -> {
                guestSessionInitializing = false;
                if (pendingNavigationUrl == null) pendingNavigationUrl = currentSite.homeUrl();
                continuePendingNavigation();
            });
        }

        private void clearForumCookies(Runnable afterClear) {
            GuestSessionCleanup.CookieStore store = new JcefCookieStore(cookieManager);
            GuestSessionCleanup.run(() -> GuestSessionCleanup.clearForumCookies(store),
                            AppExecutorUtil.getAppExecutorService(), COOKIE_CLEANUP_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .whenComplete((cleared, error) -> SwingUtilities.invokeLater(() -> {
                if (!disposed) {
                    if (error != null || !Boolean.TRUE.equals(cleared)) {
                        LOG.warn("LINUX DO JCEF cookie cleanup did not complete before startup; continuing as guest");
                    } else {
                        LOG.info("LINUX DO JCEF guest cookie cleanup completed");
                    }
                    afterClear.run();
                }
            }));
        }

        @Override
        public void dispose() {
            stopBreakTimer();
            pageLoadTimer.stop();
            documentSettleTimer.stop();
            challengeTimer.stop();
            if (historyPopup != null) historyPopup.cancel();
            if (favoritesPopup != null) favoritesPopup.cancel();
            if (favoritesPanel != null) favoritesPanel.dispose();
            favoritesPopup = null;
            favoritesPanel = null;
            breakOverlayVisible = false;
            removeBreakOverlay();
            disposed = true;
            try {
                for (ForumSite site : ForumSite.values()) {
                    site.cookieUrls().forEach(url -> cookieManager.deleteCookies(url, null));
                }
                // 域 Cookie 只能逐个按名称删；关闭时尽力而为，下次启动的清理才是兜底。
                GuestSessionCleanup.CookieStore store = new JcefCookieStore(cookieManager);
                AppExecutorUtil.getAppExecutorService().execute(() -> {
                    try {
                        GuestSessionCleanup.clearForumCookies(store);
                    } catch (Exception error) {
                        LOG.info("LINUX DO JCEF cookie sweep on dispose did not finish: " + error.getClass().getSimpleName());
                    }
                });
            } catch (RuntimeException error) {
                LOG.info("LINUX DO JCEF cookie cleanup on dispose skipped: " + error.getClass().getSimpleName());
            } finally {
                browser.dispose();
            }
        }
    }

    private static final class JcefCookieStore implements GuestSessionCleanup.CookieStore {
        private static final int TIMEOUT_SECONDS = GuestBrowserPanel.COOKIE_CLEANUP_TIMEOUT_SECONDS;
        private final JBCefCookieManager cookieManager;

        private JcefCookieStore(JBCefCookieManager cookieManager) {
            this.cookieManager = cookieManager;
        }

        @Override
        public boolean deleteHostCookies(String url) throws Exception {
            return Boolean.TRUE.equals(cookieManager.deleteCookies(url, null).get(TIMEOUT_SECONDS, TimeUnit.SECONDS));
        }

        @Override
        public List<GuestSessionCleanup.CookieRef> listCookies() throws Exception {
            return cookieManager.getCookies(null, true).get(TIMEOUT_SECONDS, TimeUnit.SECONDS).stream()
                    .map(cookie -> new GuestSessionCleanup.CookieRef(cookie.getName(), cookie.getDomain(), cookie.getPath()))
                    .toList();
        }

        @Override
        public boolean deleteCookie(String url, String name) throws Exception {
            return Boolean.TRUE.equals(cookieManager.deleteCookies(url, name).get(TIMEOUT_SECONDS, TimeUnit.SECONDS));
        }
    }
}
