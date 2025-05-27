import { Context, Hono } from "hono";
import { cache } from "hono/cache";
import { screenshot, ScreenshotOptions } from "./screenshot";

const app = new Hono<{ Bindings: CloudflareBindings }>();

function newUrl(pathname: string, baseUrl: string): URL | null {
  try {
    return new URL(pathname, baseUrl);
  } catch (_) {
    return null;
  }
}

async function handle(context: Context) {
  if (context.req.header("x-worker-cgi") === "screenshot")
    return context.newResponse(null, 508);

  const _options = Object.fromEntries((context.req.param("options") || "").split(",").map((option) => {
    const [key, ...values] = option.trim().split("=");
    let value = values.join("=");

    return [key, value];
  })) as Record<string, string>;

  const prefersDark = context.req.header("sec-ch-prefers-color-scheme") === "dark"

  const pathname = context.req.param("pathname") || "";
  const origin = context.req.param("url") || context.req.url;

  const url = newUrl(pathname ? `/${pathname}` : "", origin);
  if (!url) return context.newResponse(null, 400);

  const { json, ...options }: ScreenshotOptions & { json: "options" | "result" | false } = {
    width: Number.parseInt(_options.width || "1440", 10),
    height: Number.parseInt(_options.height || "756", 10),
    dark: _options.dark === "true" || prefersDark,
    dpr: Number.parseFloat(_options.dpr || "1"),
    userAgent: _options.userAgent || context.req.header("User-Agent")!,
    json: _options.json as any || false
  };

  if (json === "options") return context.json({ url, options })

  const value = await screenshot(url, options);
  if (json === "result") return context.json({ url, options, value });

  return context.newResponse(value.data, 200, {
    "content-type": "image/png",
    "accept-ch": "sec-ch-prefers-color-scheme"
  });
}

app.get(
  "*",
  cache({
    cacheName: "screenshot",
    cacheControl: "max-age=28800, s-maxage=28800, stale-while-revalidate=604800",
  })
)

app.get("/worker-cgi/screenshot/:options{[^/]*=[^/]*}/:pathname{.+}", handle);
app.get("/worker-cgi/screenshot/:pathname{.+}", handle);
app.get("/:options{[^/]*=[^/]*}/:url{.+}", handle);
app.get("/:url{.+}", handle);

app.notFound((context) => context.newResponse(null, 400))

export default app;
