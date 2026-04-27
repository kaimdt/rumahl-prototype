from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:1420")
    page.wait_for_timeout(2000)

    # Click settings gear icon in top right
    page.locator('button[aria-label="Open Desktop Settings"]').click()
    page.wait_for_timeout(1000)

    # Click Desktop tab
    page.get_by_text("Desktop").click()
    page.wait_for_timeout(1000)

    # Take screenshot at the key moment
    page.screenshot(path="/home/jules/verification/screenshots/verification_settings_moved.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos",
            viewport={'width': 1280, 'height': 720}
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
