package studio.lexiao.linuxdo;

import java.util.ArrayList;
import java.util.List;

public final class ReaderHistoryTest {
    public static void main(String[] args) {
        roundTripAndDeduplicate();
        rejectPrivateAndDamagedEntries();
        capHistoryLength();
        updateLateTitleWithoutChangingVisitTime();
    }

    private static void roundTripAndDeduplicate() {
        ReaderHistory.Entry first = ReaderHistory.create("https://linux.do/t/example/123#post_2", "Example\nTopic", 1000);
        List<ReaderHistory.Entry> history = ReaderHistory.add(List.of(), first);
        history = ReaderHistory.add(history, ReaderHistory.create("https://linux.do/t/example/123", "Updated title", 2000));
        assert history.size() == 1;
        assert history.get(0).title().equals("Updated title");
        assert history.get(0).url().equals("https://linux.do/t/example/123");

        history = ReaderHistory.add(history, ReaderHistory.create("https://linux.do/t/example/123/10", "Floor ten", 3000));
        assert history.size() == 1;
        assert history.get(0).url().equals("https://linux.do/t/example/123");

        List<ReaderHistory.Entry> decoded = ReaderHistory.parse(ReaderHistory.serialize(history));
        assert decoded.equals(history);
    }

    private static void rejectPrivateAndDamagedEntries() {
        assert ReaderHistory.create("https://example.com/t/1", "off-site", 1000) == null;
        assert ReaderHistory.create("https://linux.do/login", "login", 1000) == null;
        assert ReaderHistory.create("https://user:pass@linux.do/latest", "credentials", 1000) == null;
        assert ReaderHistory.create("https://linux.do/latest?__cf_chl_tk=secret", "challenge", 1000) == null;
        assert ReaderHistory.create("https://linux.do/cdn-cgi/challenge-platform/test", "challenge", 1000) == null;
        assert ReaderHistory.parse("broken\tentry").isEmpty();
        assert ReaderHistory.parse("1000\t%%%\t%%%").isEmpty();
    }

    private static void capHistoryLength() {
        List<ReaderHistory.Entry> history = new ArrayList<>();
        for (int index = 0; index < 80; index += 1) {
            history = ReaderHistory.add(history, ReaderHistory.create(
                    "https://linux.do/t/topic/" + (index + 1),
                    "Topic " + index,
                    1000 + index
            ));
        }
        assert history.size() == ReaderHistory.MAX_ENTRIES;
        assert history.get(0).url().endsWith("/80");
    }

    private static void updateLateTitleWithoutChangingVisitTime() {
        ReaderHistory.Entry entry = ReaderHistory.create("https://linux.do/t/example/123", "公开页面", 4321);
        List<ReaderHistory.Entry> history = ReaderHistory.updateTitle(List.of(entry), "https://linux.do/t/example/123#post_2", "真实标题 - LINUX DO");
        assert history.size() == 1;
        assert history.get(0).title().equals("真实标题");
        assert history.get(0).visitedAt() == 4321;
    }
}
