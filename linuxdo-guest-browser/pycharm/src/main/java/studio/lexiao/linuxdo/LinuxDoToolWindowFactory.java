package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
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
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NotNull;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JToggleButton;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Font;
import java.awt.FlowLayout;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
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
        private final JToggleButton compactButton = new JToggleButton("≡", true);
        private final JBTextField searchField = new JBTextField();
        private final JLabel status = new JLabel("正在启动游客会话...");
        private volatile boolean compactMode = true;
        private volatile boolean disposed;

        private GuestBrowserPanel() {
            super(new BorderLayout());
            setBorder(BorderFactory.createEmptyBorder());
            add(createToolbar(), BorderLayout.NORTH);
            add(browser.getComponent(), BorderLayout.CENTER);
            installGuestOnlyNavigationGuard();
            installHistoryStateHandler();
            startGuestSession();
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

            JLabel brand = new JLabel("LINUX DO");
            brand.setFont(brand.getFont().deriveFont(Font.BOLD, brand.getFont().getSize2D() - 1f));
            JLabel readOnly = new JLabel("只读");
            readOnly.setForeground(JBColor.GRAY);
            readOnly.setFont(readOnly.getFont().deriveFont(readOnly.getFont().getSize2D() - 2f));
            readOnly.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createLineBorder(JBColor.border()),
                    JBUI.Borders.empty(1, 5)
            ));

            compactButton.setToolTipText("切换紧凑/原始网页布局");
            compactButton.setFocusable(false);
            compactButton.setMargin(JBUI.insets(2, 8));
            resetButton.setFocusable(false);

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

            historyAndBrand.add(backButton);
            historyAndBrand.add(forwardButton);
            historyAndBrand.add(Box.createHorizontalStrut(4));
            historyAndBrand.add(brand);
            historyAndBrand.add(readOnly);
            tools.add(compactButton);
            tools.add(refreshButton);
            tools.add(resetButton);
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
            return toolbar;
        }

        private JButton navigationButton(String label, String url) {
            JButton button = new JButton(label);
            button.setFocusable(false);
            button.setMargin(JBUI.insets(2, 8));
            button.addActionListener(event -> browser.loadURL(url));
            return button;
        }

        private void search() {
            String query = searchField.getText().trim();
            if (query.isEmpty() || disposed) {
                return;
            }
            browser.loadURL("https://linux.do/search?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8));
        }

        private static JButton iconButton(javax.swing.Icon icon, String tooltip) {
            JButton button = new JButton(icon);
            button.setToolTipText(tooltip);
            button.setFocusable(false);
            return button;
        }

        private void installHistoryStateHandler() {
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
                        status.setText(isLoading ? "加载中..." : "游客模式");
                    });
                }

                @Override
                public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                    if (frame != null && frame.isMain() && httpStatusCode < 400) {
                        applyPageStyle(cefBrowser);
                    }
                }
            }, browser.getCefBrowser());
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
            status.setText("正在清理游客会话...");
            clearLinuxDoCookies(() -> {
                status.setText("游客模式");
                loadHome();
            });
        }

        private void loadHome() {
            if (!disposed) {
                browser.loadURL(HOME_URL);
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
            disposed = true;
            try {
                cookieManager.deleteCookies(DOMAIN_URL, null);
            } finally {
                browser.dispose();
            }
        }
    }
}
