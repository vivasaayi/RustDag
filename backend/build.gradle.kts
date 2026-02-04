plugins {
    java
    application
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // Replace versions with latest available on Maven Central
    implementation("io.javalin:javalin:5.4.0")
    // Uncomment and set real versions when you want to include langchain4j & langgraph4j
    // implementation("com.langchain4j:langchain4j:0.x.y")
    // implementation("com.langchain4j:langgraph4j:0.x.y")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.2")
}

application {
    mainClass.set("app.Main")
}


// Packaging example: jlink & jpackage steps (configure below for your OS)