package studio.lexiao.linuxdo;

final class DocumentLoadState {
    private boolean awaiting;
    private boolean loadingObserved;

    synchronized void begin() {
        awaiting = true;
        loadingObserved = false;
    }

    synchronized boolean isAwaiting() {
        return awaiting;
    }

    synchronized void loadingStarted() {
        if (awaiting) loadingObserved = true;
    }

    synchronized boolean completeFromLoadingState() {
        if (!awaiting || !loadingObserved) return false;
        awaiting = false;
        loadingObserved = false;
        return true;
    }

    synchronized boolean completeFromMainFrame() {
        if (!awaiting) return false;
        awaiting = false;
        loadingObserved = false;
        return true;
    }

    synchronized void fail() {
        awaiting = false;
        loadingObserved = false;
    }
}
