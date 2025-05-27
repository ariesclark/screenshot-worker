import { env } from "cloudflare:workers"
import puppeteer, { Page } from "@cloudflare/puppeteer";

export interface ScreenshotOptions {
  width: number;
  height: number;
  dpr: number;
  dark: boolean;
  userAgent: string;
}

export interface Screenshot {
  data: Buffer;
}

async function interceptionCache(page: Page) {
  await page.setRequestInterception(true);

  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled() || page.isClosed()) return;

    const cacheKey = new Request(request.url(), {
      method: request.method(),
      headers: request.headers()
    });

    const cachedResponse = await caches.default.match(cacheKey);
    if (!cachedResponse) {
      console.log(`Cache miss for ${request.url()}.`);
      return request.continue();
    }

    console.log(`Cache hit for ${request.url()}.`);

    request.respond({
      status: cachedResponse.status,
      headers: Object.fromEntries(cachedResponse.headers.entries()),
      body: Buffer.from(await cachedResponse.arrayBuffer())
    })
  });

  page.on("response", async (response) => {
    const cacheKey = new Request(response.url(), {
      method: response.request().method(),
      headers: response.headers()
    });

    await caches.default.put(cacheKey, new Response(await response.buffer(), {
      status: response.status(),
      headers: response.headers()
    }));
  });
}

export async function screenshot(url: URL, options: ScreenshotOptions): Promise<Screenshot> {
  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();

  await Promise.all([
    page.setBypassCSP(true),
    interceptionCache(page),
    page.setDefaultNavigationTimeout(5000),
    page.setDefaultTimeout(5000),
    page.setExtraHTTPHeaders({
      "x-worker-cgi": "screenshot",
    }),
    page.setUserAgent(options.userAgent),
    page.setViewport({
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.dpr
    }),
    page.emulateMediaFeatures([
      {
        name: "prefers-color-scheme",
        value: options.dark ? "dark" : "light"
      }
    ])
  ])

  await page.goto(url.href);
  await page.waitForNetworkIdle();

  await page.addStyleTag({
    content: `html {
  overflow: hidden;
}

body {
  overflow: hidden;
  scrollbar-width: none;
}
body::-webkit-scrollbar {
  display: none;
}

* {
  scrollbar-width: none !important;
  scrollbar-color: transparent transparent !important;
}

*::-webkit-scrollbar {
  display: none !important;
}`});

  const data = await page.screenshot();
  await browser.close();

  return {
    data,
  }
}