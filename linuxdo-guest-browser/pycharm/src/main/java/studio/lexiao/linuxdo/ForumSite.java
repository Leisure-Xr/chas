package studio.lexiao.linuxdo;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

// 只依赖 JDK：ReaderHistory、ReaderFavorites 的测试在没有 IDE jar 的 classpath 上运行。
enum ForumSite {
    LINUX_DO("linuxdo", "LINUX DO", Engine.DISCOURSE, "linux.do", List.of(), true,
            List.of(new NavEntry("最新", "/latest", "最新主题"),
                    new NavEntry("热门", "/top", "本周热门"),
                    new NavEntry("分类", "/categories", "浏览分类")),
            "/search?q=", "\\s+-\\s+(?:LINUX DO|搞七捻三)\\s*$", List.of("LINUX DO", "搞七捻三"), 20_000),
    // 游客搜索会被转到 Google；托管验证有时要用户点一下，所以超时放宽。
    NODESEEK("nodeseek", "NodeSeek", Engine.NODESEEK, "www.nodeseek.com", List.of("nodeseek.com"), false,
            List.of(new NavEntry("最新", "/", "NodeSeek 最新回复"),
                    new NavEntry("新帖", "/?sortBy=postTime", "NodeSeek 最新发帖"),
                    new NavEntry("精品", "/award", "NodeSeek 精品贴")),
            null, "^NodeSeek\\s*-\\s*|\\s+-\\s+NodeSeek\\s*$", List.of("NodeSeek"), 45_000),
    // 站内搜索只对登录用户开放；需要登录的节点会跳到 /signin，按登录重定向处理，不绕过。
    V2EX("v2ex", "V2EX", Engine.V2EX, "www.v2ex.com", List.of("v2ex.com"), false,
            List.of(new NavEntry("全部", "/?tab=all", "V2EX 全部主题"),
                    new NavEntry("最热", "/?tab=hot", "V2EX 最热主题"),
                    new NavEntry("节点", "/planes", "V2EX 节点导航")),
            null, "^V2EX\\s*›\\s*|\\s+-\\s+V2EX\\s*$", List.of("V2EX"), 20_000),
    IDCFLARE("idcflare", "IDC Flare", Engine.DISCOURSE, "idcflare.com", List.of(), false,
            List.of(new NavEntry("最新", "/latest", "IDC Flare 最新主题"),
                    new NavEntry("热门", "/top", "IDC Flare 本周热门"),
                    new NavEntry("分类", "/categories", "IDC Flare 浏览分类")),
            "/search?q=", "\\s+-\\s+IDC Flare\\s*$", List.of("IDC Flare"), 20_000);

    static final ForumSite DEFAULT = LINUX_DO;
    private static final Pattern DISCOURSE_TOPIC_PATH = Pattern.compile("^/t/(?:([^/]+)/)?([1-9][0-9]*)(?:/.*)?$");
    private static final Pattern V2EX_TOPIC_PATH = Pattern.compile("^/t/([1-9][0-9]*)(?:/.*)?$");
    private static final Pattern NODESEEK_TOPIC_PATH = Pattern.compile("^/post-([1-9][0-9]*)-[0-9]+/?$");
    // 首页、版块和精品列表的分页都折叠到第一页；group(1) 为空表示首页。
    private static final Pattern NODESEEK_LIST_PATH = Pattern.compile("^(/categories/[^/]+|/award)?(?:/page-[0-9]+)?/?$");
    // Cloudflare 验证页的标题：英文原文，以及按 Accept-Language 本地化后的中文。
    private static final Pattern CHALLENGE_TITLE = Pattern.compile("^(?:Just a moment|请稍候)(?:\\.\\.\\.|…)?$",
            Pattern.CASE_INSENSITIVE);

    enum Engine {
        DISCOURSE("/latest",
                List.of("/login", "/signup", "/session", "/auth", "/oauth2"),
                List.of("/session", "/users", "/auth", "/oauth2", "/user-api-key"),
                List.of("/login", "/signup", "/session", "/auth", "/cdn-cgi/"),
                new Reader("/sites/discourse.css", "/sites/discourse-loading.css", "#main-outlet",
                        ".topic-list,.category-list,#topic-title,.topic-post",
                        String.join(",",
                                ".avatar", ".avatar-flair", ".avatar-flair-preview", ".topic-avatar", ".topic-list .posters",
                                ".user-card", ".user-card-avatar", ".user-card-popup", ".user-card .badge-wrapper",
                                ".user-card .badge-grouping", ".user-card .user-badge", ".user-card .user-status-message",
                                ".topic-post .names .badge-wrapper", ".topic-post .names .badge-grouping",
                                ".topic-post .names .user-title", ".topic-post .names .user-status",
                                ".topic-post .names .poster-icon", ".topic-post .names .full-name",
                                ".topic-post .names .primary-group", ".topic-post .names .user-profile-link",
                                ".poster-icon", ".presence", ".user-status-background", ".user-status-message"),
                        ".topic-post .names a.username,.topic-post .names .username,.topic-post .names a[data-user-card]"),
                "^/t/.*"),
        V2EX("/",
                List.of("/signin", "/signup", "/auth", "/2fa", "/forgot"),
                List.of("/signin", "/signup", "/auth", "/2fa", "/forgot"),
                List.of("/signin", "/signup", "/auth", "/2fa", "/forgot", "/cdn-cgi/"),
                new Reader("/sites/v2ex.css", "/sites/v2ex-loading.css", "#Main", "#Main .box",
                        ".avatar,.badges,.badge,#Main .header > .fr",
                        "#Main .topic_info strong > a,#Main strong > a.dark,#Main .header small.gray > a"),
                "^/t/[1-9][0-9]*$"),
        NODESEEK("/",
                List.of("/signin.html", "/register.html"),
                List.of("/signin.html", "/register.html", "/api/account"),
                List.of("/signin", "/register", "/api/", "/cdn-cgi/"),
                new Reader("/sites/nodeseek.css", "/sites/nodeseek-loading.css", "#nsk-body", ".post-list-item,.nsk-post",
                        ".avatar-normal,.avatar-wrapper,.nsk-badge,.role-tag,.user-card,.hover-user-card",
                        ".author-name,.info-author a,.info-last-commenter a"),
                "^/post-[1-9][0-9]*-1$");

        private final String emptyPath;
        // 精确匹配或作为父路径匹配；用于拦截导航和识别登录重定向。
        private final List<String> authPaths;
        // 非 GET/HEAD 请求命中这些路径时直接取消，游客会话不写入任何登录状态。
        private final List<String> authWritePaths;
        // 历史记录按前缀拒绝，与 16.0 及以前保持一致。
        private final List<String> historyRejectPrefixes;
        private final Reader reader;
        // 规范 URL 的路径部分匹配它时，才是可以收藏的主题。
        private final Pattern topicPath;

        Engine(String emptyPath, List<String> authPaths, List<String> authWritePaths,
               List<String> historyRejectPrefixes, Reader reader, String topicPath) {
            this.emptyPath = emptyPath;
            this.authPaths = authPaths;
            this.authWritePaths = authWritePaths;
            this.historyRejectPrefixes = historyRejectPrefixes;
            this.reader = reader;
            this.topicPath = Pattern.compile(topicPath);
        }
    }

    record NavEntry(String label, String path, String historyTitle) {}

    // 隐私阅读布局：content 出现时才启用；identity 整块隐藏，username 只弱化显示；root 仅用于诊断。
    record Reader(String css, String loadingCss, String root, String content, String identity, String username) {}

    private final String id;
    private final String displayName;
    private final Engine engine;
    private final String host;
    private final List<String> aliasHosts;
    private final boolean allowSubdomains;
    private final List<NavEntry> navigation;
    private final String searchPath;
    // 标签页标题里的站点名（前缀或后缀）。
    private final Pattern siteName;
    private final List<String> bareTitles;
    // Cloudflare 的验证页带着 403/503 返回；给页内脚本（需要点击时还有用户）留出完成并自动重载的时间。
    private final int challengeTimeoutMillis;

    ForumSite(String id, String displayName, Engine engine, String host, List<String> aliasHosts,
              boolean allowSubdomains, List<NavEntry> navigation, String searchPath, String siteName,
              List<String> bareTitles, int challengeTimeoutMillis) {
        this.id = id;
        this.displayName = displayName;
        this.engine = engine;
        this.host = host;
        this.aliasHosts = aliasHosts;
        this.allowSubdomains = allowSubdomains;
        this.navigation = navigation;
        this.searchPath = searchPath;
        this.siteName = Pattern.compile(siteName);
        this.bareTitles = bareTitles;
        this.challengeTimeoutMillis = challengeTimeoutMillis;
    }

    String id() {
        return id;
    }

    String displayName() {
        return displayName;
    }

    String origin() {
        return "https://" + host;
    }

    List<NavEntry> navigation() {
        return navigation;
    }

    Reader reader() {
        return engine.reader;
    }

    String url(NavEntry entry) {
        return origin() + entry.path();
    }

    String homeUrl() {
        return url(navigation.get(0));
    }

    int challengeTimeoutMillis() {
        return challengeTimeoutMillis;
    }

    // 删除主机 Cookie 用的地址：规范主机和所有别名。
    List<String> cookieUrls() {
        return Stream.concat(Stream.of(host), aliasHosts.stream())
                .map(name -> "https://" + name + "/")
                .toList();
    }

    // 站点 Cookie 所属的可注册域名，例如 www.v2ex.com → v2ex.com。
    private String cookieDomain() {
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    // 属于受支持论坛（含其子域名）的 Cookie 返回可按名称删除它的地址，其它 Cookie 返回 null。
    static String cookieDeletionUrl(String rawDomain, String path) {
        if (rawDomain == null) return null;
        String domain = rawDomain.toLowerCase(Locale.ROOT).replaceFirst("^\\.", "");
        for (ForumSite site : values()) {
            String siteDomain = site.cookieDomain();
            if (domain.equals(siteDomain) || domain.endsWith("." + siteDomain)) {
                return "https://" + domain + (path == null || path.isEmpty() ? "/" : path);
            }
        }
        return null;
    }

    boolean supportsSearch() {
        return searchPath != null;
    }

    String searchUrl(String query) {
        return supportsSearch() ? origin() + searchPath + URLEncoder.encode(query, StandardCharsets.UTF_8) : null;
    }

    String searchUnavailableHint() {
        return displayName + " 不提供游客站内搜索";
    }

    boolean isSearchUrl(String url) {
        return supportsSearch() && url != null && url.startsWith(origin() + searchPath.substring(0, searchPath.indexOf('?')));
    }

    String navigationLabel(String url) {
        for (NavEntry entry : navigation) {
            if (samePage(url, url(entry))) return entry.label();
        }
        return isSearchUrl(url) ? "搜索结果" : navigation.get(0).label();
    }

    String genericTopicTitle() {
        return displayName + " 公开主题";
    }

    String genericPageTitle() {
        return displayName + " 公开页面";
    }

    String stripSiteName(String title) {
        return siteName.matcher(title).replaceAll("");
    }

    // 浏览器标签页标题 → 历史、收藏、分享里使用的主题标题。
    String pageTitle(String rawTitle) {
        String title = rawTitle == null ? "" : stripSiteName(rawTitle.replaceFirst("^\\([0-9]+\\)\\s*", "")).trim();
        return title.isEmpty() ? genericTopicTitle() : title.substring(0, Math.min(200, title.length()));
    }

    String historyTitle(String url, String title) {
        for (NavEntry entry : navigation) {
            if (samePage(url, url(entry))) return entry.historyTitle();
        }
        if (isSearchUrl(url)) return "搜索结果";
        String normalized = title == null ? "" : title.trim();
        return bareTitles.stream().anyMatch(normalized::equalsIgnoreCase) ? genericPageTitle() : normalized;
    }

    // 规范 URL 上的固定标题；不在固定列表里时返回 null，保留页面自身的标题。
    String fixedHistoryTitle(String canonicalUrl) {
        for (NavEntry entry : navigation) {
            if (canonicalUrl.equals(url(entry))) return entry.historyTitle();
        }
        return isSearchUrl(canonicalUrl) ? "搜索结果" : null;
    }

    static ForumSite byId(String id) {
        for (ForumSite site : values()) {
            if (site.id.equals(id)) return site;
        }
        return DEFAULT;
    }

    static ForumSite forUrl(String url) {
        if (url == null) return null;
        try {
            return forHost(URI.create(url).getHost());
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static ForumSite forHost(String rawHost) {
        if (rawHost == null) return null;
        String host = rawHost.toLowerCase(Locale.ROOT);
        for (ForumSite site : values()) {
            if (site.host.equals(host) || site.aliasHosts.contains(host)
                    || site.allowSubdomains && host.endsWith("." + site.host)) return site;
        }
        return null;
    }

    // 历史和收藏只认规范主机与别名，不接受子域名。
    private static ForumSite forHistoryHost(String rawHost) {
        if (rawHost == null) return null;
        String host = rawHost.toLowerCase(Locale.ROOT);
        for (ForumSite site : values()) {
            if (site.host.equals(host) || site.aliasHosts.contains(host)) return site;
        }
        return null;
    }

    static boolean isAllowedGuestUrl(String url) {
        if (url == null || url.equals("about:blank")) return true;
        try {
            URI uri = URI.create(url);
            if (uri.getUserInfo() != null || !("https".equalsIgnoreCase(uri.getScheme())
                    || "http".equalsIgnoreCase(uri.getScheme()))) return false;
            ForumSite site = forHost(uri.getHost());
            return site != null && !site.isAuthenticationPath(lowerPath(uri));
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    static boolean isAuthenticationUrl(String url) {
        if (url == null || url.isBlank()) return false;
        try {
            URI uri = URI.create(url);
            ForumSite site = forHost(uri.getHost());
            return site != null && site.isAuthenticationPath(lowerPath(uri));
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    static boolean isAuthenticationWrite(String method, String url) {
        if (method == null || method.equalsIgnoreCase("GET") || method.equalsIgnoreCase("HEAD")) return false;
        if (url == null) return true;
        try {
            URI uri = URI.create(url);
            ForumSite site = forHost(uri.getHost());
            return site != null && matchesPath(lowerPath(uri), site.engine.authWritePaths);
        } catch (IllegalArgumentException ignored) {
            return true;
        }
    }

    private boolean isAuthenticationPath(String lowerPath) {
        return matchesPath(lowerPath, engine.authPaths);
    }

    private static boolean matchesPath(String path, List<String> paths) {
        for (String candidate : paths) {
            if (path.equals(candidate) || path.startsWith(candidate + "/")) return true;
        }
        return false;
    }

    private static String lowerPath(URI uri) {
        return uri.getPath() == null ? "/" : uri.getPath().toLowerCase(Locale.ROOT);
    }

    static boolean samePage(String left, String right) {
        if (left == null || right == null) return false;
        try {
            URI leftUri = URI.create(left);
            URI rightUri = URI.create(right);
            String leftHost = leftUri.getHost() == null ? "" : leftUri.getHost();
            String rightHost = rightUri.getHost() == null ? "" : rightUri.getHost();
            String leftPath = leftUri.getPath() == null ? "/" : leftUri.getPath().replaceAll("/$", "");
            String rightPath = rightUri.getPath() == null ? "/" : rightUri.getPath().replaceAll("/$", "");
            return leftHost.equalsIgnoreCase(rightHost) && leftPath.equalsIgnoreCase(rightPath)
                    && String.valueOf(leftUri.getQuery()).equals(String.valueOf(rightUri.getQuery()));
        } catch (IllegalArgumentException ignored) {
            return left.equals(right);
        }
    }

    // 历史和收藏使用的规范 URL；不是受支持论坛上可记录的公开页面时返回 null。
    static String canonicalUrl(String rawUrl) {
        if (rawUrl == null) return null;
        try {
            URI uri = URI.create(rawUrl.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null) return null;
            ForumSite site = forHistoryHost(uri.getHost());
            return site == null ? null : site.canonicalize(uri);
        } catch (IllegalArgumentException | URISyntaxException ignored) {
            return null;
        }
    }

    private String canonicalize(URI uri) throws URISyntaxException {
        String path = uri.getPath() == null || uri.getPath().isBlank() ? engine.emptyPath : uri.getPath();
        String lowerPath = path.toLowerCase(Locale.ROOT);
        for (String prefix : engine.historyRejectPrefixes) {
            if (lowerPath.startsWith(prefix)) return null;
        }
        String query = uri.getQuery();
        if (hasChallengeQuery(uri.getRawQuery())) return null;
        switch (engine) {
            case DISCOURSE -> {
                Matcher topic = DISCOURSE_TOPIC_PATH.matcher(path);
                if (topic.matches()) {
                    path = "/t/" + discourseSlug(topic) + "/" + discourseTopicId(topic);
                    query = null;
                } else if (lowerPath.matches("/(?:latest|top|categories)/?")) {
                    path = lowerPath.replaceAll("/$", "");
                    query = null;
                }
            }
            case V2EX -> {
                Matcher topic = V2EX_TOPIC_PATH.matcher(path);
                if (topic.matches()) {
                    path = "/t/" + topic.group(1);
                    query = null;
                } else if (path.equals("/")) {
                    query = keepParameter(query, "tab", "[a-z0-9]+");
                } else if (lowerPath.matches("/(?:recent|planes)/?|/go/[^/]+/?")) {
                    path = path.replaceAll("/$", "");
                    query = null;
                }
            }
            case NODESEEK -> {
                Matcher topic = NODESEEK_TOPIC_PATH.matcher(path);
                Matcher list = NODESEEK_LIST_PATH.matcher(path);
                if (topic.matches()) {
                    path = "/post-" + topic.group(1) + "-1";
                    query = null;
                } else if (list.matches()) {
                    path = list.group(1) == null ? "/" : list.group(1);
                    query = keepParameter(query, "sortBy", "[A-Za-z]+");
                }
            }
        }
        return new URI("https", null, host, -1, path, query, null).toString();
    }

    // 列表页只保留决定内容的那个参数（V2EX 的 tab、NodeSeek 的排序），其余参数一律丢弃。
    private static String keepParameter(String query, String name, String valuePattern) {
        if (query == null) return null;
        for (String parameter : query.split("&")) {
            if (parameter.startsWith(name + "=") && parameter.substring(name.length() + 1).matches(valuePattern)) {
                return parameter;
            }
        }
        return null;
    }

    // Cloudflare 验证流程的一次性参数（__cf_chl_tk、__cf_chl_f_tk、__cf_chl_rt_tk 等），按参数名前缀识别。
    static boolean hasChallengeParameters(String url) {
        if (url == null) return false;
        try {
            return hasChallengeQuery(URI.create(url).getRawQuery());
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static boolean hasChallengeQuery(String rawQuery) {
        if (rawQuery == null) return false;
        for (String parameter : rawQuery.split("&")) {
            if (isChallengeParameter(parameter)) return true;
        }
        return false;
    }

    private static boolean isChallengeParameter(String parameter) {
        return parameter.toLowerCase(Locale.ROOT).startsWith("__cf_chl_");
    }

    static boolean isChallengeTitle(String title) {
        return title != null && CHALLENGE_TITLE.matcher(title.trim()).matches();
    }

    // 刷新、重试和“在浏览器打开”用的地址：去掉一次性验证参数和片段，其余查询参数保留。
    static String reloadUrl(String url) {
        if (url == null) return null;
        try {
            URI uri = URI.create(url);
            if (uri.isOpaque() || uri.getRawAuthority() == null) return url;
            String query = uri.getRawQuery() == null ? "" : Stream.of(uri.getRawQuery().split("&"))
                    .filter(parameter -> !parameter.isEmpty() && !isChallengeParameter(parameter))
                    .collect(Collectors.joining("&"));
            String path = uri.getRawPath() == null ? "" : uri.getRawPath();
            return uri.getScheme() + "://" + uri.getRawAuthority() + path + (query.isEmpty() ? "" : "?" + query);
        } catch (IllegalArgumentException ignored) {
            return url;
        }
    }

    // 当前页面是主题时返回它的规范 URL，否则返回 null。
    static String topicUrl(String rawUrl) {
        String url = canonicalUrl(rawUrl);
        return url != null && isTopicUrl(url) ? url : null;
    }

    static boolean isTopicUrl(String canonicalUrl) {
        ForumSite site = forUrl(canonicalUrl);
        return site != null && canonicalUrl.startsWith(site.origin() + "/")
                && site.engine.topicPath.matcher(canonicalUrl.substring(site.origin().length())).matches();
    }

    // Discourse 的 /t/123/4 是“主题 123 的第 4 楼”，不是 slug 为 123 的主题 4：第一段是编号时它就是主题。
    private static String discourseTopicId(Matcher topic) {
        return isTopicNumber(topic.group(1)) ? topic.group(1) : topic.group(2);
    }

    private static String discourseSlug(Matcher topic) {
        return topic.group(1) == null || isTopicNumber(topic.group(1)) ? "topic" : topic.group(1);
    }

    private static boolean isTopicNumber(String segment) {
        return segment != null && segment.matches("[1-9][0-9]*");
    }

    // 加密分享里的主题：站点、主题编号，以及 Discourse 站点用的 ASCII slug（NodeSeek、V2EX 为空串）。
    record TopicRef(ForumSite site, long id, String slug) {}

    // 地址是可分享的主题时返回它的引用，否则返回 null。
    static TopicRef topicRef(String rawUrl) {
        String url = topicUrl(rawUrl);
        ForumSite site = url == null ? null : forUrl(url);
        if (site == null) return null;
        Matcher topic = (switch (site.engine) {
            case DISCOURSE -> DISCOURSE_TOPIC_PATH;
            case V2EX -> V2EX_TOPIC_PATH;
            case NODESEEK -> NODESEEK_TOPIC_PATH;
        }).matcher(url.substring(site.origin().length()));
        if (!topic.matches()) return null;
        try {
            if (site.engine != Engine.DISCOURSE) return new TopicRef(site, Long.parseLong(topic.group(1)), "");
            // 非 ASCII 的 slug 放不进分享格式（VS Code 版同样如此）；Discourse 会把 /t/topic/编号 重定向到原主题。
            String slug = discourseSlug(topic);
            return new TopicRef(site, Long.parseLong(discourseTopicId(topic)),
                    slug.matches("[A-Za-z0-9_-]{1,200}") ? slug : "topic");
        } catch (NumberFormatException overflow) {
            return null;
        }
    }

    // 打开分享时的主题地址，与 topicRef 互逆。
    String shareTopicUrl(long id, String slug) {
        return switch (engine) {
            case DISCOURSE -> origin() + "/t/" + (isTopicNumber(slug) ? "topic" : slug) + "/" + id;
            case V2EX -> origin() + "/t/" + id;
            case NODESEEK -> origin() + "/post-" + id + "-1";
        };
    }

    boolean usesTopicSlug() {
        return engine == Engine.DISCOURSE;
    }

    // 分享内容里的站点 ID 必须精确匹配，不能像 byId 那样回退到默认站点。
    static ForumSite forShareId(String id) {
        for (ForumSite site : values()) {
            if (site.id.equals(id)) return site;
        }
        return null;
    }
}
