# HorizonX Agentic OS

نظام العمليات الشخصي لعبدالله — الرئيس التنفيذي لـ HorizonX.

A personal operations system for Abdulla, CEO of HorizonX. Deployed at `claude.horizonx.site`. This is a **separate application** from the HorizonX platform — it only reads from the platform via the read-only Reports API and never modifies it.

The loop: **Gather data → analyze → propose actions in Arabic → Abdulla approves → execute → log → learn.**

See [`CLAUDE.md`](./CLAUDE.md) for the full specification, hard rules, and build phases.

## Structure

```
backend/    Node.js + TypeScript + Express + Prisma (SQLite) + node-cron
frontend/   React + TypeScript + Vite + Tailwind CSS — Arabic, RTL-first
```

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in real values — never commit .env
npx prisma migrate dev
npm run build
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment variables

All secrets live in `backend/.env` (documented in `backend/.env.example`). They are never hardcoded, never logged, and never shipped to the frontend bundle.
