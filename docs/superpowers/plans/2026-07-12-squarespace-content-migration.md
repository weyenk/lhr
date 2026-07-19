# Squarespace Content Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 22 legacy Squarespace/WordPress-exported blog posts into valid `.mdx` files in this repo's `src/content/posts/` collection, all as `type: recipe`.

**Architecture:** A one-off Python script parses the WXR export into per-post intermediate JSON (title, date, excerpt, cover photo URL, inline image URLs, raw content HTML). Each post is then hand-converted from that JSON + its raw HTML into an `.mdx` file, following a worked example established in Task 2. Verification is `npm run build` (real Astro + Zod schema validation) after every batch.

**Tech Stack:** Python 3 (scratch script only, not committed), Astro content collections, Zod (`@lhr/schemas`), MDX.

## Global Constraints

- Source file: `/Users/ashleykruswicki/Desktop/Squarespace-Wordpress-Export-07-12-2026.xml` (read-only, never modify).
- All 22 posts import as `type: recipe`. If a post has no genuine, extractable ingredients/instructions block, stop and flag it instead of inventing one.
- Images keep their original `images.squarespace-cdn.com` URLs, normalized to `https://` (source data sometimes has bare `http://`). Do not re-host to Vercel Blob storage.
- `kitchenwareIds: []` and `affiliateLinkIds: []` for every migrated post (legacy content has neither).
- No WordPress tags/categories carried over — no schema change.
- No `/blog/<slug>` routes or redirects — the site only serves `/posts/<slug>`.
- Filenames reuse the original `wp:post_name` slug exactly, e.g. `src/content/posts/arancini-a-sicilian-street-food-sensation.mdx`.
- `coverPhotoAlt` and any inline-image alt text must be hand-written (originals are `alt=""`), based on what the post's own text says the photo shows.
- The parsing script and its JSON output live only in the session scratchpad (`/private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/`) — never committed to the repo.
- Nothing merges to `main` without the author's explicit review of a PR (per `docs/CONSTITUTION.md` rule 1).
- Full spec: `docs/superpowers/specs/2026-07-12-squarespace-content-migration-design.md`.

---

### Task 1: Build the export-parsing script and generate intermediate JSON

**Files:**
- Create: `/private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/parse_export.py`
- Output: `/private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/post-data/<slug>.json` (22 files)

**Interfaces:**
- Produces: one JSON file per post at `post-data/<slug>.json` with keys `title` (str), `slug` (str), `date` (str, `YYYY-MM-DD`), `excerpt` (str, HTML-stripped), `cover_photo_url` (str, resolved from `_thumbnail_id` via the attachment map, may be `http://`), `inline_image_urls` (list of str, in document order, as found in `content:encoded`), `content_html` (str, raw `content:encoded` body). This JSON is what Tasks 2–7 read.

- [ ] **Step 1: Write the script**

```python
import html
import json
import re
from pathlib import Path

EXPORT_PATH = Path("/Users/ashleykruswicki/Desktop/Squarespace-Wordpress-Export-07-12-2026.xml")
OUTPUT_DIR = Path(__file__).parent / "post-data"

ITEM_RE = re.compile(r"<item>(.*?)</item>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
IMG_SRC_RE = re.compile(r'<img[^>]+src="([^"]+)"')


def get_tag(block: str, tag: str) -> str | None:
    m = re.search(rf"<{tag}>(.*?)</{tag}>", block, re.S)
    if not m:
        return None
    return m.group(1)


def get_cdata_tag(block: str, tag: str) -> str | None:
    m = re.search(rf"<{tag}><!\[CDATA\[(.*?)\]\]></{tag}>", block, re.S)
    if not m:
        return None
    return m.group(1)


def strip_html(raw: str) -> str:
    text = TAG_RE.sub("", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> None:
    xml_text = EXPORT_PATH.read_text(encoding="utf-8")
    items = ITEM_RE.findall(xml_text)

    attachment_url_by_id: dict[str, str] = {}
    for item in items:
        if get_tag(item, "wp:post_type") != "attachment":
            continue
        post_id = get_tag(item, "wp:post_id")
        url = get_tag(item, "wp:attachment_url")
        if post_id and url:
            attachment_url_by_id[post_id] = url

    OUTPUT_DIR.mkdir(exist_ok=True)
    count = 0
    for item in items:
        if get_tag(item, "wp:post_type") != "post":
            continue

        title = html.unescape(get_tag(item, "title") or "")
        slug = get_tag(item, "wp:post_name") or ""
        post_date = get_tag(item, "wp:post_date") or ""
        content_html = get_cdata_tag(item, "content:encoded") or ""
        excerpt_html = get_cdata_tag(item, "excerpt:encoded") or ""

        thumbnail_id_m = re.search(
            r"<wp:meta_key>_thumbnail_id</wp:meta_key>\s*"
            r"<wp:meta_value><!\[CDATA\[(.*?)\]\]></wp:meta_value>",
            item,
            re.S,
        )
        thumbnail_id = thumbnail_id_m.group(1) if thumbnail_id_m else None
        cover_photo_url = attachment_url_by_id.get(thumbnail_id, "") if thumbnail_id else ""

        inline_image_urls = IMG_SRC_RE.findall(content_html)

        data = {
            "title": title,
            "slug": slug,
            "date": post_date.split(" ")[0] if post_date else "",
            "excerpt": strip_html(excerpt_html),
            "cover_photo_url": cover_photo_url,
            "inline_image_urls": inline_image_urls,
            "content_html": content_html,
        }

        out_path = OUTPUT_DIR / f"{slug}.json"
        out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        count += 1

    print(f"Wrote {count} post JSON files to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `python3 /private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/parse_export.py`
Expected: `Wrote 22 post JSON files to .../scratchpad/post-data`

- [ ] **Step 3: Verify output**

Run: `ls /private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/post-data | wc -l`
Expected: `22`

Run: `python3 -c "import json; d=json.load(open('/private/tmp/claude-502/-Users-ashleykruswicki-git-lhr/eefef193-e54a-4588-9738-61c9aa798aa7/scratchpad/post-data/arancini-a-sicilian-street-food-sensation.json')); print(d['title']); print(d['cover_photo_url'])"`
Expected: prints `Arancini: A Sicilian Street Food Sensation` and a `squarespace-cdn.com` URL.

No commit — this script and its output are scratch-only per the Global Constraints, not part of the repo.

---

### Task 2: Convert the first post and establish the conversion pattern

This task hand-converts one post end-to-end and is the reference pattern every later batch task follows exactly (frontmatter shape, image handling, ingredient/step extraction, body structure).

**Files:**
- Create: `src/content/posts/an-homage-to-my-new-city.mdx`

**Interfaces:**
- Consumes: `post-data/an-homage-to-my-new-city.json` (from Task 1).
- Produces: the worked pattern below, which Tasks 3–7 replicate for the other 21 posts.

**Conversion rules** (apply in every task from here on):
1. `type: recipe` always. `title` = JSON `title`. `date` = JSON `date` (unquoted YAML date, e.g. `2025-03-29`).
2. `coverPhoto` = the post's `cover_photo_url`, upgraded to `https://`. If that same image also appears in `inline_image_urls` with a `?format=original` query string, use that fuller URL (higher resolution) instead of the bare attachment URL.
3. `coverPhotoAlt` = a short, specific, hand-written description of the cover photo based on what the post's own text says it depicts. Never reuse the post title as alt text.
4. `excerpt` = JSON `excerpt` verbatim (already HTML-stripped).
5. `kitchenwareIds: []`, `affiliateLinkIds: []` always.
6. `ingredients`: read the embedded "Ingredients" block(s) in `content_html`. One entry per line, split into `item` (the ingredient name/prep, e.g. `"Sweet potato, cubed"`) and `amount` (the quantity, e.g. `"1 medium"`). If a line has no clear quantity, omit `amount` (it's optional). If the recipe has sub-groups (e.g. "For the Rice" / "For the Ragu"), fold the group name into the `item` text (e.g. `"Arborio rice (for the rice)"`) rather than inventing new schema fields — the schema only supports a flat list.
7. `steps`: read the embedded "Instructions"/"Directions" block(s), which may be split across multiple sub-headed lists (e.g. "Make the Rice:", "Fry the Arancini:") — flatten all of them into a single ordered array of complete imperative sentences, preserving their original order.
8. **Fidelity, not correction:** if the source recipe references an ingredient in the steps that's missing from its own ingredient list (a pre-existing authoring slip, not something the migration introduced), carry the ingredient list over exactly as written — don't invent a quantity for the missing item. Note it in your task completion summary so the author can decide whether to fix it later.
9. Body = the narrative text as clean Markdown paragraphs (strip Squarespace's `<div class="sqs-html-content">`/`<p style="...">` wrapper markup, keep the prose). Preserve every inline image from `inline_image_urls` **except** one that's identical to the `coverPhoto` URL (already shown as the header image — don't duplicate it), placed as `![alt](url)` in its original position in the narrative, with hand-written alt text.
10. If the source has a distinct recipe name/title (e.g. "Coconut Curry with Tofu") plus "Yields/Prep time/Cook time" metadata that isn't captured by the schema, keep it as a short `## <Recipe Name>` heading followed by an italic yields/prep/cook line at the point in the body where the recipe block originally appeared (this metadata would otherwise be silently lost). Do not restate the ingredient list or numbered steps in the body — they're already rendered from frontmatter by `RecipeLayout.astro`.

- [ ] **Step 1: Write the file**

```mdx
---
type: recipe
title: "An Homage To My New City"
date: 2025-03-29
coverPhoto: "https://images.squarespace-cdn.com/content/v1/6781cd0cdd3f6f2258f70457/6cdd551a-c807-4bf3-91b2-b282d46e5cfe/Coconut+curry.jpeg?format=original"
coverPhotoAlt: "A steaming bowl of coconut curry with tofu, sweet potato, and peas served over rice"
excerpt: "Moving to a new city meant discovering new flavors. Inspired by its rich Indian influence, I tried my hand at coconut curry with tofu—sweet, spicy, and surprisingly comforting. It wasn't perfect, but with a little sriracha and a lot of heart, it became something special. Food is a journey, even when you stay in one place."
kitchenwareIds: []
affiliateLinkIds: []
ingredients:
  - item: "Sweet potato, cubed"
    amount: "1 medium"
  - item: "Olive oil"
    amount: "1 tablespoon"
  - item: "Yellow onion, diced"
    amount: "1 small"
  - item: "Extra-firm tofu, drained and cubed"
    amount: "1/2 container"
  - item: "Frozen peas"
    amount: "1 cup"
  - item: "Ground cumin"
    amount: "1 teaspoon"
  - item: "Curry powder"
    amount: "1 1/2 tablespoons"
  - item: "Brown sugar"
    amount: "1 tablespoon"
  - item: "Ground cinnamon"
    amount: "1 teaspoon"
  - item: "Salt"
    amount: "to taste"
  - item: "Fresh basil, cut into strips"
    amount: "5 leaves"
  - item: "Coconut milk"
    amount: "1 (14 ounce) can"
  - item: "Cilantro, chopped"
    amount: "1 handful"
steps:
  - "Bring a pot of water to a boil and cook the sweet potato until just tender, about 8 minutes. Drain and set aside."
  - "In a small dish, combine the cumin, curry powder, brown sugar and cinnamon."
  - "Heat olive oil in a large skillet over medium heat. Add the onion and cook until translucent, about 5 minutes."
  - "Add the cubed tofu to the skillet and cook until lightly golden on all sides, about 5-7 minutes."
  - "Stir in the curry powder, brown sugar, cumin, cinnamon, and a pinch of salt. Pour in the coconut milk and stir to combine."
  - "Add the cooked sweet potato, bell peppers, and frozen peas. Let everything simmer for about 10 minutes, allowing the flavors to meld."
  - "Stir in the basil and cilantro right before serving."
  - "If you prefer more heat, add sriracha or your favorite chili sauce. Serve hot over rice or with warm naan."
---

Moving to a new city is always an adventure—full of new sights, sounds, and, most importantly, flavors. My latest move brought me to a place where the vibrant influence of Indian culture is unmistakable. From the aromas drifting out of local restaurants to the colorful spice markets, I found myself constantly inspired to explore new culinary experiences in my own kitchen.

One evening, craving something warm and comforting, I decided to try my hand at coconut curry with tofu. I had never made anything quite like it before, but I was excited to dive in. The combination of creamy coconut milk, fragrant spices, and hearty tofu sounded like the perfect way to embrace my new surroundings through food.

![Close-up of coconut curry with tofu simmering in a pan](https://images.squarespace-cdn.com/content/v1/6781cd0cdd3f6f2258f70457/9fe50b45-abf0-45d4-a0db-33cec5dc5d8f/C6350179-8FF7-4109-A868-18528B13A95A_1_201_a.jpg?format=original)

The result? Not perfect—but definitely delicious. The sweetness of the coconut milk paired beautifully with the warming spices, and the tofu soaked up all the flavors like a dream. I did find myself craving a little more heat, so I drizzled in some sriracha, which added just the right amount of kick. The beauty of home cooking is that it's all about experimenting and making a dish truly your own.

As I sat down to enjoy my homemade coconut curry, I couldn't help but appreciate how food has a way of connecting us to new places, new people, and new experiences. While my version may not have been as refined as the dishes served in the local restaurants, it was a step toward understanding and appreciating a rich culinary tradition. And, most importantly, it was a meal that made my new city feel a little more like home.

## Coconut Curry with Tofu

*Yields 4 servings · Prep 15 minutes · Cook 30 minutes*
```

- [ ] **Step 2: Build the schemas workspace package if needed**

Run: `ls packages/schemas/dist/index.js || npm run build --workspace=packages/schemas`

- [ ] **Step 3: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds and lists `/posts/an-homage-to-my-new-city/index.html` among the generated routes, no Zod validation errors.

- [ ] **Step 4: Commit**

```bash
git add src/content/posts/an-homage-to-my-new-city.mdx
git commit -m "content: migrate 'An Homage To My New City' from Squarespace export"
```

---

### Task 3: Convert posts 2–5 (arancini, chi-town-heat, chili-con-carne, date-night-pizza)

**Files:**
- Create: `src/content/posts/arancini-a-sicilian-street-food-sensation.mdx`
- Create: `src/content/posts/chi-town-heat-a-spicy-homage-to-portillos.mdx`
- Create: `src/content/posts/chili-con-carne-over-tatties-roadside-rescue-culinary-reward.mdx`
- Create: `src/content/posts/date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon.mdx`

**Interfaces:**
- Consumes: `post-data/<slug>.json` for each of the 4 slugs above (from Task 1), and the conversion rules + worked example established in Task 2.
- Produces: 4 new `.mdx` files ready for Task 8's full-suite verification.

- [ ] **Step 1: Convert each post**

For each of the 4 slugs, read its `post-data/<slug>.json` (for `title`, `date`, `excerpt`, `cover_photo_url`, `inline_image_urls`) and its `content_html`, then write `src/content/posts/<slug>.mdx` following the 10 conversion rules in Task 2 exactly (frontmatter shape, `https://` cover photo possibly upgraded to the `?format=original` variant, hand-written alt text, flattened `ingredients`/`steps`, narrative body with inline images preserved except the cover-photo duplicate, trailing recipe-name/yields line where present).

- [ ] **Step 2: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds; routes for all 4 new slugs appear under `/posts/`.

- [ ] **Step 3: Commit**

```bash
git add src/content/posts/arancini-a-sicilian-street-food-sensation.mdx \
        src/content/posts/chi-town-heat-a-spicy-homage-to-portillos.mdx \
        src/content/posts/chili-con-carne-over-tatties-roadside-rescue-culinary-reward.mdx \
        src/content/posts/date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon.mdx
git commit -m "content: migrate 4 posts from Squarespace export (batch 2/6)"
```

---

### Task 4: Convert posts 6–9 (elevate-pizza-night, empanada-de-pato, from-atlanta, fueled-by-deep-dish)

**Files:**
- Create: `src/content/posts/elevate-your-pizza-night-fig-arugula-and-feta-flatbread.mdx`
- Create: `src/content/posts/empanada-de-pato-a-colombian-culinary-adventure.mdx`
- Create: `src/content/posts/from-atlanta-with-flavor-maple-candied-apple-burger-with-bourbon-bacon-jam.mdx`
- Create: `src/content/posts/fueled-by-deep-dish-conquering-the-chicago-cold.mdx`

**Interfaces:**
- Consumes: `post-data/<slug>.json` for each of the 4 slugs above, and the Task 2 conversion rules.
- Produces: 4 new `.mdx` files ready for Task 8's full-suite verification.

- [ ] **Step 1: Convert each post**

Same procedure as Task 3, Step 1, for these 4 slugs.

- [ ] **Step 2: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds; routes for all 4 new slugs appear under `/posts/`.

- [ ] **Step 3: Commit**

```bash
git add src/content/posts/elevate-your-pizza-night-fig-arugula-and-feta-flatbread.mdx \
        src/content/posts/empanada-de-pato-a-colombian-culinary-adventure.mdx \
        src/content/posts/from-atlanta-with-flavor-maple-candied-apple-burger-with-bourbon-bacon-jam.mdx \
        src/content/posts/fueled-by-deep-dish-conquering-the-chicago-cold.mdx
git commit -m "content: migrate 4 posts from Squarespace export (batch 3/6)"
```

---

### Task 5: Convert posts 10–13 (lemon-pepper-wet, madeira-journey, oaxacan-velvet, omurice)

**Files:**
- Create: `src/content/posts/lemon-pepper-wet-an-atlanta-homecoming.mdx`
- Create: `src/content/posts/my-culinary-journey-to-madeira-discovering-the-perfect-prego-sandwich.mdx`
- Create: `src/content/posts/oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro.mdx`
- Create: `src/content/posts/omurice-at-pompompurin-cafe-a-culinary-adventure-in-the-hello-kitty-universe.mdx`

**Interfaces:**
- Consumes: `post-data/<slug>.json` for each of the 4 slugs above, and the Task 2 conversion rules.
- Produces: 4 new `.mdx` files ready for Task 8's full-suite verification.

- [ ] **Step 1: Convert each post**

Same procedure as Task 3, Step 1, for these 4 slugs.

- [ ] **Step 2: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds; routes for all 4 new slugs appear under `/posts/`.

- [ ] **Step 3: Commit**

```bash
git add src/content/posts/lemon-pepper-wet-an-atlanta-homecoming.mdx \
        src/content/posts/my-culinary-journey-to-madeira-discovering-the-perfect-prego-sandwich.mdx \
        src/content/posts/oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro.mdx \
        src/content/posts/omurice-at-pompompurin-cafe-a-culinary-adventure-in-the-hello-kitty-universe.mdx
git commit -m "content: migrate 4 posts from Squarespace export (batch 4/6)"
```

---

### Task 6: Convert posts 14–17 (pistachio-granita, poncha-ed, ramen-with-a-view, suan-la-fen)

**Files:**
- Create: `src/content/posts/pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual.mdx`
- Create: `src/content/posts/poncha-ed-under-the-portuguese-sun-a-madeira-misadventure.mdx`
- Create: `src/content/posts/ramen-with-a-view-a-culinary-adventure-in-shibuya.mdx`
- Create: `src/content/posts/suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen.mdx`

**Interfaces:**
- Consumes: `post-data/<slug>.json` for each of the 4 slugs above, and the Task 2 conversion rules.
- Produces: 4 new `.mdx` files ready for Task 8's full-suite verification.

- [ ] **Step 1: Convert each post**

Same procedure as Task 3, Step 1, for these 4 slugs.

- [ ] **Step 2: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds; routes for all 4 new slugs appear under `/posts/`.

- [ ] **Step 3: Commit**

```bash
git add src/content/posts/pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual.mdx \
        src/content/posts/poncha-ed-under-the-portuguese-sun-a-madeira-misadventure.mdx \
        src/content/posts/ramen-with-a-view-a-culinary-adventure-in-shibuya.mdx \
        src/content/posts/suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen.mdx
git commit -m "content: migrate 4 posts from Squarespace export (batch 5/6)"
```

---

### Task 7: Convert posts 18–22 (taiyaki, taquitos, aussie-meat-pie, wok-hei, apple-cinnamon-muffin)

**Files:**
- Create: `src/content/posts/taiyaki-and-tranquility-a-kyoto-comfort.mdx`
- Create: `src/content/posts/taquitos-togetherness-and-a-taste-of-home.mdx`
- Create: `src/content/posts/the-aussie-meat-pie-of-my-childhood-dreams-and-how-i-finally-made-it-real.mdx`
- Create: `src/content/posts/the-pursuit-of-wok-hei-sesame-chicken-at-home.mdx`
- Create: `src/content/posts/when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story.mdx`

**Interfaces:**
- Consumes: `post-data/<slug>.json` for each of the 5 slugs above, and the Task 2 conversion rules.
- Produces: 5 new `.mdx` files ready for Task 8's full-suite verification. After this task, all 22 posts exist.

- [ ] **Step 1: Convert each post**

Same procedure as Task 3, Step 1, for these 5 slugs.

- [ ] **Step 2: Validate against the real schema**

Run: `npm run build`
Expected: build succeeds; routes for all 5 new slugs appear under `/posts/`.

- [ ] **Step 3: Commit**

```bash
git add src/content/posts/taiyaki-and-tranquility-a-kyoto-comfort.mdx \
        src/content/posts/taquitos-togetherness-and-a-taste-of-home.mdx \
        src/content/posts/the-aussie-meat-pie-of-my-childhood-dreams-and-how-i-finally-made-it-real.mdx \
        src/content/posts/the-pursuit-of-wok-hei-sesame-chicken-at-home.mdx \
        src/content/posts/when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story.mdx
git commit -m "content: migrate 5 posts from Squarespace export (batch 6/6)"
```

---

### Task 8: Full verification and PR

**Files:** none created; verification and PR only.

**Interfaces:**
- Consumes: all 22 `.mdx` files from Tasks 2–7.

- [ ] **Step 1: Count migrated posts**

Run: `ls src/content/posts/*.mdx | wc -l`
Expected: `24` (22 migrated + the 2 pre-existing example posts `jerk-chicken-platter.mdx` and `why-coastal-blue.mdx`).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds, 0 Zod schema errors, all 24 posts listed as generated `/posts/<slug>/index.html` routes.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all existing tests still pass (26 passing at worktree baseline before this work).

- [ ] **Step 4: Spot-check rendering**

Run: `npm run preview` (or inspect `dist/posts/<slug>/index.html` for 2–3 migrated posts) and confirm: ingredients/steps render as lists above the body, inline images appear in the body at their expected positions, no broken `![]()` syntax or leftover HTML tags in the rendered text.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin worktree-squarespace-migration
gh pr create --title "Migrate Squarespace blog export to recipe posts" --body "$(cat <<'EOF'
## Summary
- Converts all 22 posts from the Squarespace/WordPress export into `type: recipe` posts under `src/content/posts/`.
- Images keep their original Squarespace CDN URLs (not re-hosted). No `/blog/<slug>` redirects — old links will 404.
- See docs/superpowers/specs/2026-07-12-squarespace-content-migration-design.md for the full design.

## Test plan
- [x] `npm run build` passes with all 22 migrated posts included
- [x] `npm test` passes (26/26)
- [ ] Author spot-checks a few posts for tone/accuracy before merging

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL back to the author. Do not merge — merging is the author's explicit decision per `docs/CONSTITUTION.md` rule 1.

---

## Self-Review Notes

- **Spec coverage:** every decision in the design spec (post type, images, cover photo, alt text, excerpt, inline images, tags, About/Contact out of scope, no redirects, worktree+PR workflow) is implemented by a task above.
- **No placeholders:** Task 1's script is complete, runnable code, not pseudocode. Task 2's worked example is the actual final file content, not a description of one. Tasks 3–7 don't repeat 21 full MDX files verbatim (that would just be Task 2's code block copy-pasted with different data) — instead they point each batch at its exact source JSON files and the exact, numbered conversion rules in Task 2, which are concrete extraction/formatting rules, not vague judgment calls.
- **Consistency:** every batch task uses the same file paths, same `npm run build` verification command, and same commit-per-batch pattern established in Task 2.
