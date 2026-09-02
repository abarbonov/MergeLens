# MergeLens

> A cross-browser GitHub workflow companion for faster, more focused code reviews.

MergeLens is a WXT browser extension that adds review-oriented tools directly to GitHub. It combines a GitHub content script, a React popup, an options page, and a background service worker so review context and local workspace data remain available across the extension.

## Features

- **Review inbox**: inspect review requests and activity for the active repository from the popup.
- **Pull request toolbar**: open review actions, complexity estimates, quick links, and private notes from a GitHub PR.
- **Command palette**: navigate GitHub review workflows with keyboard-driven commands.
- **Private local review workspace**: save PR notes and reusable review templates locally with Dexie.
- **Review notifications**: poll GitHub for new review requests and deliver browser notifications on a configurable schedule.
- **Workspace preferences**: save inbox filters and repository-specific preferences with validated browser storage.
- **Portable local data**: export and import local notes, templates, and related settings.

## Quick Start

### Requirements

- Node.js 20 or newer
- npm
- A Chromium- or Firefox-based browser for loading the unpacked extension

### Install

```bash
npm install
```

### Start development

```bash
# Chromium-based browser
npm run dev

# Firefox
npm run dev:firefox
```

WXT starts a development build and reports the generated extension directory. Load that directory as an unpacked extension in the target browser.

### Configure GitHub access

Open the extension options page and provide a GitHub token with the minimum read access required for the review data you want to display. The token is kept in extension storage and is not exposed to the GitHub page content script.

## Useful Commands

| Command                 | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `npm run dev`           | Start the Chromium development build         |
| `npm run dev:firefox`   | Start the Firefox development build          |
| `npm run build`         | Create a production Chromium build           |
| `npm run build:firefox` | Create a production Firefox build            |
| `npm run zip`           | Package the Chromium extension               |
| `npm run zip:firefox`   | Package the Firefox extension                |
| `npm run compile`       | Run TypeScript checks without emitting files |
| `npm test`              | Run the Vitest test suite                    |
| `npm run test:e2e`      | Run Playwright browser tests                 |

## Architecture

MergeLens follows a structured-module architecture:

```text
entrypoints/   WXT delivery boundaries for background, content, popup, and options
features/      User-facing UI surfaces and controllers
modules/       Domain, application, ports, and adapters for product capabilities
shared/        Small cross-cutting browser, GitHub, messaging, logging, and validation primitives
tests/         Unit, component, integration, and end-to-end coverage
```

Entry points compose the extension and delegate behavior to public module APIs. Domain code stays framework-independent; browser APIs, GitHub requests, and persistence are isolated behind adapters.

## Security and Privacy

- GitHub credentials stay in extension-owned storage and are never injected into page content.
- The manifest requests only `storage`, `alarms`, and the GitHub API host; notification permission is optional.
- Notes, templates, and preferences are local to the extension unless a future feature explicitly adds synchronization.
- External GitHub and storage data is validated at adapter boundaries.

## Development Notes

Use the `browser` abstraction provided by WXT for cross-browser APIs. Keep WXT entrypoints thin and place reusable workflow rules in `modules/` or `features/`. Add tests for new application behavior and run both TypeScript compilation and the relevant Vitest/Playwright suites before submitting changes.

## License

MergeLens is licensed under the [MIT License](LICENSE).
