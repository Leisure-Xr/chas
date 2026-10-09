package studio.lexiao.linuxdo;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class GuestSessionCleanupTest {
    public static void main(String[] args) throws Exception {
        completesSuccessfulCleanup();
        releasesStartupWhenCleanupHangs();
        sweepsForumDomainCookiesOnly();
        reportsFailedDeletion();
    }

    private static final class FakeCookieStore implements GuestSessionCleanup.CookieStore {
        final List<String> hostUrls = new ArrayList<>();
        final List<String> deleted = new ArrayList<>();
        final List<GuestSessionCleanup.CookieRef> cookies;
        final String failingName;

        FakeCookieStore(List<GuestSessionCleanup.CookieRef> cookies, String failingName) {
            this.cookies = cookies;
            this.failingName = failingName;
        }

        @Override
        public boolean deleteHostCookies(String url) {
            hostUrls.add(url);
            return true;
        }

        @Override
        public List<GuestSessionCleanup.CookieRef> listCookies() {
            return cookies;
        }

        @Override
        public boolean deleteCookie(String url, String name) {
            deleted.add(name + "@" + url);
            return !name.equals(failingName);
        }
    }

    // deleteCookies(url, null) 删不掉 .linux.do 上的 cf_clearance；这些域 Cookie 必须逐个按名称删，
    // 而 IDE 里其它功能的 Cookie（同一个 JCEF Cookie 库）一个都不能碰。
    private static void sweepsForumDomainCookiesOnly() throws Exception {
        FakeCookieStore store = new FakeCookieStore(List.of(
                new GuestSessionCleanup.CookieRef("cf_clearance", ".linux.do", "/"),
                new GuestSessionCleanup.CookieRef("_forum_session", "linux.do", "/"),
                new GuestSessionCleanup.CookieRef("__cf_bm", "connect.linux.do", "/"),
                new GuestSessionCleanup.CookieRef("scoped", "LINUX.DO", "/t"),
                new GuestSessionCleanup.CookieRef("cf_clearance", ".nodeseek.com", "/"),
                new GuestSessionCleanup.CookieRef("PB3_SESSION", "www.v2ex.com", "/"),
                new GuestSessionCleanup.CookieRef("cf_clearance", ".idcflare.com", "/"),
                new GuestSessionCleanup.CookieRef("analytics", "stat.nodeseek.org", "/"),
                new GuestSessionCleanup.CookieRef("account", ".jetbrains.com", "/"),
                new GuestSessionCleanup.CookieRef("lookalike", "notlinux.do", "/"),
                new GuestSessionCleanup.CookieRef("suffix", "linux.do.evil.com", "/"),
                new GuestSessionCleanup.CookieRef("unknown", null, "/")
        ), null);
        assert GuestSessionCleanup.clearForumCookies(store);
        for (ForumSite site : ForumSite.values()) {
            assert store.hostUrls.containsAll(site.cookieUrls()) : site + " host cookies";
        }
        assert store.deleted.equals(List.of(
                "cf_clearance@https://linux.do/",
                "_forum_session@https://linux.do/",
                "__cf_bm@https://connect.linux.do/",
                "scoped@https://linux.do/t",
                "cf_clearance@https://nodeseek.com/",
                "PB3_SESSION@https://www.v2ex.com/",
                "cf_clearance@https://idcflare.com/"
        )) : store.deleted;
    }

    private static void reportsFailedDeletion() throws Exception {
        FakeCookieStore store = new FakeCookieStore(List.of(
                new GuestSessionCleanup.CookieRef("cf_clearance", ".linux.do", "/"),
                new GuestSessionCleanup.CookieRef("__cf_bm", ".linux.do", "/")
        ), "cf_clearance");
        assert !GuestSessionCleanup.clearForumCookies(store);
        assert store.deleted.size() == 2 : "a failed deletion must not stop the sweep";
    }

    private static void completesSuccessfulCleanup() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        try {
            assert GuestSessionCleanup.run(() -> true, executor, 1, TimeUnit.SECONDS).get();
        } finally {
            executor.shutdownNow();
        }
    }

    private static void releasesStartupWhenCleanupHangs() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        var blocked = new CountDownLatch(1);
        try {
            long started = System.nanoTime();
            boolean result = GuestSessionCleanup.run(() -> {
                blocked.await();
                return true;
            }, executor, 50, TimeUnit.MILLISECONDS).get(1, TimeUnit.SECONDS);
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
            assert !result;
            assert elapsedMillis < 500;
        } finally {
            blocked.countDown();
            executor.shutdownNow();
        }
    }
}
