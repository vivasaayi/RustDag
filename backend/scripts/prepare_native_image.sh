#!/usr/bin/env bash
set -euo pipefail

# Build the Java backend jar and create a GraalVM native-image
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "Building backend jar..."
if [[ -x "./gradlew" ]]; then
  # Prefer a regular build first (ensures jar exists). If project supports shadowJar, it can be
  # configured and used explicitly — but don't make shadowJar mandatory.
  ./gradlew clean build || (echo "Gradle clean build failed" && exit 1)
else
  gradle clean build || (echo "Gradle clean build failed" && exit 1)
fi

JAR_PATH=$(find build/libs -name "*all*.jar" -or -name "*jar" | head -n 1)
if [[ -z "$JAR_PATH" ]]; then
  echo "Could not find JAR in build/libs"
  exit 1
fi

echo "Creating minimal JRE with jlink for self-contained app..."
# Analyze JAR dependencies to determine required modules
MODULES=$(jdeps --print-module-deps --ignore-missing-deps "$JAR_PATH" 2>/dev/null || echo "java.base,java.net.http,java.logging")
if [[ -z "$MODULES" ]]; then
  MODULES="java.base,java.net.http,java.logging"
fi
echo "Required modules: $MODULES"

# Create minimal JRE
jlink --add-modules "$MODULES" --output build/jre --compress=2 --no-header-files --no-man-pages

# Copy JRE to Tauri bin
mkdir -p "$ROOT_DIR/../ui/src-tauri/bin"
cp -r build/jre "$ROOT_DIR/../ui/src-tauri/bin/"

if ! command -v native-image >/dev/null 2>&1; then
  echo "native-image is not available. Install GraalVM and native-image plugin."
  exit 1
fi

# Build native image in the backend/build/native directory
mkdir -p build/native

echo "Preparing classpath for native-image..."
# build classpath containing all jars in build/libs
CP=$(find build/libs -maxdepth 1 -name "*.jar" -print | tr '\n' ':')
CP=${CP%:}

echo "Classpath: $CP"

echo "Running native-image with classpath and main class 'app.Main'..."
if ! native-image --no-fallback -cp "$CP" -H:Name=backend app.Main; then
  echo "native-image failed. You may need reflection config or additional flags."
  echo "Trying fallback build with runtime reporting and initialization flags..."
  if ! native-image --no-fallback -cp "$CP" -H:Name=backend --report-unsupported-elements-at-runtime --initialize-at-build-time app.Main; then
    echo "native-image fallback also failed. Proceeding with jar fallback."
    echo "See the svm_err* files in the backend directory for error reports."
  fi
fi

# Copy binary to ui/src-tauri/bin
mkdir -p "$ROOT_DIR/../ui/src-tauri/bin"
if [[ -f build/native/backend ]]; then
  cp build/native/backend "$ROOT_DIR/../ui/src-tauri/bin/"
else
  echo "Native backend not built; copying backend jar as fallback"
  mkdir -p "$ROOT_DIR/../ui/src-tauri/bin"
  cp "$JAR_PATH" "$ROOT_DIR/../ui/src-tauri/bin/backend.jar"
fi

if [[ -f build/native/backend ]]; then
  echo "Native image built and copied to ui/src-tauri/bin/"
  # Ensure binary is executable
  chmod +x "$ROOT_DIR/../ui/src-tauri/bin/backend"
else
  echo "Jar copied to ui/src-tauri/bin/backend.jar (native image not available)"
fi

echo "Done."