from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:1420/rumahl-overlay")
    page.wait_for_timeout(2000)

    # Take a screenshot first to see what's on the screen
    page.screenshot(path="/home/jules/verification/screenshots/verification_video_pre.png")
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
