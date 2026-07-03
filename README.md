# AI Commerce Copilot

Marketing landing page for **AI Commerce Copilot** — an AI-powered commerce intelligence platform for WooCommerce that recommends products customers are likely to buy together, explains why they perform well, and surfaces actionable merchant insights.

Meet **Reco**, the product's AI merchandising copilot and mascot, featured throughout the page.

## Tech Stack

- [Next.js](https://nextjs.org) (App Router, Turbopack)
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) 4
- [Framer Motion](https://www.framer.com/motion/) for scroll reveals and micro-interactions
- TypeScript

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view it.

## Scripts

- `npm run dev` — start the development server
- `npm run build` — create a production build
- `npm run start` — serve the production build
- `npm run lint` — run ESLint

## Project Structure

```
src/
  app/            # App Router pages, layout, metadata, sitemap/robots
  components/
    layout/        # Navbar, Footer, logo
    sections/      # Page sections (Hero, Features, Dashboard, etc.)
    ui/            # Shared UI primitives (Button, GlassCard, Reveal, ...)
    reco/          # Reco mascot components (pose art, hero video)
  data/            # Static content for sections (features, metrics, comparison, ...)
  lib/             # Small utilities and motion/animation helpers
public/
  images/, videos/ # Served assets (mascot art, hero video, poster)
```

## Deployment

This is a standard Next.js app and deploys cleanly to [Vercel](https://vercel.com/new) or any platform that supports Next.js. See the [Next.js deployment docs](https://nextjs.org/docs/app/building-your-application/deploying) for details.
