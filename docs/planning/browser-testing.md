# Browser Testing Workflow

Use [`agent-browser`](https://github.com/vercel-labs/agent-browser) for new interactive browser checks of the public menu and shared POS. Do not add Playwright test-runner code or direct `@playwright/test` dependencies for these checks. Keep unit and component tests in the existing Vitest and Testing Library setup.

## Setup

Install the CLI globally on a developer or verification machine, then install its managed Chrome browser once:

```sh
npm install -g agent-browser
agent-browser install
```

On Linux, install browser system dependencies with `agent-browser install --with-deps` where the machine's package manager is available. Do not add the browser binary or its system dependencies to the application release artifact.

## Interactive checks

Start the API and the app being checked using the existing project scripts. Then drive the browser through the CLI:

```sh
agent-browser open http://127.0.0.1:3000/menu
agent-browser snapshot
agent-browser screenshot /tmp/cafe-menu.png
agent-browser close
```

For the POS, use `http://127.0.0.1:3002/pos`. Use snapshots and semantic locators for interactions, and capture screenshots at the viewport sizes required by the specific check. Record the target URL, viewport, user-visible outcomes, and any browser errors in the relevant completion record. Never put credentials, session cookies, or private QR tokens into committed scripts or artifacts.

Use the managed Chrome session for reproducible checks. Use the CLI's CDP connection only when the task specifically needs an existing browser session; do not take over a user's active session as a default.
