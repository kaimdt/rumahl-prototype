#!/usr/bin/env python3
"""
IORA Developer App - Hot Reload Example

This example demonstrates using the IORA Developer App's hot-reload capabilities
to update a running app without full container restart.

Requirements:
- Developer Mode must be enabled
- Developer App must be installed (auto-installs when Developer Mode enabled)
- App must have HotReload permission (exclusive to Developer App)
"""

import asyncio
import base64
import json
from pathlib import Path
from iora_sdk import IoraClient


async def build_and_package_app(app_path: Path) -> str:
    """
    Build app and create package for hot reload.

    In a real scenario, this would:
    1. Build the app (compile, bundle, etc.)
    2. Create a tarball of updated files
    3. Return base64 encoded package

    For this example, we'll create a simple package.
    """
    print(f"📦 Building app from {app_path}...")

    # Simulate building and packaging
    package_data = {
        "files": {
            "main.py": "# Updated code\nprint('Hot reloaded!')",
            "config.json": json.dumps({"version": "1.1.0", "hot_reload": True}),
        },
        "metadata": {
            "build_time": "2026-04-21T12:00:00Z",
            "builder": "iora-dev-tool",
        }
    }

    # Encode as base64
    package_json = json.dumps(package_data)
    package_b64 = base64.b64encode(package_json.encode()).decode()

    print(f"✓ Package created ({len(package_b64)} bytes)")
    return package_b64


async def main():
    """Demonstrate hot-reload workflow"""

    # Configuration
    IORA_URL = "http://localhost:8080"
    API_KEY = "your-api-key-here"
    APP_ID = "com.example.my-app"

    async with IoraClient(IORA_URL, api_key=API_KEY) as client:
        print("🚀 IORA Developer App - Hot Reload Demo\n")

        # Step 1: Check Developer Mode status
        print("1️⃣ Checking Developer Mode status...")
        status = await client.get_developer_mode_status()

        if not status["developer_mode"]:
            print("⚠️  Developer Mode is disabled")
            print("   Enabling Developer Mode (this will auto-install Developer App)...")
            await client.toggle_developer_mode(enabled=True)
            print("✓ Developer Mode enabled")

            # Wait a moment for Developer App to start
            print("   Waiting for Developer App to initialize...")
            await asyncio.sleep(5)
        else:
            print("✓ Developer Mode is enabled")

        # Step 2: Check current hot reload status
        print(f"\n2️⃣ Checking hot reload status for {APP_ID}...")
        try:
            current_status = await client.hotreload_status(APP_ID)
            print(f"   Current version: {current_status.get('version', 'N/A')}")
            print(f"   Status: {current_status.get('status', 'N/A')}")
        except Exception as e:
            print(f"   No previous hot reload: {e}")

        # Step 3: View hot reload history
        print(f"\n3️⃣ Retrieving hot reload history...")
        try:
            history = await client.hotreload_history(APP_ID)
            if history:
                print(f"   Found {len(history)} previous deployments:")
                for entry in history[-3:]:  # Show last 3
                    print(f"     - v{entry['version']} at {entry['timestamp']}")
            else:
                print("   No history found (first deployment)")
        except Exception as e:
            print(f"   Could not retrieve history: {e}")

        # Step 4: Build and upload new version
        print(f"\n4️⃣ Building and uploading new version...")
        app_path = Path("./my-app")
        package_data = await build_and_package_app(app_path)

        try:
            result = await client.hotreload_upload(
                app_id=APP_ID,
                version="1.1.0",
                package_data=package_data,
                description="Fix critical bug and add new feature"
            )
            print(f"✓ Hot reload successful!")
            print(f"   Status: {result.get('status', 'unknown')}")
            print(f"   Message: {result.get('message', 'N/A')}")

            if "checksum" in result:
                print(f"   Checksum: {result['checksum'][:16]}...")
        except Exception as e:
            print(f"❌ Hot reload failed: {e}")
            return

        # Step 5: Verify deployment
        print(f"\n5️⃣ Verifying deployment...")
        await asyncio.sleep(2)  # Wait for deployment

        new_status = await client.hotreload_status(APP_ID)
        print(f"   New version: {new_status.get('version', 'N/A')}")
        print(f"   Deployment status: {new_status.get('status', 'N/A')}")

        # Step 6: Demonstrate rollback (optional)
        print(f"\n6️⃣ Testing rollback capability...")
        print("   (Skipping rollback in this demo)")
        print("   To rollback: client.hotreload_rollback(APP_ID, '1.0.0')")

        # Example rollback:
        # try:
        #     rollback_result = await client.hotreload_rollback(APP_ID, "1.0.0")
        #     print(f"✓ Rolled back to version 1.0.0")
        # except Exception as e:
        #     print(f"❌ Rollback failed: {e}")

        print("\n✅ Hot reload demo complete!")
        print("\n📚 What happened:")
        print("   1. Developer Mode enabled (auto-installed Developer App)")
        print("   2. App package built and encoded")
        print("   3. Package uploaded to Developer App")
        print("   4. Developer App performed hot reload")
        print("   5. App updated without full container restart")
        print("\n💡 Benefits:")
        print("   - Faster development iteration")
        print("   - No downtime during updates")
        print("   - Version history and rollback capability")
        print("   - Preserves app state across updates")


async def ide_integration_example():
    """
    Example of IDE integration for automatic hot-reload on file save.

    This could be integrated into VS Code, PyCharm, or other IDEs
    to automatically push updates when files change.
    """
    async with IoraClient("http://localhost:8080", api_key="dev-key") as client:
        # Watch for file changes
        print("👁️  Watching for file changes...")

        # Pseudo-code for file watching:
        # while True:
        #     if files_changed:
        #         package = await build_and_package_app(Path("./my-app"))
        #         await client.hotreload_upload(
        #             app_id="com.example.my-app",
        #             version=f"dev-{timestamp}",
        #             package_data=package,
        #             description="Auto-reload on file change"
        #         )
        #         print("✓ Hot reloaded after file change")


if __name__ == "__main__":
    print("=" * 60)
    print("IORA Developer App - Hot Reload Example")
    print("=" * 60)
    print()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n👋 Interrupted by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
