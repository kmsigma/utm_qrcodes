// Minimal launcher for serving the wwwroot static files for the QR tool.
// Kept separate from the main project to avoid depending on DB packages.
using Microsoft.AspNetCore.Builder;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// Security headers for all responses
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers.XFrameOptions = "SAMEORIGIN";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    ctx.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; " +
        "script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' https://cloudflareinsights.com;";
    await next();
});

// Health check endpoint — used by Docker and load balancers to verify the app is running
app.MapGet("/healthz", () => Results.Ok(new { status = "healthy" }));

// Version endpoint — returns the APP_VERSION build arg injected at image build time
var appVersion = Environment.GetEnvironmentVariable("APP_VERSION") ?? "dev";
app.MapGet("/version", () => Results.Ok(new { version = appVersion }));

// Serve the index page with the version injected at startup rather than fetched at runtime.
// Reading once here avoids a JS fetch() that Cloudflare and other proxies can silently block.
var indexPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "qrcodes.html");
var indexHtml = File.ReadAllText(indexPath).Replace("__APP_VERSION__", appVersion);
app.MapGet("/", () => Results.Content(indexHtml, "text/html; charset=utf-8"));

// Serve all other static assets (CSS, JS, images, fonts, etc.)
app.UseStaticFiles();

app.Run();
