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
        val localPycharm = System.getenv("PYCHARM_HOME")
        if (localPycharm.isNullOrBlank()) {
            create("PY", providers.gradleProperty("platformVersion").getOrElse("2026.1.4"))
        } else {
            local(localPycharm)
        }
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
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
    options.release.set(17)
}

val compatibilityTestClasses = listOf(
    "studio.lexiao.linuxdo.ShareCodeTest",
    "studio.lexiao.linuxdo.ReaderHistoryTest",
    "studio.lexiao.linuxdo.PluginDescriptorTest"
)

val compatibilityTests = compatibilityTestClasses.map { testClass ->
    tasks.register<JavaExec>("run${testClass.substringAfterLast('.')}") {
        group = "verification"
        description = "Runs $testClass with assertions enabled."
        dependsOn(tasks.named("testClasses"))
        classpath = sourceSets["test"].runtimeClasspath
        mainClass.set(testClass)
        enableAssertions = true
        workingDir = projectDir
    }
}

tasks.register("compatibilityTest") {
    group = "verification"
    description = "Runs the standalone compatibility regression tests."
    dependsOn(compatibilityTests)
}

tasks.named("check") {
    dependsOn("compatibilityTest")
}
