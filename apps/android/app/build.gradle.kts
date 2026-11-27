plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "moe.seria.undoom"
    compileSdk = 37

    defaultConfig {
        applicationId = "moe.seria.undoom"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    // Passkeys are bound to this key's fingerprint (ANDROID_CERT_FINGERPRINTS on the
    // server), so every release must be signed with the same keystore.
    val storeFile = providers.gradleProperty("UNDOOM_STORE_FILE").orNull
    signingConfigs {
        if (storeFile != null) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = providers.gradleProperty("UNDOOM_STORE_PASSWORD").get()
                keyAlias = providers.gradleProperty("UNDOOM_KEY_ALIAS").get()
                keyPassword = providers.gradleProperty("UNDOOM_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_URL", "\"http://10.0.2.2:8787\"")
        }
        release {
            buildConfigField("String", "API_URL", "\"https://undoom.seria.moe\"")
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

abstract class CopyCatalog : DefaultTask() {
    @get:InputFile
    abstract val catalog: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        catalog.get().asFile.copyTo(outputDir.file("catalog.json").get().asFile, overwrite = true)
    }
}

val repoRoot = rootProject.layout.projectDirectory.dir("../..")

val copyCatalog = tasks.register<CopyCatalog>("copyCatalog") {
    catalog.set(repoRoot.file("packages/catalog/catalog.json"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyCatalog, CopyCatalog::outputDir)
    }
}

tasks.withType<Test>().configureEach {
    val vectors = repoRoot.dir("spec/vectors")
    inputs.dir(vectors)
    systemProperty("undoom.vectors", vectors.asFile.absolutePath)
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")

    testImplementation("junit:junit:4.13.2")
}
