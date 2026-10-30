package studio.lexiao.linuxdo;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ForumSiteTest {
    private static final Set<String> THEME_PLACEHOLDERS = Set.of(
            "__LEX_IDE_BG__", "__LEX_IDE_PANEL__", "__LEX_IDE_SOFT__", "__LEX_IDE_BORDER__",
            "__LEX_IDE_TEXT__", "__LEX_IDE_MUTED__", "__LEX_IDE_ACCENT__", "__LEX_IDE_SCHEME__");

    public static void main(String[] args) throws IOException {
        shipReaderAssetsForEverySite();
        keepLinuxDoHistoryUrlsFrom16();
        keepLinuxDoGuardFrom16();
        keepLinuxDoTitlesFrom16();
        compareHostsInSamePage();
        keepLinuxDoAuthenticationWritesFrom16();
        buildLinuxDoNavigation();
        canonicalizeOtherForums();
        guardOtherForums();
        rejectCredentialAndNonWebNavigation();
        mixedForumPersistenceChain();
        cleanOtherForumTitles();
        describeOtherForums();
        shareTopicsOnEveryForum();
        recognizeCloudflareChallenges();
    }

    // {input, canonical history URL or null, favoritable topic}. Paths and titles checked on the live sites.
    private static final String[][] OTHER_HISTORY = {
            {"https://www.nodeseek.com/post-969428-3#12", "https://www.nodeseek.com/post-969428-1", "true"},
            {"https://nodeseek.com/post-1-1", "https://www.nodeseek.com/post-1-1", "true"},
            {"https://www.nodeseek.com", "https://www.nodeseek.com/", "false"},
            {"https://www.nodeseek.com/page-3?sortBy=postTime&x=1", "https://www.nodeseek.com/?sortBy=postTime", "false"},
            {"https://www.nodeseek.com/categories/tech/page-2", "https://www.nodeseek.com/categories/tech", "false"},
            {"https://www.nodeseek.com/award", "https://www.nodeseek.com/award", "false"},
            {"https://www.nodeseek.com/space/9", "https://www.nodeseek.com/space/9", "false"},
            {"https://www.nodeseek.com/signIn.html", null, "false"},
            {"https://www.nodeseek.com/api/statistics/forum", null, "false"},
            {"https://www.deepflood.com/post-1-1", null, "false"},
            {"https://v2ex.com/t/1246711?p=2#reply5", "https://www.v2ex.com/t/1246711", "true"},
            {"https://www.v2ex.com/?tab=hot&x=1", "https://www.v2ex.com/?tab=hot", "false"},
            {"https://www.v2ex.com/", "https://www.v2ex.com/", "false"},
            {"https://www.v2ex.com/go/python?p=3", "https://www.v2ex.com/go/python", "false"},
            {"https://www.v2ex.com/recent?p=2", "https://www.v2ex.com/recent", "false"},
            {"https://www.v2ex.com/member/someone", "https://www.v2ex.com/member/someone", "false"},
            {"https://www.v2ex.com/signin?next=/go/chamber", null, "false"},
            {"https://idcflare.com/t/topic/39038/5", "https://idcflare.com/t/topic/39038", "true"},
            {"https://idcflare.com/t/39038/5", "https://idcflare.com/t/topic/39038", "true"},
            {"https://idcflare.com", "https://idcflare.com/latest", "false"},
            {"https://cdn.idcflare.com/t/topic/1", null, "false"},
    };

    private static void canonicalizeOtherForums() {
        for (String[] row : OTHER_HISTORY) {
            ReaderHistory.Entry entry = ReaderHistory.create(row[0], "T", 1);
            check(entry == null ? null : entry.url(), row[1], "history " + row[0]);
            check(Boolean.toString(entry != null && ForumSite.isTopicUrl(entry.url())), row[2], "favorite " + row[0]);
        }
        check(ReaderHistory.create("https://www.nodeseek.com/", "NodeSeek", 1).title(), "NodeSeek 最新回复", "nodeseek home title");
        check(ReaderHistory.create("https://www.nodeseek.com/?sortBy=postTime", "x", 1).title(), "NodeSeek 最新发帖", "nodeseek new posts");
        check(ReaderHistory.create("https://www.v2ex.com/?tab=all", "V2EX", 1).title(), "V2EX 全部主题", "v2ex all title");
        check(ReaderHistory.create("https://idcflare.com/latest", "IDC Flare", 1).title(), "IDC Flare 最新主题", "idcflare latest");
    }

    private static void guardOtherForums() {
        assert ForumSite.isAllowedGuestUrl("https://www.nodeseek.com/post-1-1");
        assert ForumSite.isAllowedGuestUrl("https://nodeseek.com/");
        assert !ForumSite.isAllowedGuestUrl("https://www.nodeseek.com/signIn.html");
        assert ForumSite.isAuthenticationUrl("https://www.nodeseek.com/signIn.html");
        assert ForumSite.isAuthenticationUrl("https://www.nodeseek.com/register.html");
        assert !ForumSite.isAllowedGuestUrl("https://www.deepflood.com/");
        assert ForumSite.isAuthenticationUrl("https://www.v2ex.com/signin?next=%2Fgo%2Fchamber");
        assert !ForumSite.isAllowedGuestUrl("https://www.v2ex.com/signin");
        assert ForumSite.isAllowedGuestUrl("https://www.v2ex.com/go/python");
        assert ForumSite.isAuthenticationUrl("https://idcflare.com/login");
        assert !ForumSite.isAllowedGuestUrl("https://sub.idcflare.com/latest");

        assert ForumSite.isAuthenticationWrite("POST", "https://www.nodeseek.com/api/account/signIn");
        assert ForumSite.isAuthenticationWrite("POST", "https://www.v2ex.com/signin");
        assert ForumSite.isAuthenticationWrite("POST", "https://idcflare.com/session");
        // Requests that guest pages send on their own must keep working.
        assert !ForumSite.isAuthenticationWrite("POST", "https://www.nodeseek.com/cdn-cgi/rum");
        assert !ForumSite.isAuthenticationWrite("POST", "https://stat.nodeseek.org/api/send");
        assert !ForumSite.isAuthenticationWrite("POST", "https://idcflare.com/message-bus/abc/poll");
        assert !ForumSite.isAuthenticationWrite("POST", "https://idcflare.com/srv/pv");

        assert !ForumSite.samePage("https://www.v2ex.com/", "https://www.nodeseek.com/");
        assert ForumSite.forUrl("https://v2ex.com/t/1") == ForumSite.V2EX;
        assert ForumSite.forUrl("https://idcflare.com/latest") == ForumSite.IDCFLARE;
    }

    private static void rejectCredentialAndNonWebNavigation() {
        for (ForumSite site : ForumSite.values()) {
            String authority = site.origin().substring("https://".length());
            assert !ForumSite.isAllowedGuestUrl("https://guest:secret@" + authority + "/")
                    : "must reject credential-bearing navigation for " + site;
            assert !ForumSite.isAllowedGuestUrl("ftp://" + authority + "/")
                    : "must reject non-web navigation for " + site;
            assert ForumSite.isAllowedGuestUrl(site.homeUrl());
        }
    }

    // Exercise the production URL -> history -> favorites -> persistence -> search chain.
    private static void mixedForumPersistenceChain() {
        String[] urls = {
                "https://linux.do/t/topic/123/2", "https://nodeseek.com/post-123-3#reply",
                "https://v2ex.com/t/123?p=2#reply", "https://idcflare.com/t/topic/123/4"
        };
        List<ReaderHistory.Entry> history = List.of();
        List<ReaderFavorites.Folder> folders = ReaderFavorites.createFolder(List.of(), "跨站收藏", "mixed", 1);
        for (int i = 0; i < urls.length; i++) {
            ReaderHistory.Entry entry = ReaderHistory.create(urls[i], "测试主题", i + 2);
            history = ReaderHistory.add(history, entry);
            folders = ReaderFavorites.add(folders, "mixed", entry.url(), entry.title(), i + 2);
            history = ReaderHistory.add(history, ReaderHistory.create(entry.url(), entry.title(), i + 10));
            folders = ReaderFavorites.add(folders, "mixed", entry.url(), entry.title(), i + 10);
        }
        history = ReaderHistory.parse(ReaderHistory.serialize(history));
        folders = ReaderFavorites.parse(ReaderFavorites.serialize(folders));
        assert history.size() == 4 : "same numeric topic ID must remain distinct across forums";
        FavoritesViewModel model = new FavoritesViewModel(folders);
        assert model.total() == 4;
        for (ForumSite site : ForumSite.values()) {
            model.search(site.displayName());
            assert model.rows().size() == 1 : "site search: " + site;
            String url = model.rows().get(0).item().url();
            assert ForumSite.forUrl(url) == site;
            assert ForumSite.isAllowedGuestUrl(url) : "saved topic can be reopened";
            assert history.stream().anyMatch(entry -> entry.url().equals(url));
        }
        folders = ReaderFavorites.remove(folders, "mixed", urls[1]);
        assert folders.get(0).items().size() == 3;
        assert folders.get(0).items().stream().noneMatch(item -> ForumSite.forUrl(item.url()) == ForumSite.NODESEEK);
        assert history.size() == 4 : "removing a favorite must preserve history";
    }

    private static void cleanOtherForumTitles() {
        check(ReaderHistory.create("https://www.v2ex.com/t/1", "从转行到失败 - V2EX", 1).title(), "从转行到失败", "v2ex topic");
        check(ReaderHistory.create("https://www.v2ex.com/member/x", "V2EX › 最近的主题 1/41560", 1).title(),
                "最近的主题 1/41560", "v2ex prefix");
        check(ForumSite.V2EX.historyTitle("https://www.v2ex.com/member/x", "V2EX"), "V2EX 公开页面", "v2ex bare");
        check(ForumSite.NODESEEK.pageTitle("NodeSeek-精品贴"), "精品贴", "nodeseek prefix");
        check(ForumSite.NODESEEK.pageTitle("BotVod 新版本上线"), "BotVod 新版本上线", "nodeseek post title");
        check(ForumSite.NODESEEK.pageTitle(""), "NodeSeek 公开主题", "nodeseek fallback");
        check(ReaderHistory.create("https://idcflare.com/t/topic/1", "标题 - 教程 - IDC Flare", 1).title(), "标题 - 教程", "idcflare topic");
    }

    private static void describeOtherForums() {
        assert ForumSite.byId("nodeseek") == ForumSite.NODESEEK;
        assert ForumSite.byId("v2ex") == ForumSite.V2EX;
        assert ForumSite.byId("idcflare") == ForumSite.IDCFLARE;
        assert !ForumSite.NODESEEK.supportsSearch() && ForumSite.NODESEEK.searchUrl("x") == null;
        assert !ForumSite.V2EX.supportsSearch() && !ForumSite.V2EX.isSearchUrl("https://www.v2ex.com/search?q=x");
        assert ForumSite.NODESEEK.searchUnavailableHint().contains("NodeSeek");
        check(ForumSite.IDCFLARE.searchUrl("dns"), "https://idcflare.com/search?q=dns", "idcflare search");
        check(ForumSite.V2EX.navigationLabel("https://www.v2ex.com/?tab=hot"), "最热", "v2ex label");
        check(ForumSite.NODESEEK.homeUrl(), "https://www.nodeseek.com/", "nodeseek home");
        assert ForumSite.NODESEEK.challengeTimeoutMillis() > ForumSite.LINUX_DO.challengeTimeoutMillis();
        assert ForumSite.NODESEEK.cookieUrls().equals(List.of("https://www.nodeseek.com/", "https://nodeseek.com/"));
        check(ForumSite.cookieDeletionUrl(".nodeseek.com", "/"), "https://nodeseek.com/", "nodeseek domain cookie");
        check(ForumSite.cookieDeletionUrl(".v2ex.com", "/"), "https://v2ex.com/", "v2ex domain cookie");
        check(ForumSite.cookieDeletionUrl("stat.nodeseek.org", "/"), null, "analytics host is not a forum");
    }

    // {url, site id, topic id, slug} for shareable topics; null site means not shareable.
    private static final String[][] SHARE_TOPICS = {
            {"https://linux.do/t/hello-linux-do/12345/7", "linuxdo", "12345", "hello-linux-do"},
            {"https://linux.do/t/12345", "linuxdo", "12345", "topic"},
            {"https://linux.do/t/12345/7", "linuxdo", "12345", "topic"},
            {"https://linux.do/t/中文/12345", "linuxdo", "12345", "topic"},
            {"https://linux.do/t/%E4%B8%AD/12345?u=a#post_3", "linuxdo", "12345", "topic"},
            {"https://idcflare.com/t/topic/39038/5", "idcflare", "39038", "topic"},
            {"https://idcflare.com/t/hello-idc/1/3", "idcflare", "1", "hello-idc"},
            {"https://www.nodeseek.com/post-969428-3#12", "nodeseek", "969428", ""},
            {"https://nodeseek.com/post-1-1", "nodeseek", "1", ""},
            {"https://v2ex.com/t/1246711?p=2#reply5", "v2ex", "1246711", ""},
            {"https://linux.do/t/abc", null, null, null},
            {"https://linux.do/t/x/0045", null, null, null},
            {"https://linux.do/t/x/99999999999999999999", null, null, null},
            {"https://linux.do/latest", null, null, null},
            {"https://cdn.linux.do/t/x/1", null, null, null},
            {"http://linux.do/t/x/1", null, null, null},
            {"https://linux.do/t/x/1?__cf_chl_tk=abc", null, null, null},
            {"https://www.nodeseek.com/post-123", null, null, null},
            {"https://www.v2ex.com/go/python", null, null, null},
            {"https://example.com/t/x/1", null, null, null},
    };

    private static void shareTopicsOnEveryForum() {
        for (String[] row : SHARE_TOPICS) {
            ForumSite.TopicRef ref = ForumSite.topicRef(row[0]);
            check(ref == null ? null : ref.site().id(), row[1], "share site " + row[0]);
            check(ref == null ? null : Long.toString(ref.id()), row[2], "share id " + row[0]);
            check(ref == null ? null : ref.slug(), row[3], "share slug " + row[0]);
            if (ref != null) {
                ForumSite.TopicRef again = ForumSite.topicRef(ref.site().shareTopicUrl(ref.id(), ref.slug()));
                assert ref.equals(again) : "share URL must round-trip: " + row[0];
            }
        }
        check(ForumSite.NODESEEK.shareTopicUrl(12345, ""), "https://www.nodeseek.com/post-12345-1", "nodeseek share url");
        check(ForumSite.V2EX.shareTopicUrl(12345, ""), "https://www.v2ex.com/t/12345", "v2ex share url");
        check(ForumSite.IDCFLARE.shareTopicUrl(12345, "topic"), "https://idcflare.com/t/topic/12345", "idcflare share url");
        check(ForumSite.LINUX_DO.shareTopicUrl(12345, "2048"), "https://linux.do/t/topic/12345", "numeric slug");
        assert ForumSite.LINUX_DO.usesTopicSlug() && ForumSite.IDCFLARE.usesTopicSlug();
        assert !ForumSite.NODESEEK.usesTopicSlug() && !ForumSite.V2EX.usesTopicSlug();
        assert ForumSite.forShareId("nodeseek") == ForumSite.NODESEEK;
        assert ForumSite.forShareId("missing") == null && ForumSite.forShareId(null) == null;
    }

    private static void recognizeCloudflareChallenges() {
        assert ForumSite.hasChallengeParameters("https://linux.do/latest?__cf_chl_rt_tk=abc");
        assert ForumSite.hasChallengeParameters("https://linux.do/latest?x=1&__CF_CHL_F_TK=abc");
        assert !ForumSite.hasChallengeParameters("https://linux.do/latest?q=__cf_chl_tk");
        assert !ForumSite.hasChallengeParameters("https://linux.do/latest");
        assert !ForumSite.hasChallengeParameters(null) && !ForumSite.hasChallengeParameters("not a url");
        check(ForumSite.reloadUrl("https://linux.do/latest?__cf_chl_f_tk=abc"), "https://linux.do/latest", "strip token");
        check(ForumSite.reloadUrl("https://www.v2ex.com/?tab=hot&__cf_chl_rt_tk=x#r"), "https://www.v2ex.com/?tab=hot", "keep tab");
        check(ForumSite.reloadUrl("https://linux.do/t/topic/1#post_2"), "https://linux.do/t/topic/1", "drop fragment");
        check(ForumSite.reloadUrl("https://www.v2ex.com/t/1?p=2"), "https://www.v2ex.com/t/1?p=2", "keep page");
        check(ForumSite.reloadUrl("https://linux.do/search?q=%E4%B8%AD"), "https://linux.do/search?q=%E4%B8%AD", "keep encoding");
        check(ForumSite.reloadUrl("about:blank"), "about:blank", "opaque url");
        check(ForumSite.reloadUrl("https://v2ex.com/t/1?__cf_chl_tk=x"), "https://v2ex.com/t/1", "alias host kept");
        check(ForumSite.reloadUrl("https://linux.do/latest?&&__cf_chl_rt_tk=a&"), "https://linux.do/latest", "empty parameters");
        check(ForumSite.reloadUrl("https://linux.do"), "https://linux.do", "no path");
        check(ForumSite.reloadUrl("not a url"), "not a url", "unparsable url");
        check(ForumSite.reloadUrl(null), null, "null url");
        assert ForumSite.hasChallengeParameters("https://www.nodeseek.com/?sortBy=postTime&__cf_chl_tk=x#a");
        assert !ForumSite.hasChallengeParameters("https://linux.do/latest#__cf_chl_rt_tk=x") : "fragments are not parameters";
        // 带一次性验证参数的地址既不入历史，也不能被收藏或分享。
        assert ReaderHistory.create("https://www.v2ex.com/t/1?__cf_chl_f_tk=x", "T", 1) == null;
        assert ForumSite.topicUrl("https://www.nodeseek.com/post-1-1?__cf_chl_tk=x") == null;
        assert ForumSite.isChallengeTitle("Just a moment...") && ForumSite.isChallengeTitle(" just a moment… ");
        assert ForumSite.isChallengeTitle("请稍候…") && ForumSite.isChallengeTitle("请稍候...");
        assert !ForumSite.isChallengeTitle("Attention Required! | Cloudflare");
        assert !ForumSite.isChallengeTitle("LINUX DO") && !ForumSite.isChallengeTitle(null);
    }

    // {input, canonical history URL or null, favoritable topic}. Captured from the 16.0 implementation.
    private static final String[][] LINUX_DO_HISTORY = {
            {"https://linux.do", "https://linux.do/latest", "false"},
            {"https://linux.do/", "https://linux.do/", "false"},
            {"https://linux.do/latest", "https://linux.do/latest", "false"},
            {"https://linux.do/LATEST/", "https://linux.do/latest", "false"},
            {"https://linux.do/latest?order=created", "https://linux.do/latest", "false"},
            {"https://linux.do/top?period=weekly", "https://linux.do/top", "false"},
            {"https://linux.do/categories/", "https://linux.do/categories", "false"},
            {"https://linux.do/c/develop/4", "https://linux.do/c/develop/4", "false"},
            {"https://linux.do/t/example/123", "https://linux.do/t/example/123", "true"},
            {"https://linux.do/t/example/123/10?u=abc#post_10", "https://linux.do/t/example/123", "true"},
            {"https://linux.do/t/123", "https://linux.do/t/topic/123", "true"},
            // Discourse 的 /t/编号/楼层 是主题 123，不是 slug 为 123 的主题 4。
            {"https://linux.do/t/123/4", "https://linux.do/t/topic/123", "true"},
            {"https://linux.do/t/Example-Slug/0045", "https://linux.do/t/Example-Slug/0045", "true"},
            {"https://linux.do/t/topic/1/", "https://linux.do/t/topic/1", "true"},
            {"https://linux.do/t/abc", "https://linux.do/t/abc", "true"},
            {"https://linux.do/T/example/123", "https://linux.do/T/example/123", "false"},
            {"https://linux.do/t/example/123?page=2", "https://linux.do/t/example/123", "true"},
            {"https://linux.do/t/中文/123", "https://linux.do/t/中文/123", "true"},
            {"https://linux.do/t/%E4%B8%AD/123", "https://linux.do/t/中/123", "true"},
            {"https://linux.do/search?q=java", "https://linux.do/search?q=java", "false"},
            {"https://linux.do/search", "https://linux.do/search", "false"},
            {"https://linux.do/u/someone/summary", "https://linux.do/u/someone/summary", "false"},
            {"https://linux.do/login", null, "false"},
            {"https://linux.do/LOGIN/", null, "false"},
            {"https://linux.do/loginx", null, "false"},
            {"https://linux.do/authors", null, "false"},
            {"https://linux.do/session/sso", null, "false"},
            {"https://linux.do/oauth2/authorize", "https://linux.do/oauth2/authorize", "false"},
            {"https://linux.do/cdn-cgi/challenge-platform/h/b", null, "false"},
            {"https://linux.do/latest?__CF_CHL_tk=abc", null, "false"},
            {"https://linux.do/latest#frag", "https://linux.do/latest", "false"},
            {"http://linux.do/latest", null, "false"},
            {"https://linux.do:8443/latest", "https://linux.do/latest", "false"},
            {"https://user:pass@linux.do/latest", null, "false"},
            {"https://cdn.linux.do/latest", null, "false"},
            {"https://connect.linux.do/oauth2/authorize", null, "false"},
            {"https://LINUX.DO/latest", "https://linux.do/latest", "false"},
            {"https://notlinux.do/latest", null, "false"},
            {"https://linux.do.evil.com/latest", null, "false"},
            {"https://example.com/t/x/1", null, "false"},
            {"about:blank", null, "false"},
            {null, null, "false"},
            {"", null, "false"},
            {"not a url with spaces", null, "false"},
    };

    // {url, allowed by the navigation guard, recognised as a login page}. Captured from 16.0.
    private static final String[][] LINUX_DO_GUARD = {
            {"https://linux.do/latest", "true", "false"},
            {"https://linux.do/t/example/123", "true", "false"},
            {"https://linux.do/login", "false", "true"},
            {"https://linux.do/LOGIN/", "false", "true"},
            {"https://linux.do/loginx", "true", "false"},
            {"https://linux.do/authors", "true", "false"},
            {"https://linux.do/session/sso", "false", "true"},
            {"https://linux.do/oauth2/authorize", "false", "true"},
            {"https://linux.do/cdn-cgi/challenge-platform/h/b", "true", "false"},
            {"http://linux.do/latest", "true", "false"},
            {"https://cdn.linux.do/latest", "true", "false"},
            {"https://connect.linux.do/oauth2/authorize", "false", "true"},
            {"https://LINUX.DO/latest", "true", "false"},
            {"https://notlinux.do/latest", "false", "false"},
            {"https://linux.do.evil.com/latest", "false", "false"},
            {"https://example.com/t/x/1", "false", "false"},
            {"about:blank", "true", "false"},
            {null, "true", "false"},
            {"", "false", "false"},
            {"not a url with spaces", "false", "false"},
    };

    // {raw title, history title, page title, history title for a topic URL}. Captured from 16.0.
    private static final String[][] LINUX_DO_TITLES = {
            {"(3) 真实标题 - LINUX DO", "真实标题", "真实标题", "(3) 真实标题 - LINUX DO"},
            {"真实标题 - 搞七捻三", "真实标题", "真实标题", "真实标题 - 搞七捻三"},
            {"LINUX DO", "LINUX DO", "LINUX DO", "LINUX DO 公开页面"},
            {"linux do", "linux do", "linux do", "LINUX DO 公开页面"},
            {"搞七捻三", "搞七捻三", "搞七捻三", "LINUX DO 公开页面"},
            {"  \n多行\t标题  ", "多行 标题", "多行\t标题", "多行\t标题"},
            {"", "公开页面", "LINUX DO 公开主题", ""},
            {null, "公开页面", "LINUX DO 公开主题", ""},
            {"标题-LINUX DO", "标题-LINUX DO", "标题-LINUX DO", "标题-LINUX DO"},
            {"A - LINUX DO - LINUX DO", "A - LINUX DO", "A - LINUX DO", "A - LINUX DO - LINUX DO"},
    };

    private static void keepLinuxDoHistoryUrlsFrom16() {
        for (String[] row : LINUX_DO_HISTORY) {
            ReaderHistory.Entry entry = ReaderHistory.create(row[0], "T", 1);
            check(entry == null ? null : entry.url(), row[1], "history " + row[0]);
            boolean favorite = entry != null && ForumSite.isTopicUrl(entry.url());
            check(Boolean.toString(favorite), row[2], "favorite " + row[0]);
            check(ForumSite.topicUrl(row[0]), favorite ? row[1] : null, "topic " + row[0]);
        }
    }

    private static void keepLinuxDoGuardFrom16() {
        for (String[] row : LINUX_DO_GUARD) {
            check(Boolean.toString(ForumSite.isAllowedGuestUrl(row[0])), row[1], "allowed " + row[0]);
            check(Boolean.toString(ForumSite.isAuthenticationUrl(row[0])), row[2], "login " + row[0]);
        }
    }

    private static void keepLinuxDoTitlesFrom16() {
        ForumSite site = ForumSite.LINUX_DO;
        for (String[] row : LINUX_DO_TITLES) {
            check(ReaderHistory.create("https://linux.do/t/x/1", row[0], 1).title(), row[1], "history title " + row[0]);
            check(site.pageTitle(row[0]), row[2], "page title " + row[0]);
            check(site.historyTitle("https://linux.do/t/x/1", row[0]), row[3], "topic title " + row[0]);
        }
        String longTitle = "x".repeat(250);
        check(site.pageTitle(longTitle), "x".repeat(200), "page title is clipped");
        check(ReaderHistory.create("https://linux.do/t/x/1", longTitle, 1).title(), "x".repeat(200), "history title is clipped");

        check(ReaderHistory.create("https://linux.do/latest", "Real", 1).title(), "最新主题", "latest title");
        check(ReaderHistory.create("https://linux.do/top/", "Real", 1).title(), "本周热门", "top title");
        check(ReaderHistory.create("https://linux.do/categories", "Real", 1).title(), "浏览分类", "categories title");
        check(ReaderHistory.create("https://linux.do/search?q=a", "Real", 1).title(), "搜索结果", "search title");
        check(ReaderHistory.create("https://linux.do", "Real", 1).title(), "最新主题", "bare origin title");

        check(site.historyTitle("https://linux.do/latest", "T"), "最新主题", "latest page title");
        check(site.historyTitle("https://linux.do/LATEST/", "T"), "最新主题", "latest page title, other case");
        check(site.historyTitle("https://linux.do/latest?order=created", "T"), "T", "latest with query");
        check(site.historyTitle("https://linux.do/categories/", "T"), "浏览分类", "categories page title");
        check(site.historyTitle("https://linux.do/search", "T"), "搜索结果", "search page title");
        check(site.navigationLabel("https://linux.do/top"), "热门", "top label");
        check(site.navigationLabel("https://linux.do/top?period=weekly"), "最新", "top with query label");
        check(site.navigationLabel("https://linux.do/categories/"), "分类", "categories label");
        check(site.navigationLabel("https://linux.do/search?q=java"), "搜索结果", "search label");
        check(site.navigationLabel("https://linux.do/t/example/123"), "最新", "topic label");
    }

    private static void compareHostsInSamePage() {
        assert ForumSite.samePage("https://linux.do/latest", "https://linux.do/latest/");
        assert ForumSite.samePage("https://linux.do/LATEST", "https://linux.do/latest");
        assert !ForumSite.samePage("https://linux.do/latest?x=1", "https://linux.do/latest");
        assert !ForumSite.samePage(null, "https://linux.do/latest");
        assert ForumSite.samePage("https://linux.do", "https://linux.do/");
        assert ForumSite.samePage("not a url", "not a url");
        assert !ForumSite.samePage("about:blank", "https://linux.do/latest");
        assert ForumSite.samePage("https://linux.do/t/a/1#p", "https://linux.do/t/a/1");
        assert ForumSite.samePage("https://LINUX.DO/latest", "https://linux.do/latest");
        // 16.0 compared paths only, so another forum's /latest looked like the current page.
        assert !ForumSite.samePage("https://linux.do/latest", "https://cdn.linux.do/latest");
        assert !ForumSite.samePage("https://linux.do/latest", "https://idcflare.com/latest");
    }

    // {method, url, blocked}. Captured from 16.0.
    private static final String[][] LINUX_DO_WRITES = {
            {"POST", "https://linux.do/session", "true"},
            {"POST", "https://linux.do/session/csrf", "true"},
            {"GET", "https://linux.do/session", "false"},
            {"HEAD", "https://linux.do/session", "false"},
            {null, "https://linux.do/session", "false"},
            {"POST", "https://linux.do/users", "true"},
            {"PUT", "https://linux.do/Users/1", "true"},
            {"POST", "https://linux.do/user-api-key/new", "true"},
            {"POST", "https://linux.do/message-bus/abc/poll", "false"},
            {"POST", "https://connect.linux.do/oauth2/token", "true"},
            {"POST", "https://example.com/session", "false"},
            {"POST", "bad url with space", "true"},
            {"post", "https://linux.do/auth/github", "true"},
            {"DELETE", "https://linux.do/sessions", "false"},
    };

    private static void keepLinuxDoAuthenticationWritesFrom16() {
        for (String[] row : LINUX_DO_WRITES) {
            check(Boolean.toString(ForumSite.isAuthenticationWrite(row[0], row[1])), row[2], row[0] + " " + row[1]);
        }
    }

    private static void buildLinuxDoNavigation() {
        ForumSite site = ForumSite.LINUX_DO;
        assert ForumSite.byId("linuxdo") == site;
        assert ForumSite.byId("missing") == ForumSite.DEFAULT;
        assert ForumSite.byId(null) == ForumSite.DEFAULT;
        assert ForumSite.forUrl("https://cdn.linux.do/x") == site;
        assert ForumSite.forUrl("https://example.com/") == null;
        check(site.homeUrl(), "https://linux.do/latest", "home");
        check(site.searchUrl("中 文"), "https://linux.do/search?q=%E4%B8%AD+%E6%96%87", "search url");
        assert site.isSearchUrl("https://linux.do/search?q=x");
        assert !site.isSearchUrl("https://linux.do/latest");
    }

    private static void shipReaderAssetsForEverySite() throws IOException {
        for (ForumSite site : ForumSite.values()) {
            ForumSite.Reader reader = site.reader();
            assert !reader.root().isBlank() && !reader.content().isBlank() : site + " selectors";
            assert !reader.identity().isBlank() && !reader.username().isBlank() : site + " identity selectors";
            for (String resource : List.of(reader.css(), reader.loadingCss())) {
                try (InputStream input = ForumSite.class.getResourceAsStream(resource)) {
                    assert input != null : "missing " + resource;
                    Matcher placeholder = Pattern.compile("__LEX_IDE_[A-Z]+__")
                            .matcher(new String(input.readAllBytes(), StandardCharsets.UTF_8));
                    while (placeholder.find()) {
                        assert THEME_PLACEHOLDERS.contains(placeholder.group()) : resource + " uses " + placeholder.group();
                    }
                }
            }
        }
    }

    private static void check(String actual, String expected, String label) {
        assert Objects.equals(actual, expected) : label + ": expected <" + expected + "> but was <" + actual + ">";
    }
}
