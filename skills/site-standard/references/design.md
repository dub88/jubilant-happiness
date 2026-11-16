# Design and copy that belong to one business

A machine-made site is recognisable at a glance, and not because any single choice is wrong. Every choice is the default one: the centred hero with a gradient, three cards with icons, a row of invented testimonials, copy that could describe any company in any town. Visitors may not name what they see, but they read it as "nobody cared", and they trust the business less.

The test to apply throughout: **could this page belong to a different business if you swapped the name?** If yes, it is not finished. The fix is rarely more decoration. It is more of what is specific to this business: its real photos, its actual services and prices, the way its owner talks, the place it is in.

## Contents

1. Start from what is real
2. Copy
3. Structure and layout
4. Type
5. Colour
6. Images and icons
7. Motion and interaction
8. Finishing
9. Review before you call it done

## 1. Start from what is real

List what you actually have before designing: photographs, a logo, existing colours, the services and what they cost, opening hours, the area served, reviews that exist somewhere you can link to, anything the owner has written themselves. The design is an arrangement of this material. A section with nothing real to put in it should not exist.

If there are no photographs, say so and design for that honestly: a typographic page with strong colour and clear information is better than one propped up with stock images of strangers. Ask the user for photos; even phone pictures of the real shop, the real van or the real work beat anything generated.

## 2. Copy

**Say what it is, where, and for whom, in the first line.** "Sourdough and pastries baked each morning on Main Street, Springfield" tells a visitor in three seconds whether they are in the right place. "Elevating your everyday moments" tells them nothing. The headline is information, not atmosphere.

**Prefer facts to adjectives.** "Family-run since 1998", "same-day call-outs within 20 miles", "from $85 an hour" are claims a reader can use. "Passionate", "dedicated", "high-quality", "tailored solutions" are words every competitor also uses, so they carry no information. When you write an adjective, ask what fact made you reach for it, and write the fact.

**Write the way the owner speaks.** A plumber's site should sound like a competent plumber, not a brand consultancy. Read existing material the owner wrote and keep its plainness. Use "we" and "you". Short sentences.

**Cut the phrases that mark text as generated.** Unlock, elevate, seamless, cutting-edge, game-changing, look no further, one-stop shop, in today's fast-paced world, take your X to the next level, whether you're A or B. Also the habits: three adjectives in a row, a rhetorical question answered by the next sentence, every paragraph closing on an uplifting summary line. One of these is harmless. A page of them is what the checker's `stock-phrases` rule reports.

**One clear action per page.** Decide what a visitor should do (call, book, visit, send a message) and make that one thing obvious and repeated. A phone number that can be tapped is often the most valuable element on a small-business page.

**Never invent proof.** No made-up testimonials, review counts, star ratings, client logos, years in business or "trusted by 500+ customers". If real reviews exist, quote them with a name and link to the source. If they do not, leave the section out.

## 3. Structure and layout

**Let the content decide the sections.** The default skeleton (hero, three feature cards, testimonials, call-to-action band, footer) exists because it fits anything, which is why it suits nothing in particular. Work from what a visitor to this business needs, in the order they need it. A restaurant: what kind of food, the menu, hours, where, how to book. A tradesperson: what they fix, the area they cover, how fast, how to call, proof of work. Often that is fewer sections than the template, and different ones.

**Vary the rhythm.** A page of identical full-width bands, each with a centred heading and a centred paragraph, is monotonous. Mix dense and open areas, wide images and narrow text, a list here and a photograph there. Vary section widths and alignment with purpose.

**Left-align text that people read.** Centre a short headline if it suits the page. Paragraphs, lists and anything over two lines are easier to read aligned left, at a measure of roughly 45 to 75 characters. Text that spans a wide screen is tiring to follow.

**Do not put everything in a card.** Rounded rectangles with a soft shadow around every item flatten the hierarchy: when everything is boxed, nothing stands out. Use space, alignment and type to group things, and keep containers for items that are separate objects, such as products in a grid.

**Design the narrow screen first.** Most visits to a local business site come from a phone, often from someone standing outside. Name, what it does, phone, hours and address should be reachable without hunting. Check that tap targets are comfortably large and nothing scrolls sideways.

## 4. Type

Type does most of the work on a page that is mostly words, so choose it deliberately.

- **Pick typefaces for a reason connected to the business**, not because they are the framework's default. A traditional bakery, a law practice and a skate shop should not share a typeface. If the business has brand type, use it.
- **Two families at most**, often one. Contrast comes from size and weight.
- **Set a real scale.** A few sizes with clear steps between them (for example 16, 20, 28, 44 pixels). Timid differences between heading levels make a page look flat.
- **Body text of 16 to 18 pixels** with line height around 1.5; headings tighter. Avoid light grey text on white; it is the most common readability failure.
- **Load fonts properly**: self-host or use the framework's font loader, limit the weights, and set a sensible fallback so text is visible while the font loads.

## 5. Colour

- **Take colour from the business**: its logo, signage, vehicle, shopfront, the photographs. A palette drawn from the real thing ties the site to the place.
- **One accent, used sparingly**, for the action you want taken. Neutral tones for everything else. If everything is the accent colour, nothing is.
- **Avoid the reflexes**: a purple-to-blue gradient, gradient-filled headline text, glowing blurred blobs, frosted-glass panels, dark mode with neon highlights. They are not bad in themselves; they are what a generator produces when given no direction, so they signal exactly that.
- **Check contrast.** Body text needs at least 4.5 to 1 against its background, large text 3 to 1. Check text set over photographs especially.

## 6. Images and icons

- **Real photographs of the real business** wherever possible, cropped with intent and given `alt` text that says what they show.
- **No generated or stock people.** A stock photograph of smiling strangers in an office tells the visitor the business had nothing of its own to show. If there are no photos, use none and ask for some.
- **Size them properly**: modern formats, dimensions set to avoid layout shift, `loading="lazy"` below the fold, and no multi-megabyte files.
- **One icon set, used with restraint**, drawn at one weight. Icons should clarify, not decorate; a heading does not need one. Emoji are not icons: they render differently on every device and are the clearest sign of a generated feature grid.

## 7. Motion and interaction

- Motion should explain something (where a panel came from, that a button responded). Fading every section in on scroll explains nothing and slows the reader down.
- Honour `prefers-reduced-motion`.
- Every interactive element has a visible focus state and works from the keyboard. Links look like links; buttons look like buttons.
- Every link goes somewhere. A button that links to `#` is a broken promise; leave it out until its destination exists.

## 8. Finishing

These are the details that show whether someone finished the job:

- the business's own favicon and a share image
- a footer with the real name, address, phone and hours, matching the structured data exactly
- the copyright year generated from the date, not typed
- social icons only for profiles that exist, linking to those profiles
- a 404 page that helps (a way home, the phone number)
- no placeholder text, starter content or commented-out template blocks
- forms that say clearly what happened after submission

## 9. Review before you call it done

Look at the rendered page, not only the code. If you can take screenshots, take one at about 390 pixels wide and one at about 1280, and ask:

- In three seconds, can I tell what this business is, where it is, and how to contact it?
- If I replaced the name and logo, could it pass for a different business? Which sections are responsible?
- Is anything on the page invented, generic or filler? Remove it.
- Is there a single obvious thing to do next?
- Is all body text comfortably readable, on the phone width too?
- Does anything exist only because pages like this usually have one?

Then run the checker. Its `slop` rules catch the mechanical leftovers (placeholder text, default icons, dead links, stock phrases, emoji icons). They cannot tell you whether the page is good; that is what the questions above are for.
