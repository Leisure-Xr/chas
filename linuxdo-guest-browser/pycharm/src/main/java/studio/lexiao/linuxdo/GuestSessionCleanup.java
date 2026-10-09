package studio.lexiao.linuxdo;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

final class GuestSessionCleanup {
    private GuestSessionCleanup() {}

    record CookieRef(String name, String domain, String path) {}

    // JCEF Cookie 管理器的最小接口，测试里用内存实现替换。
    interface CookieStore {
        boolean deleteHostCookies(String url) throws Exception;

        List<CookieRef> listCookies() throws Exception;

        boolean deleteCookie(String url, String name) throws Exception;
    }

    static CompletableFuture<Boolean> run(
            Callable<Boolean> cleanup,
            Executor executor,
            long timeout,
            TimeUnit unit
    ) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return cleanup.call();
            } catch (Exception error) {
                throw new CompletionException(error);
            }
        }, executor).completeOnTimeout(false, timeout, unit);
    }

    // deleteCookies(url, null) 只删主机 Cookie，Cloudflare 的 cf_clearance 这类 .linux.do 域 Cookie 会留下，
    // 所以再列出全部 Cookie、按名称删掉属于受支持论坛的那些。JCEF 的 Cookie 库是整个 IDE 共用的：
    // 只碰论坛域名，绝不整库清空，也绝不记录 Cookie 的值。
    static boolean clearForumCookies(CookieStore store) throws Exception {
        boolean cleared = true;
        for (ForumSite site : ForumSite.values()) {
            for (String url : site.cookieUrls()) {
                cleared &= store.deleteHostCookies(url);
            }
        }
        for (CookieRef cookie : store.listCookies()) {
            String url = ForumSite.cookieDeletionUrl(cookie.domain(), cookie.path());
            if (url != null) cleared &= store.deleteCookie(url, cookie.name());
        }
        return cleared;
    }
}
