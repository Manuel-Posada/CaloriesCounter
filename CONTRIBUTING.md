# Contributing to CaloriesCounter

Thank you for contributing to **CaloriesCounter**!

## Repository Layout

- `frontend/` — Angular 20 progressive web application
- `backend/` — Django 6.1 + Django REST Framework orchestration API
- `ml/` — Modular inference pipeline (segmentation, classification, monocular depth, volume, nutrition) and Modal deployment
- `research/` — Reproducible training/evaluation notebooks, comparison tables, and visual resources
- `docs/` — Technical audits and design specifications

## Development Guidelines

1. **Language:** Keep all new code, comments, commit messages, PR descriptions, and documentation in **English**.
2. **Branching & Commits:** Create a feature branch from `main` and use [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(ml): ...`, `fix(backend): ...`, `docs: ...`).
3. **Formatting & Linting:**
   - Follow `.editorconfig` (UTF-8, LF line endings, 4 spaces for Python, 2 spaces for TypeScript/HTML/SCSS/YAML).
   - Python linting configuration lives in `pyproject.toml` (`ruff check .`).
4. **Never commit secrets or large binaries:**
   - Do not commit `.env`, API keys, or model weights (`*.pt`, `*.pth`, `*.onnx`, `*.safetensors`).
   - Use `.env.example` / `backend/.env.example` as templates.

## Pre-PR Verification

Run the checks relevant to your changes before opening a pull request:

```bash
# ML core unit tests
cd ml && pytest tests/test_core.py -v

# Backend checks & tests
cd backend && python manage.py check && python manage.py test

# Frontend production build
cd frontend && npm run build
```
