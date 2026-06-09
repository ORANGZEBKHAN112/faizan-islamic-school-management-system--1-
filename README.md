# Faizan Islamic School Management System

Multi-campus school ERP built with a React frontend and an Express + SQL Server backend, served from a single Node process.

## Stack

- Frontend: React 19, Vite, Tailwind CSS 4, React Router 7
- Backend: Express 4 in `server.ts`, raw `mssql`, JWT auth, bcrypt
- Database: Microsoft SQL Server
- Dev runtime: `tsx` runs `server.ts`, which also hosts the Vite dev server

> Note: the `Frontend/` (Angular) and `Backend/` (.NET) folders are legacy and not part of the active app. Do not use them unless doing a migration.

## Prerequisites

- Node.js 18+
- A reachable Microsoft SQL Server instance

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your own values:

   ```bash
   cp .env.example .env
   ```

   Required variables: `SQL_SERVER`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DATABASE`, `SQL_PORT`, `JWT_SECRET`.

3. Create the database schema. Run `Database/setup_and_seed.sql` against your SQL Server database for a fresh environment with sample data, or `Database/schema.sql` for the base schema. The server also applies idempotent schema patches on startup.

4. Start the app:

   ```bash
   npm run dev
   ```

   This serves both the API at `/api` and the SPA on the same port (3000).

## Default Login

On first startup, if no `admin` user exists, the server seeds one:

- Username: `admin`
- Password: `admin123`

Change this password after first login.

## Scripts

- `npm run dev` — start API + SPA (development)
- `npm run build` — build the SPA into `dist/`
- `npm run preview` — preview the built SPA
- `npm run lint` — TypeScript type check (`tsc --noEmit`)

## Production

1. Build the frontend: `npm run build`.
2. Run the server with `NODE_ENV=production` and a strong `JWT_SECRET`; it serves the static `dist/` build and the API.
3. For IIS hosting, the included `web.config` provides SPA URL rewrite. Install the IIS URL Rewrite Module.

## Roles

`Super Admin`, `Admin`, `Teacher`, `Accountant`, `Student`. Access is gated in `src/App.tsx` (routes) and `src/components/Layout.tsx` (navigation).

## Project Docs

- `PROJECT_CONTEXT.md` — architecture and conventions (read before coding)
- `AGENTS.md` — fast navigation index
- `PROJECT_AUDIT_REPORT.md` — known issues and fix roadmap

## Features

- Multi-campus support
- Role-based access
- Student registration, profiles, and Excel import
- Class and fee structure configuration
- Monthly fee voucher generation and payment tracking
- Attendance, expenses, and financial reports
- QuickPay online payment integration
- PDF generation for fee vouchers
