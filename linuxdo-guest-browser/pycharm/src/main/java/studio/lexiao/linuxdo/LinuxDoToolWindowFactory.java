package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefCookieManager;
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
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.net.URI;
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

        private final JBCefBrowser browser = new JBCefBrowser("about:blank");
        private final JBCefCookieManager cookieManager = browser.getJBCefCookieManager();
        private final JButton backButton = iconButton(AllIcons.Actions.Back, "Go back");
        private final JButton forwardButton = iconButton(AllIcons.Actions.Forward, "Go forward");
        private final JButton refreshButton = iconButton(AllIcons.Actions.Refresh, "Reload this page");
        private final JLabel status = new JLabel("Starting a clean guest session...");
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
            JPanel toolbar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 5));
            JButton home = new JButton("Home");
            JButton cleanSession = new JButton("New Guest Session");

            home.setToolTipText("Open LINUX DO latest topics");
            cleanSession.setToolTipText("Clear linux.do cookies and return home");

            backButton.setEnabled(false);
            forwardButton.setEnabled(false);
            backButton.addActionListener(event -> browser.getCefBrowser().goBack());
            forwardButton.addActionListener(event -> browser.getCefBrowser().goForward());
            home.addActionListener(event -> loadHome());
            refreshButton.addActionListener(event -> browser.getCefBrowser().reload());
            cleanSession.addActionListener(event -> startGuestSession());

            toolbar.add(backButton);
            toolbar.add(forwardButton);
            toolbar.add(home);
            toolbar.add(refreshButton);
            toolbar.add(cleanSession);
            toolbar.add(Box.createHorizontalStrut(8));
            toolbar.add(status);
            return toolbar;
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
                        status.setText(isLoading ? "Loading..." : "Guest mode");
                    });
                }
            }, browser.getCefBrowser());
        }

        private void installGuestOnlyNavigationGuard() {
            CefResourceRequestHandler authenticationBlocker = new CefResourceRequestHandlerAdapter() {
                @Override
                public boolean onBeforeResourceLoad(
                        CefBrowser cefBrowser,
                        CefFrame frame,
                        CefRequest request
                ) {
                    SwingUtilities.invokeLater(() -> status.setText("Blocked: authentication is disabled"));
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
                        SwingUtilities.invokeLater(() -> status.setText("Guest mode"));
                        return false;
                    }

                    SwingUtilities.invokeLater(() -> status.setText("Blocked: guest reader stays on linux.do"));
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
            status.setText("Clearing linux.do cookies...");
            clearLinuxDoCookies(() -> {
                status.setText("Guest mode");
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
