# Release Instructions

## Creating a Release for macOS

Releases are automated via GitHub Actions. Simply create a git tag and push it to trigger the release workflow.

### Quick Start

```bash
# Create a tag for version 1.0.0
git tag v1.0.0

# Push the tag to GitHub
git push origin v1.0.0
```

This triggers the **Release macOS** workflow which:
1. ✅ Builds the Java backend as a native binary (GraalVM)
2. ✅ Builds the React frontend (Vite)
3. ✅ Packages everything as a Tauri app
4. ✅ Creates a macOS DMG installer
5. ✅ Publishes a GitHub Release with the DMG attached
6. ✅ Generates release notes from commits

### Versioning

Use semantic versioning for tags:
- `v1.0.0` - Major release
- `v1.0.1` - Patch release
- `v1.1.0` - Minor release
- `v1.0.0-beta.1` - Pre-release

### What Gets Built

When you push a tag like `v1.0.0`, the workflow produces:

**macOS Deliverables:**
- `FlowForge_1.0.0_x64.dmg` - Universal x64 DMG installer for Intel & Apple Silicon

**What's Included:**
- Native backend binary (compiled from Java via GraalVM)
- React UI (bundled with Vite)
- Tauri shell wrapper

### Monitoring the Build

1. Go to your repository's **Actions** tab
2. Click **Release macOS** workflow
3. Watch the build progress (typically 60-90 minutes on GitHub runners)
4. Once complete, the DMG will be attached to the GitHub Release

### Manual Release (if needed)

If the automated release fails, you can manually build locally:

```bash
# Verify prerequisites
./scripts/verify-macos-packaging.sh

# Build everything
./package-tauri-macos.sh

# Find the DMG
ls -la ui/src-tauri/target/release/bundle/dmg/

# Manually create a GitHub Release and upload the DMG
```

### Pre-Release Checklist

Before creating a release tag:

```bash
# 1. Ensure all tests pass
cd ui && npm test

# 2. Update version numbers (optional)
# - src-tauri/tauri.conf.json (version field)
# - backend/build.gradle.kts (version field)
# - ui/package.json (version field)

# 3. Commit version changes (if any)
git add .
git commit -m "Bump version to 1.0.0"

# 4. Create the release tag
git tag v1.0.0

# 5. Push both commits and tag
git push origin main
git push origin v1.0.0
```

### Testing the Release Locally

After downloading the DMG:

```bash
# Mount the DMG
open FlowForge_1.0.0_x64.dmg

# Drag "FlowForge.app" to Applications folder
# Or run directly from the mounted DMG

# Launch the app
open /Applications/FlowForge.app
```

### Troubleshooting Build Failures

**GraalVM native-image failure:**
- The workflow will fallback to bundling the Java JAR
- Check workflow logs for `native-image` error details
- May be due to unsupported Java features — check `backend/build.gradle.kts`

**Frontend build failure:**
- Check `npm run build` output in workflow logs
- Ensure all dependencies are in `ui/package.json`
- Run locally: `cd ui && npm run build`

**Tauri build failure:**
- Ensure Tauri CLI is compatible with Rust version
- Check `src-tauri/tauri.conf.json` syntax
- Update Tauri: `npm install -g @tauri-apps/cli@latest`

**DMG not found:**
- Check if `create-dmg` is installed on macOS
- Verify `ui/src-tauri/target/release/bundle/macos/` exists
- Tauri may have output app in a different location

### Next Steps: Windows & Linux

To add Windows and Linux releases, create similar workflows:
- `.github/workflows/release-windows.yml` - Builds MSI installer
- `.github/workflows/release-linux.yml` - Builds AppImage

Or modify the existing workflow to build all platforms in parallel.

### Support

For issues with:
- **Tests**: See `ui/e2e/` and run `npm run test:ui` for interactive debugging
- **Backend build**: Check `backend/scripts/prepare_native_image.sh` and Java/GraalVM setup
- **Tauri packaging**: Visit [Tauri docs](https://tauri.app/en/docs/)
