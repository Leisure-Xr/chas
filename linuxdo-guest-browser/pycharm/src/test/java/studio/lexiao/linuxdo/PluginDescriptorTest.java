package studio.lexiao.linuxdo;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PluginDescriptorTest {
    private static final String SINCE_BUILD = "223";
    private static final String UNTIL_BUILD = "263.*";
    private static final String VERSION = "0.13.0";

    public static void main(String[] args) throws IOException {
        declareSupportedBuildsAndVersion();
        matchBuildScriptWithDescriptor();
    }

    private static void declareSupportedBuildsAndVersion() throws IOException {
        String descriptor = readResource("/META-INF/plugin.xml");
        assert descriptor.contains("since-build=\"" + SINCE_BUILD + "\"");
        assert descriptor.contains("until-build=\"" + UNTIL_BUILD + "\"");
        assert descriptor.contains("<version>" + VERSION + "</version>");
    }

    private static void matchBuildScriptWithDescriptor() throws IOException {
        Path buildScript = Path.of("build.gradle.kts");
        if (!Files.isRegularFile(buildScript)) {
            System.out.println("Skipped build.gradle.kts check: not found at " + buildScript.toAbsolutePath());
            return;
        }
        String script = Files.readString(buildScript);
        assert script.contains("sinceBuild.set(\"" + SINCE_BUILD + "\")");
        assert script.contains("untilBuild.set(\"" + UNTIL_BUILD + "\")");
        assert script.contains("version = \"" + VERSION + "\"");
    }

    private static String readResource(String name) throws IOException {
        try (InputStream input = PluginDescriptorTest.class.getResourceAsStream(name)) {
            assert input != null;
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
