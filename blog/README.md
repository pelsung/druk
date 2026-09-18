# The Druk.help blog

Plain HTML, no build step, no dependencies. Every post is a real static page, so
it loads fast and search engines see the whole article.

```
blog/
  index.html          the listing page (search + topic filters)
  posts.js            the list of posts — this drives the index
  blog.css            all blog styling, shared by every page
  blog.js             reveal animation, search/filter, related posts
  _template.html      starting point for a new post
  new-post.mjs        scaffolds a post and syncs everything below
  sync.mjs            rebuilds sitemap.xml + the landing page's blog section
  <slug>.html         one file per post
```

Three places show posts, all driven by `posts.js`:

- `/blog/` — every post, with search and topic filters
- `/` — the three newest, in the **From the blog** section (section 09)
- `sitemap.xml` — one entry per post

## Adding a post — the quick way

From the `druk/` folder:

```bash
node blog/new-post.mjs "What we learned running CARE for six months" \
  --excerpt "Six months in, here is what surprised us." \
  --tags "CARE, Healthcare"
```

That creates `blog/what-we-learned-running-care-for-six-months.html`, adds it to
the top of `blog/posts.js`, rebuilds `sitemap.xml`, and refreshes the three
cards in the landing page's **From the blog** section.

Then open the new file and write the article inside `<div class="post-body">`.
Nothing else in the page needs editing.

Other options: `--author "Name"`, `--date 2026-10-02`, `--slug custom-slug`,
`--image images/my-post.svg`, `--force` to overwrite.

## Cover images

A post with an `image` in `posts.js` shows that cover on the blog index and in
the landing page's **From the blog** cards. Posts without one still render
fine — the card just starts at the date.

Drop the file in `blog/images/` and reference it relative to `blog/`:

```js
"image": "images/my-post.svg"
```

Covers are drawn at 3:2 (the existing ones are 600×400 SVGs in the site palette:
`#8E2B1F`, `#D9A62E`, `#4E7A46`, `#3F6E9D`, `#22170F` on `#EFE7D8`). SVG keeps
them crisp and tiny; JPG or PNG works too.

## Adding a post — by hand

1. Copy `_template.html` to `blog/your-post-slug.html`.
2. Replace every `{{PLACEHOLDER}}` (they are all in the `<head>` and the post
   header — title, description, slug, date, author, tags).
3. Write the article inside `<div class="post-body">`.
4. Add an entry at the top of the array in `blog/posts.js`:

   ```js
   {
     "slug": "your-post-slug",
     "title": "Your post title",
     "date": "2026-10-02",
     "author": "Druk.help",
     "excerpt": "One or two sentences shown on the index.",
     "tags": ["Bhutan", "Healthcare"]
   }
   ```

5. Run `node blog/sync.mjs` — it rebuilds `sitemap.xml` and the landing page's
   **From the blog** cards from `posts.js`.

Run that sync after editing or deleting a post by hand, too. It only touches
the block between the `BLOG:START` and `BLOG:END` markers in `/index.html`, so
nothing else in the landing page is affected.

## Writing in the post body

The stylesheet covers the elements you are likely to need:

| You want | Use |
| --- | --- |
| Section heading | `<h2>` (serif) and `<h3>` (sans) |
| Pull quote | `<blockquote><p>…</p></blockquote>` |
| Boxed aside | `<div class="post-callout">…</div>` |
| Image with caption | `<figure><img src="images/x.jpg" alt="…"><figcaption>…</figcaption></figure>` |
| Code | `<code>` inline, `<pre><code>` for blocks |
| Table | wrap it in `<div class="post-table-wrap">` so it scrolls on phones |

Always write a real `alt` for images. Put image files in `blog/images/`.

## Topic tags

Tags are free text. Whatever appears in `posts.js` becomes a filter button on
the index automatically, so keep them consistent — `Healthcare`, not
`healthcare` in one post and `Health` in another.

## Mobile menu

Every blog page carries a burger menu that appears under 900px, matching the
landing page. Its markup sits in the page header (`.dh-burger` plus
`#blog-mobile-nav`) and `blog.js` drives the toggle, so new posts copied from
`_template.html` get it automatically.

## Previewing locally

Every internal link and asset path is relative, so the site works either way:
double-click `index.html` to open it straight from disk, or serve the folder:

```bash
npx serve .          # from the druk/ folder, then visit /blog/
```

Keep new links relative (`blog/post.html`, `../index.html#care`) — a root-absolute
`/blog/…` resolves to `C:/blog/…` when the file is opened from disk and breaks.

## Reading time

Calculated from the article text at page load — nothing to maintain.

## Publishing

Commit and push. The blog is part of the same static site as the landing page.
