# Prince News — complete starter platform

A responsive multilingual news website with:
- Public news homepage, category filters, search, and source links
- Admin login with password hashing and rate limiting
- Admin article create/edit/delete, drafts and publishing
- Image uploads (JPG, PNG, WEBP, GIF) with size limits
- Automatic headline import from GNews
- Optional Google Cloud Translation API endpoint
- SQLite database and SQLite-backed sessions

## Important limitations
- This is a production-oriented starter, not a substitute for a security review.
- Automatic news import requires a GNews API key and is limited by the provider's plan and quota. Read GNews terms before publishing imported content.
- The site stores imported headlines and descriptions and links to their original publisher. Check each provider's licensing/attribution terms; do not assume full articles or images may be republished.
- The language selector localizes the basic interface into several languages. Article content is not automatically translated just because a visitor changes the interface language. The optional translation endpoint can translate text when Google Cloud Translation is configured; integrate it into a translation workflow before promising fully translated pages.
- Scheduled imports run while this Node process is alive. Some free hosting services sleep or restart processes; use a paid always-on service or a scheduled job for reliable imports.
- Local SQLite and uploads require persistent disk storage. For ephemeral serverless hosting, use managed database/object storage instead.

## Requirements
- Node.js 20 or newer
- npm
- Optional GNews API key: https://gnews.io/
- Optional Google Cloud Translation API key: https://cloud.google.com/translate

## Run locally

1. Extract the ZIP.
2. Copy `.env.example` to `.env`.
3. Set a strong `ADMIN_PASSWORD` (at least 12 characters) and a random `SESSION_SECRET` (at least 32 characters).
4. Optionally add `GNEWS_API_KEY` and `GOOGLE_TRANSLATE_API_KEY`.
5. Install and run:

```bash
npm install
npm start
```

6. Open `http://localhost:3000`.
7. Open `http://localhost:3000/admin.html` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

The initial admin user is created on the first start only if the username does not exist and the password is 12+ characters. If the database was already created without an admin user, set the password and restart; the app will create the configured username if it does not already exist. Do not expose `.env` publicly.

## Environment settings

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port, default 3000 |
| `NODE_ENV` | Set to `production` on deployment |
| `SESSION_SECRET` | Secret used to sign admin sessions |
| `ADMIN_USERNAME` | Initial admin username |
| `ADMIN_PASSWORD` | Initial admin password (12+ chars) |
| `GNEWS_API_KEY` | Enables manual and scheduled headline import |
| `GOOGLE_TRANSLATE_API_KEY` | Enables Google Cloud Translation endpoint |
| `NEWS_COUNTRY` | Default import country, e.g. `pk` |
| `NEWS_LANGUAGE` | Default import language, e.g. `en` |
| `AUTO_IMPORT_MINUTES` | Scheduled import interval (minimum 15) |
| `MAX_UPLOAD_MB` | Maximum image size, clamped to 1–10 MB |
| `BASE_URL` | Public URL shown in startup message |

## Deploy (Render, Railway, VPS, etc.)

1. Create a Node web service from this project or its Git repository.
2. Set build command to `npm install`; start command to `npm start`.
3. Set environment variables from `.env.example` in the hosting dashboard. Use `NODE_ENV=production`, a long random `SESSION_SECRET`, and a strong admin password.
4. Attach a **persistent disk** mounted at the project root (or adjust paths) so `data/` and `uploads/` survive restarts. Without persistent storage, SQLite articles and uploaded images can disappear on redeploy.
5. Configure HTTPS. The production session cookie is marked secure, so admin login expects HTTPS when `NODE_ENV=production`.
6. Set up GNews and translation keys if needed. Keep API keys server-side only; never put them in browser JavaScript.
7. Test login, publish a test article, upload an image, import a few headlines, and verify source links and mobile layout.

## Languages
The public UI selector includes English, Urdu, Hindi, Arabic, Bengali, Chinese, Spanish, French, German, Portuguese, Russian, Japanese, Korean, Indonesian, Turkish, Italian, Dutch, Punjabi, Tamil, Telugu, Marathi, Persian, Swahili, Vietnamese, Thai, Ukrainian, Polish, Romanian, Hebrew, Malay, Filipino, Nepali, Sinhala, Pashto and Kurdish. UI translations are currently provided for English, Urdu, Hindi, Arabic, Spanish and French; other options display the English fallback until their translations are added. News content remains in the language it was imported or written in unless you explicitly translate it.

## Security checklist before launch
- Use unique credentials and keep `.env` private.
- Use HTTPS and persistent storage.
- Back up `data/prince-news.db` and `uploads/`.
- Add CSRF protection and stricter content sanitization before allowing multiple untrusted admins.
- Review provider licenses, attribution rules, copyright, local media laws and privacy requirements.
- Configure backups, monitoring, API quota alerts and a recovery plan.
