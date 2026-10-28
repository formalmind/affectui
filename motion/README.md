# affectUI – motion

Every file is a single, self-contained React component (React is the only dependency).
Copy a file into your project, e.g. `components/ui/`, and import it from there.
Some files import another affectUI component from `@/components/ui/<name>` – copy that one alongside.

- **Blur Crossfade** (`blur-crossfade.tsx`) – Swaps content with a soft blur while the box glides smoothly to the size of what comes next
- **Gradient Floor** (`gradient-floor.tsx`) – A blurred colour gradient that glows up from the bottom edge – two layers that drift and morph
- **Gradient Text** (`gradient-text.tsx`) – Letters cut from a liquid, ever-flowing gradient – the color sweeps across the word the first time it's seen
- **Grid Background** (`grid-background.tsx`) – A fine line grid that drifts slowly behind your content and fades out towards the edges
- **Number Ticker** (`number-ticker.tsx`) – Odometer-style numbers – every digit rolls to its new value and counts in from zero when it scrolls into view
- **Shimmer Loader** (`shimmer-loader.tsx`) – Skeleton blocks that share one soft light sweep, plus shimmering text for “Thinking…” states
- **Text Reveal** (`text-reveal.tsx`) – Text that arrives word by word or letter by letter – each piece rises out of a soft blur as it scrolls into view
- **Tilt Card** (`tilt-card.tsx`) – A card that tilts in 3D towards the pointer, with a soft glare that follows it and a smooth spring back

Docs and live previews: https://www.affectui.com
