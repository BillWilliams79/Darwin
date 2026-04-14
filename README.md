# Darwin

A personal activity tracker and life-management web app built with React. Darwin helps you record, visualize, and analyze outdoor activities (running, cycling, etc.) with interactive maps, photo browsing, calendar views, charts, and task planning.

## Features

- **Interactive Maps** -- view activity routes on Leaflet maps with marker clustering, photo overlays, and fullscreen support
- **Activity Import** -- import activities from Cyclemeter (.FIT files) and Strava
- **Photo Browser** -- browse and manage geotagged photos tied to activities
- **Calendar** -- plan and review activities with FullCalendar integration
- **Trends & Charts** -- visualize performance data with Recharts
- **Task & Project Planning** -- organize tasks, projects, areas, and recurring tasks with drag-and-drop
- **Offline-capable** -- client-side SQLite (sql.js) for local data access

## Tech Stack

| Layer | Libraries |
|-------|-----------|
| UI | React 18, Material UI (MUI) 7 |
| State | Zustand, TanStack React Query |
| Routing | React Router 6 |
| Maps | Leaflet / React-Leaflet |
| Calendar | FullCalendar, Schedule-X |
| Charts | Recharts |
| Data | sql.js (client-side SQLite) |
| Auth | Amazon Cognito |
| Build | Vite |
| Test | Vitest (unit), Playwright (E2E) |

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens a local dev server (Vite) with hot module replacement.

### Build

```bash
npm run build
```

### Tests

```bash
# Unit tests
npm run test:unit

# End-to-end tests
npm run test:e2e
```

## Project Structure

```
src/
  App.jsx            # Root layout (NavBar + router outlet)
  Maps/              # Leaflet map views and route rendering
  MapRuns/           # Activity route cards and details
  RouteCards/        # Activity summary cards
  CalendarFC/        # Calendar views (FullCalendar)
  Trends/            # Charts and analytics
  photo-browser/     # Photo browsing and lightbox
  cyclemeter/        # Cyclemeter stats display
  CyclemeterImport/  # FIT file import pipeline
  strava/            # Strava integration
  TaskPlanView/      # Task and project management
  stores/            # Zustand state stores
  hooks/             # Custom React hooks
  RestApi/           # API client layer
  Context/           # React context providers
  Components/        # Shared UI components
sql/                 # Database schema and seed data
tests/               # Playwright E2E tests
```

## License

MIT -- see [license.md](license.md) for details.
