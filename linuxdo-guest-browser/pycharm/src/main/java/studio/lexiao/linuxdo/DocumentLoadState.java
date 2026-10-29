package studio.lexiao.linuxdo;

final class DocumentLoadState {
    private boolean awaiting;
    private boolean loadingObserved;
    private int responseStatus;
    private boolean challengeActive;
    private boolean challengeNeedsInteraction;
    private long challengeStartedNanos;
    private int challengeTimeoutMillis;

    synchronized void begin() {
        awaiting = true;
        loadingObserved = false;
        responseStatus = 0;
        challengeActive = false;
        challengeNeedsInteraction = false;
    }

    // Every actual navigation, including a same-URL automatic reload, needs tracking.
    // Keep an in-flight challenge's original deadline until a successful document.
    synchronized void navigationStarted() {
        if (!awaiting) begin();
        responseStatus = 0;
    }

    synchronized void responseReceived(int status) {
        responseStatus = status;
    }

    synchronized boolean isAwaiting() {
        return awaiting;
    }

    synchronized void loadingStarted() {
        if (awaiting) loadingObserved = true;
    }

    synchronized boolean completeFromLoadingState() {
        if (!awaiting || !loadingObserved || challengeActive || responseStatus >= 400) return false;
        awaiting = false;
        loadingObserved = false;
        return true;
    }

    synchronized boolean completeFromSettledDocument() {
        if (challengeActive || responseStatus >= 400) return false;
        return completeFromMainFrame();
    }

    synchronized boolean completeFromMainFrame() {
        if (!awaiting) return false;
        fail();
        return true;
    }

    // Automatic reloads and redirects share one verification budget. Only begin()
    // (an explicit navigation/retry) or a successful main frame ends this wait.
    synchronized void challengeReceived(long nowNanos, int timeoutMillis) {
        if (!awaiting || challengeActive) return;
        challengeActive = true;
        challengeStartedNanos = nowNanos;
        challengeTimeoutMillis = timeoutMillis;
    }

    synchronized boolean isChallengeActive() {
        return challengeActive;
    }

    synchronized boolean requestChallengeInteraction() {
        if (!challengeActive || challengeNeedsInteraction) return false;
        challengeNeedsInteraction = true;
        return true;
    }

    synchronized boolean challengeNeedsInteraction() {
        return challengeNeedsInteraction;
    }

    synchronized int challengeRemainingMillis(long nowNanos) {
        if (!challengeActive) return 0;
        long remaining = challengeTimeoutMillis * 1_000_000L - (nowNanos - challengeStartedNanos);
        return (int) Math.max(0, (remaining + 999_999L) / 1_000_000L);
    }

    synchronized void fail() {
        awaiting = false;
        loadingObserved = false;
        responseStatus = 0;
        challengeActive = false;
        challengeNeedsInteraction = false;
    }
}
