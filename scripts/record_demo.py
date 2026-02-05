#!/usr/bin/env python3
"""
Record a demo GIF/video of aicoder for the GitHub README.

Usage:
    1. Start the app: python -m ac.dc --dev
    2. Run this script: python scripts/record_demo.py
    3. Convert to GIF: python scripts/record_demo.py --convert

Requirements:
    pip install playwright
    playwright install chromium
    
For GIF conversion, ffmpeg must be installed:
    brew install ffmpeg  # macOS
    apt install ffmpeg   # Linux
"""

import argparse
import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path


DEMO_DIR = Path(__file__).parent.parent / "demo_videos"
DEFAULT_PORT = 18080
DEFAULT_WEBAPP_PORT = 18999


async def record_demo(
    port: int = DEFAULT_PORT,
    webapp_port: int = DEFAULT_WEBAPP_PORT,
    headless: bool = False,
    width: int = 1080,
    height: int = 768,
    slow_mo: int = 50,
):
    """Record a demo video of aicoder in action."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("❌ Playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    # Ensure output directory exists
    DEMO_DIR.mkdir(exist_ok=True)
    
    print(f"🎬 Recording demo to {DEMO_DIR}/")
    print(f"   Connecting to http://localhost:{webapp_port}/?port={port}")
    print(f"   Resolution: {width}x{height}")
    print(f"   Headless: {headless}")
    print()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            slow_mo=slow_mo,  # Slow down for visibility
        )
        context = await browser.new_context(
            viewport={"width": width, "height": height},
            record_video_dir=str(DEMO_DIR),
            record_video_size={"width": width, "height": height},
        )
        page = await context.new_page()
        
        # Navigate to the app
        url = f"http://localhost:{webapp_port}/?port={port}"
        print(f"📡 Navigating to {url}")
        
        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            print(f"❌ Could not connect to {url}")
            print(f"   Make sure the app is running: python -m ac.dc --dev")
            print(f"   Error: {e}")
            await browser.close()
            sys.exit(1)
        
        print("✅ Connected to app")
        
        # Wait for app to initialize
        await page.wait_for_timeout(2000)
        
        # === Demo Sequence ===
        # Customize this section to showcase features
        
        print("🎬 Starting demo sequence...")
        
        # 1. Show the initial UI
        await page.wait_for_timeout(1500)
        
        # 2. Select README.md in file picker first (adds to context)
        print("   📂 Selecting README.md...")
        file_picker = page.locator("file-picker")
        readme_checkbox = file_picker.locator("text=README.md").first
        if await readme_checkbox.count() > 0:
            await readme_checkbox.click()
        await page.wait_for_timeout(500)
        
        # 3. Type a prompt to edit README.md
        print("   📝 Typing prompt...")
        textarea = page.locator("prompt-view").locator("textarea")
        await textarea.click()
        await page.wait_for_timeout(300)
        
        demo_prompt = "Edit README.md - add a tagline at the top after the title"
        await textarea.type(demo_prompt, delay=30)
        await page.wait_for_timeout(800)
        
        # 4. Send the message (Ctrl+Enter)
        print("   📤 Sending message...")
        await textarea.press("Control+Enter")
        
        # 5. Open README.md in the diff viewer (double-click)
        print("   📂 Opening README.md in diff viewer...")
        await page.wait_for_timeout(1000)
        readme_file = file_picker.locator("text=README.md").first
        if await readme_file.count() > 0:
            await readme_file.dblclick()
        
        # 5. Wait for AI response to complete and diff to update
        print("   ⏳ Waiting for AI response and diff update...")
        await page.wait_for_timeout(15000)
        
        # 6. Click on the Context tab
        print("   📊 Opening Context tab...")
        context_tab = page.locator("prompt-view").locator("text=Context").first
        if await context_tab.count() > 0:
            await context_tab.click()
        
        # 7. Wait for context tab to load
        print("   ⏳ Waiting for context to load...")
        await page.wait_for_timeout(3000)
        
        # 8. Final pause
        print("   ✨ Final pause...")
        await page.wait_for_timeout(1000)
        
        print("🎬 Demo sequence complete")
        
        # Close context to save video
        await context.close()
        await browser.close()
        
    # Find the recorded video
    videos = list(DEMO_DIR.glob("*.webm"))
    if videos:
        latest = max(videos, key=lambda p: p.stat().st_mtime)
        final_path = DEMO_DIR / "demo.webm"
        shutil.move(str(latest), str(final_path))
        print(f"\n✅ Video saved to: {final_path}")
        print(f"\n💡 Convert to GIF with: python {__file__} --convert")
    else:
        print("\n⚠️  No video file found")


def convert_to_gif(
    input_path: Path = DEMO_DIR / "demo.webm",
    output_path: Path = DEMO_DIR / "demo.gif",
    fps: int = 10,
    width: int = 800,
):
    """Convert WebM video to GIF using ffmpeg."""
    if not input_path.exists():
        print(f"❌ Input video not found: {input_path}")
        print(f"   Run recording first: python {__file__}")
        sys.exit(1)
    
    if not shutil.which("ffmpeg"):
        print("❌ ffmpeg not found. Install it:")
        print("   macOS: brew install ffmpeg")
        print("   Linux: apt install ffmpeg")
        sys.exit(1)
    
    print(f"🎨 Converting {input_path} to GIF...")
    print(f"   Output: {output_path}")
    print(f"   FPS: {fps}, Width: {width}")
    
    # High-quality GIF conversion with palette generation
    filter_complex = (
        f"fps={fps},scale={width}:-1:flags=lanczos,"
        f"split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
    )
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", filter_complex,
        "-loop", "0",
        str(output_path),
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"\n✅ GIF saved to: {output_path} ({size_mb:.1f} MB)")
        
        if size_mb > 10:
            print(f"\n💡 GIF is large. Try reducing size:")
            print(f"   python {__file__} --convert --fps 8 --width 640")
    except subprocess.CalledProcessError as e:
        print(f"❌ ffmpeg failed: {e.stderr.decode()}")
        sys.exit(1)


def convert_to_apng(
    input_path: Path = DEMO_DIR / "demo.webm",
    output_path: Path = DEMO_DIR / "demo.apng",
    fps: int = 15,
    width: int = 800,
):
    """Convert WebM video to APNG (better quality than GIF)."""
    if not input_path.exists():
        print(f"❌ Input video not found: {input_path}")
        sys.exit(1)
    
    if not shutil.which("ffmpeg"):
        print("❌ ffmpeg not found")
        sys.exit(1)
    
    print(f"🎨 Converting {input_path} to APNG...")
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", f"fps={fps},scale={width}:-1",
        "-plays", "0",
        str(output_path),
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"\n✅ APNG saved to: {output_path} ({size_mb:.1f} MB)")
    except subprocess.CalledProcessError as e:
        print(f"❌ ffmpeg failed: {e.stderr.decode()}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Record a demo video/GIF of aicoder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Record a demo (app must be running)
    python scripts/record_demo.py
    
    # Record with custom ports
    python scripts/record_demo.py --port 18080 --webapp-port 18999
    
    # Record headless (no browser window)
    python scripts/record_demo.py --headless
    
    # Convert to GIF
    python scripts/record_demo.py --convert
    
    # Convert to smaller GIF
    python scripts/record_demo.py --convert --fps 8 --width 640
    
    # Convert to APNG (better quality)
    python scripts/record_demo.py --convert --apng
""",
    )
    
    parser.add_argument(
        "--convert",
        action="store_true",
        help="Convert existing WebM to GIF instead of recording",
    )
    parser.add_argument(
        "--apng",
        action="store_true",
        help="Convert to APNG instead of GIF (use with --convert)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"JRPC server port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--webapp-port",
        type=int,
        default=DEFAULT_WEBAPP_PORT,
        help=f"Webapp dev server port (default: {DEFAULT_WEBAPP_PORT})",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run browser in headless mode",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1080,
        help="Video width (default: 1080)",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=1080,
        help="Video height (default: 768)",
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=10,
        help="GIF frame rate (default: 10)",
    )
    parser.add_argument(
        "--gif-width",
        type=int,
        default=800,
        help="GIF output width (default: 800)",
    )
    
    args = parser.parse_args()
    
    if args.convert:
        if args.apng:
            convert_to_apng(fps=args.fps, width=args.gif_width)
        else:
            convert_to_gif(fps=args.fps, width=args.gif_width)
    else:
        asyncio.run(
            record_demo(
                port=args.port,
                webapp_port=args.webapp_port,
                headless=args.headless,
                width=args.width,
                height=args.height,
            )
        )


if __name__ == "__main__":
    main()
