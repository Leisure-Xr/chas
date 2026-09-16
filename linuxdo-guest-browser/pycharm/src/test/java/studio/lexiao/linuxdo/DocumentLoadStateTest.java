package studio.lexiao.linuxdo;

public final class DocumentLoadStateTest {
    public static void main(String[] args) {
        loadingStateCompletesOnlyAnObservedLoad();
        mainFrameCompletionIsIdempotent();
        failureClearsPendingLoad();
    }

    private static void loadingStateCompletesOnlyAnObservedLoad() {
        DocumentLoadState state = new DocumentLoadState();
        assert !state.completeFromLoadingState();
        state.begin();
        assert state.isAwaiting();
        assert !state.completeFromLoadingState();
        state.loadingStarted();
        assert state.completeFromLoadingState();
        assert !state.isAwaiting();
        assert !state.completeFromLoadingState();
    }

    private static void mainFrameCompletionIsIdempotent() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        assert state.completeFromMainFrame();
        assert !state.completeFromMainFrame();
    }

    private static void failureClearsPendingLoad() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.loadingStarted();
        state.fail();
        assert !state.isAwaiting();
        assert !state.completeFromLoadingState();
    }
}
