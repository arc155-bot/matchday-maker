# Matchday Maker

## Repository and delivery

- Repository: `https://github.com/arc155-bot/matchday-maker`.
- The user wants app changes committed directly to `main` by default, unless a request specifies another branch or asks only for a proposal.
- Check the current remote `main` before editing. Preserve other changes and never force-push.
- Validate the changed files before committing. Report the resulting commit and any deployment limitation.
- Use the authenticated GitHub connector when native Git credentials are unavailable. Creating a commit and advancing `main` through the connector is an acceptable delivery route.
- Direct writes to `main` require repository write access and compatible branch rules. Do not bypass branch restrictions.

## App

- Static HTML/CSS/JavaScript PWA; no package installation or build step is required.
- Entry point: `index.html`; application logic: `app.js`; styling: `styles.css`.
- Keep the existing Oswald/Montserrat typography and mobile sharing behavior unless asked to change them.
- Preserve bundled assets and local browser storage keys.
- If app shell or precached assets change, update the cache version in `sw.js`.
- Check JavaScript syntax and local asset references for relevant changes.

## Netlify

- Production branch: `main`.
- Build command: empty; publish directory: `.`.
- `netlify.toml` defines publishing and cache behavior. GitHub must be linked in Netlify to enable automatic deployments; this file alone does not establish that connection.
