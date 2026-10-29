package studio.lexiao.linuxdo;

public final class DocumentLoadStateTest {
    public static void main(String[] args) {
        loadingStateCompletesOnlyAnObservedLoad();
        automaticReloadAfterSuccessIsTracked();
        navigationKeepsObservedLoadAndChallengeDeadline();
        errorResponseCannotCompleteAsSuccess();
        mainFrameCompletionIsIdempotent();
        failureClearsPendingLoad();
        challengeReloadsShareOneDeadline();
        successfulMainFrameEndsVerification();
        retryAndSiteSwitchStartFreshVerification();
        lateChallengeAfterFailureIsIgnored();
        manualVerificationSurvivesTheAutomaticDeadline();
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

    private static void challengeReloadsShareOneDeadline() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.loadingStarted();
        state.challengeReceived(0, 20_000);
        for (int seconds = 1; seconds <= 25; seconds++) {
            long now = seconds * 1_000_000_000L;
            // Same-URL refreshes and redirected requests cannot prove success.
            state.loadingStarted();
            state.challengeReceived(now, 20_000);
            assert !state.completeFromLoadingState();
            assert state.isAwaiting();
            assert state.challengeRemainingMillis(now) == Math.max(0, 20_000 - seconds * 1000);
        }
        assert state.challengeRemainingMillis(19_999_999_999L) == 1;
    }

    private static void successfulMainFrameEndsVerification() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.challengeReceived(0, 20_000);
        assert state.completeFromMainFrame();
        assert !state.isChallengeActive();
        assert state.challengeRemainingMillis(21_000_000_000L) == 0;
        assert !state.completeFromMainFrame();
    }

    private static void retryAndSiteSwitchStartFreshVerification() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.challengeReceived(0, 20_000);
        state.begin(); // Explicit retry of IDC Flare.
        assert !state.isChallengeActive();
        state.challengeReceived(15_000_000_000L, 20_000);
        assert state.challengeRemainingMillis(20_000_000_000L) == 15_000;
        state.begin(); // Switch to NodeSeek, with its own longer verification budget.
        state.challengeReceived(21_000_000_000L, 45_000);
        assert state.challengeRemainingMillis(21_000_000_000L) == 45_000;
        assert state.challengeRemainingMillis(22_000_000_000L) == 44_000;
    }

    private static void lateChallengeAfterFailureIsIgnored() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.challengeReceived(0, 20_000);
        state.fail();
        state.challengeReceived(21_000_000_000L, 20_000);
        assert !state.isChallengeActive();
        assert !state.isAwaiting();
    }

    private static void manualVerificationSurvivesTheAutomaticDeadline() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.challengeReceived(0, 20_000);
        assert state.challengeRemainingMillis(20_000_000_000L) == 0;
        assert state.requestChallengeInteraction();
        assert state.isAwaiting();
        assert state.isChallengeActive();
        assert state.challengeNeedsInteraction();
        state.loadingStarted();
        state.challengeReceived(40_000_000_000L, 20_000);
        assert !state.completeFromLoadingState();
        assert !state.requestChallengeInteraction() : "reloads must not repeat the notice transition";
        assert state.completeFromMainFrame() : "successful manual verification still completes normally";
        assert !state.challengeNeedsInteraction();
        state.begin();
        state.challengeReceived(50_000_000_000L, 20_000);
        assert !state.challengeNeedsInteraction();
        state.requestChallengeInteraction();
        state.fail();
        assert !state.challengeNeedsInteraction();
        assert !state.isAwaiting();
    }
    private static void automaticReloadAfterSuccessIsTracked() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        assert state.completeFromMainFrame();
        state.navigationStarted(); // Same-URL reload by the website, not the toolbar.
        assert state.isAwaiting();
        state.loadingStarted();
        state.responseReceived(200);
        assert state.completeFromLoadingState();
        state.fail();
        state.navigationStarted(); // Retry after an error also receives styling.
        assert state.completeFromMainFrame();
    }

    private static void navigationKeepsObservedLoadAndChallengeDeadline() {
        DocumentLoadState state = new DocumentLoadState();
        state.begin();
        state.loadingStarted(); // JCEF may deliver this before onBeforeBrowse.
        state.navigationStarted();
        assert state.completeFromLoadingState();
        state.begin();
        state.challengeReceived(0, 20_000);
        state.requestChallengeInteraction();
        state.navigationStarted();
        assert state.challengeNeedsInteraction();
        assert state.challengeRemainingMillis(15_000_000_000L) == 5_000;
        assert !state.completeFromLoadingState();
    }

    private static void errorResponseCannotCompleteAsSuccess() {
        for (int status : new int[] {403, 503, 500}) {
            DocumentLoadState state = new DocumentLoadState();
            state.begin();
            state.loadingStarted();
            state.responseReceived(status);
            assert !state.completeFromLoadingState() : "load-stopped must not accept HTTP " + status;
            assert state.isAwaiting();
            assert !state.completeFromSettledDocument();
            state.fail();
            state.navigationStarted();
            state.loadingStarted();
            state.responseReceived(200);
            assert state.completeFromLoadingState();
        }
    }

}
