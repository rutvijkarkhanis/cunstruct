# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:8080
npm run build        # Production build (outputs to dist/)
npm run build:dev    # Dev-mode build (unminified)
npm run preview      # Preview production build locally
npm run lint         # ESLint check
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
```

Both `npm` and `bun` are present (both lock files exist); prefer `npm` to avoid conflicts.

## Environment

The app requires a `.env` file with these Supabase keys (public/safe to version):
```
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_URL=
```

## Architecture

**Cunstruct** is a procurement forecasting platform with two distinct interfaces:

1. **Public storefront** — product browsing, cart, checkout, kits (`/`, `/products`, `/kits`, `/cart`, `/checkout`, `/search`, `/auth`)
2. **Ops dashboard** — gated project management and demand forecasting (`/ops/*` routes, requires `ops` or `admin` role)
3. **Contractor/Site Engineer views** — `/my-projects`, `/contractor/my-projects/:id` for field users

### Tech Stack

- **React 18** + **TypeScript 5.8** + **Vite 5.4** (SWC compiler)
- **Tailwind CSS** + **shadcn/ui** (Radix UI primitives) for all UI components
- **Supabase** — PostgreSQL database, Auth, Row-Level Security, Edge Functions
- **TanStack React Query v5** — all server state; never use `useState` + `useEffect` for async data
- **React Hook Form** + **Zod** — all forms and schema validation
- **Framer Motion** — animations
- **Vitest** + **Playwright** — unit and E2E testing

### State Management

- `AuthContext` (`src/context/AuthContext.tsx`) — session, user, and role. Roles come from the `user_roles` table, not the profiles table. Use the `useAuth()` hook everywhere; do not access Supabase auth directly in components.
- `CartContext` (`src/context/CartContext.tsx`) — shopping cart state
- React Query — all product, project, forecast, and ops data fetching via custom hooks in `src/hooks/`

### Authentication & Roles

Four roles: `"contractor"`, `"site_engineer"`, `"ops"`, `"admin"`. Roles are stored in the `user_roles` table with RLS enforced. The ops dashboard (`/ops/*`) is gated by role checks inside `OpsLayout`. Always check roles via `useAuth().roles` — never assume from route alone.

### Database & Supabase

- Migrations live in `supabase/migrations/` — always add new migrations rather than editing existing ones.
- Auto-generated TypeScript types are at `src/integrations/supabase/types.ts` — regenerate after schema changes.
- The Supabase client is initialized in `src/integrations/supabase/client.ts`; import from there, not directly from `@supabase/supabase-js`.
- Edge functions are in `supabase/functions/` (WhatsApp send/webhook).

### Key Business Logic Files

| File | Purpose |
|---|---|
| `src/lib/forecastEngine.ts` | Demand forecasting calculations |
| `src/lib/delivery.ts` | Delivery tracking logic |
| `src/lib/kits.ts` / `jobs.ts` | Kit and job management |
| `src/lib/productGroupUtils.ts` | Product grouping/display utilities |
| `src/lib/searchAnalytics.ts` | Search event tracking |
| `src/lib/sort.ts` | Sorting and filtering logic |

### Path Aliases

`@/` maps to `src/`. Use this for all imports within the project.

### Component Conventions

- All generic UI primitives (Button, Dialog, etc.) live in `src/components/ui/` — these are shadcn/ui components, edit with care.
- Ops-specific components are in `src/components/ops/`.
- Page-level components are in `src/pages/`, including `src/pages/ops/` for the ops dashboard.
- The color scheme uses CSS variables: `--primary` is navy (`hsl(220 25% 14%)`), `--accent` is amber (`hsl(36 95% 54%)`).

### Testing

Tests use Vitest with jsdom. The setup file at `src/test/setup.ts` polyfills `matchMedia`. Test files follow the pattern `src/**/*.{test,spec}.{ts,tsx}`.
