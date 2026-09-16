package studio.lexiao.linuxdo;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class GuestSessionCleanupTest {
    public static void main(String[] args) throws Exception {
        completesSuccessfulCleanup();
        releasesStartupWhenCleanupHangs();
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
