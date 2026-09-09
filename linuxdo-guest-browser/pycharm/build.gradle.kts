plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.9.0"
}

group = "studio.lexiao"
version = "0.12.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        local(System.getenv("PYCHARM_HOME") ?: "/Applications/PyCharm.app")
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("223")
            untilBuild.set("263.*")
        }
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}
