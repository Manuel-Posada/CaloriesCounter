# Security Policy

## Reporting a Vulnerability

If you discover a security issue (e.g., exposed credentials, authentication bypass, or improper access control), please **do not** open a public GitHub issue.

Instead, contact the repository maintainers directly or open a private security advisory on GitHub.

## Secret Management

- Never commit `.env` files, API keys (`GEMINI_API_KEY`, `R2_SECRET_ACCESS_KEY`, `MODAL_SHARED_SECRET`, `GITHUB_TOKEN`), or database credentials.
- Rotate any credential immediately if it is accidentally committed to git history.
- Keep `DJANGO_DEBUG=False` in production environments.
