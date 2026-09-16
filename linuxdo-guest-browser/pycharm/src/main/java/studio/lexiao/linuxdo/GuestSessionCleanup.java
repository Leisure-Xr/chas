package studio.lexiao.linuxdo;

import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

final class GuestSessionCleanup {
    private GuestSessionCleanup() {}

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
}
