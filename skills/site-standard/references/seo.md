# SEO fundamentals

These are the basics that decide whether a page can be found and whether a shared link looks right. None of it is clever; all of it is commonly missed. The checker's `seo` rules enforce everything on this page that can be measured.

Framework APIs for metadata change between versions. The requirements below are stable; for the syntax, read the documentation of the version installed in the project, not what you remember.

## Every page

**Title.** Unique to the page, 20 to 70 characters. Lead with what the page is, then the business and place: `Wedding cakes | Example Bakery, Springfield`. Search results cut long titles off, and a title that is only the business name wastes the most valuable words on the page.

**Meta description.** Unique, 100 to 160 characters, written as a sentence a person would want to click: what is on the page and why it matters to them. Shorter looks thin in results; longer is cut off.

**Canonical link.** `<link rel="canonical">` with the page's own full address on the production host. It tells search engines which URL is the real one when the same page is reachable several ways.

**Open Graph.** `og:title`, `og:type`, `og:image` and `og:url`, on every page. Without `og:image` and `og:url` a link pasted into a chat or social post has no preview. `og:url` must match the canonical URL. The image should be a real photo or the logo on a plain ground, at least 1200 pixels wide, referenced by its full address. When there is neither photo nor logo, make a plain one (the business name, and perhaps the town, set in the site's type on its main colour) and tell the user it is a stand-in.

**Headings.** One `<h1>` that says what the page is about, then `<h2>` and below in order. Choose heading levels for structure, never for size.

**Language.** `<html lang="en">` (or the page's language). Screen readers and translation tools depend on it.

**Images.** Every `<img>` has `alt`. Describe what the image shows as you would to someone who cannot see it; use `alt=""` for decoration. "Image", "photo" and file names are not descriptions.

Pages that should not appear in search (admin, thank-you pages) carry `<meta name="robots" content="noindex">` and stay out of the sitemap.

## The site

**One address for everything.** Decide the production host (`www` or bare) and use exactly that in every absolute URL the site writes: canonicals, Open Graph tags, the sitemap, the robots.txt `Sitemap:` line, structured data. The other host redirects, and each reference to it sends crawlers and visitors through an avoidable hop. The same goes for paths: if the host serves clean URLs, link to `/about`, not `/about.html`; if it adds or strips trailing slashes, link to the form it ends up on. Internal links should never redirect.

Keep the production origin in one constant or environment variable and build every absolute URL from it. Scattered string literals are how the wrong host creeps in.

If you do not know how the host treats addresses, use a form that works everywhere without a redirect: either link to the files as they are (`/menu.html`), or give each page its own folder (`/menu/index.html`, linked as `/menu/`). Do not link to `/menu` with no extension and no slash unless you know the host serves it. Tell the user which you chose.

**robots.txt** at the root, allowing crawling and naming the sitemap with its full address.

**sitemap.xml** listing every page that should be indexed, each with its final address: no redirects, no `noindex` pages, no pages that do not exist. Generate it from the same list of routes the site is built from, so it cannot drift.

**Structured data.** A JSON-LD block on the home page describing the business. Use the most specific schema.org type that fits (`Bakery`, `Plumber`, `RealEstateAgent`, `Dentist`; fall back to `LocalBusiness`). Include only facts that are also visible on the site: name, address, phone, opening hours, logo, URL. Leave out `sameAs` unless the business has real profiles to list, and never add ratings or reviews that are not shown on the page. Search engines treat structured data that contradicts the page as spam.

Name, address and phone should be written identically everywhere a visitor reads them: page header, footer, contact page. Inconsistent details weaken local search results. The machine-readable forms are expected to differ: `tel:` links and the structured data's `telephone` use the international format (`+44...`, `+1...`) while the page shows the number the way local customers dial it.

**Favicon.** The business's own, not the framework's default. Without a logo, an initial or simple mark in the site's colours, as an SVG, is a reasonable stand-in; say that it is one.

## Framework notes

**Next.js (App Router).** Set `metadataBase` once in the root layout so relative image paths resolve to the production origin. Metadata is merged shallowly: a page that sets `openGraph` replaces the layout's whole `openGraph` object, so the page loses `og:image` unless it repeats or spreads the shared values. Put canonical and `og:url` on each page, not in the root layout, or every route inherits the home page's URL. Generate the sitemap and robots.txt from `app/sitemap.ts` and `app/robots.ts`. Replace `app/favicon.ico`; the one created with the project is the framework's logo.

**Astro.** Set `site` in the config and build canonicals from `Astro.url` and `Astro.site`. Put shared head tags in a layout that takes title, description and image as props, so no page can omit them. The official sitemap integration needs `site` to be set.

**Plain HTML.** Every page carries its own head tags by hand, so copy a complete, correct head when adding a page, then change every value in it. Stale `og:url` and canonical values copied from another page are the usual mistake. If the host serves clean URLs, write every internal link without `.html`.

## Preview deployments

A preview lives on a temporary host, while its canonicals and sitemap correctly name production. That is expected. Check a preview with `--baseline <production URL>` or `--canonical-origin <production origin>` so those URLs are tested against the preview's own pages.

## What this does not cover

Keyword research, content strategy, backlinks, page speed and business listings matter too, and none of them are checked here. Do not tell a user their SEO is "done" because the checker passes; say the technical fundamentals are in order.
